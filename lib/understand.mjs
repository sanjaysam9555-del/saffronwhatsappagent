// "Read first": before any rule answers a lead, Claude reads the whole recent chat, what we have saved and the question we last asked,
// and says what the lead is doing (answering, correcting, sharing a number, asking for a call, complaining). The rules then act on that.
// This file holds the pure parts (what is sent to Claude, how its answer is checked, the repeat check); the call itself is in claude.mjs.

export const FIELD_KEYS = ["date", "location", "occasion", "requirement", "guests"];
export const INTENTS = ["answering", "correcting", "sharing_contact", "wants_call", "question", "confused", "complaint", "other"];

// [{from: "customer"|"us", text}] oldest first -> one line each. The lead's lines and ours are labelled so Claude never mixes them up.
export function transcript(history, n = 12, each = 400) {
  return (history || []).slice(-n).filter((h) => h && String(h.text || "").trim())
    .map((h) => `${h.from === "us" ? "Saffron" : "Lead"}: ${String(h.text).replace(/\s+/g, " ").trim().slice(0, each)}`).join("\n");
}

const NOT_SAVED = /^(pending|not shared|shared in this chat)$/i;
export function savedLines(q) {
  const f = q?.fields || {};
  const lines = Object.entries(f).filter(([, v]) => v && !NOT_SAVED.test(String(v))).map(([k, v]) => `${k}: ${String(v).slice(0, 80)}`);
  if (q?.callBooked?.label) lines.push(`call booked: ${q.callBooked.label}`);
  else if (q?.chosen) lines.push("a call time was chosen but is not booked yet");
  return lines.length ? lines.join("; ") : "(nothing saved yet)";
}

export const READ_SYSTEM =
  "You read a chat between a wedding planner's assistant (Saffron) and a lead, BEFORE anything is answered. " +
  "Read the whole recent chat, what we have already saved, the question we last asked, and the lead's newest message. " +
  "Respond with ONLY JSON: " +
  '{"intent": string, "complaint": boolean, "date": string|null, "location": string|null, "occasion": string|null, "requirement": string|null, "guests": string|null}. ' +
  "intent is one of: answering (they answer what we asked), correcting (they change or fix something they told us before), sharing_contact (they give a phone number or email), " +
  "wants_call (they ask to talk, book a call or see times), question (they ask us something), confused (they did not understand our message and want it explained or repeated, for example \"I didn't get you\", \"what do you mean\"), complaint (they are unhappy with us), other. " +
  "complaint is true when they say we repeat ourselves, did not read or understand THEM, or ignored what they said. Not understanding US is confused, not a complaint. A confused message gives no details. " +
  "The details are what the LEAD said, in the newest message or in their earlier messages, that are not saved yet or that they corrected; the newest statement wins. " +
  "Never take a detail from Saffron's messages. date = the event date or month as they wrote it; location = city, venue or destination; occasion = wedding, reception, engagement and so on; " +
  "requirement = planning, decoration or both (their words, for example planning decor and execution); guests = guest count as written. " +
  "Use null for anything not stated. Never guess. Keep each value under 60 characters, in their words.";

export function readPrompt({ text, name, history, q, asked }) {
  return `Lead's name: ${name || "unknown"}\nSaved so far: ${savedLines(q)}\nWe last asked about: ${asked || "nothing in particular"}\n\nRecent chat (oldest first):\n${transcript(history) || "(none)"}\n\nLead's newest message:\n${String(text || "").slice(0, 800)}`;
}

// Claude's answer, checked: only known intents, only short plain details. Anything else is dropped.
export function normalizeRead(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  const intent = INTENTS.includes(parsed.intent) ? parsed.intent : "other";
  const fields = {};
  for (const k of FIELD_KEYS) {
    const v = parsed[k];
    if ((typeof v === "string" || typeof v === "number") && String(v).trim() && String(v).length <= 80) fields[k] = String(v).trim();
  }
  return { intent, complaint: parsed.complaint === true || intent === "complaint", fields };
}

// The same words as the last thing we sent them? Case, spacing and emoji do not count as a difference.
const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export const sameMessage = (a, b) => Boolean(norm(a)) && norm(a) === norm(b);
// True when sending `msg` would repeat our last message to this chat within the window (default 6 hours).
export function isRepeatOut(lastText, lastAt, msg, now = Date.now(), windowMs = 6 * 3600_000) {
  return Boolean(lastText) && sameMessage(lastText, msg) && now - (lastAt || 0) < windowMs;
}

// A reply written as one block of text is split into short paragraphs, like every other message we send (Shriya: "No line breaks").
// First sentence alone, the middle together, a closing question alone. Messages that already have line breaks (lists of times, fixed texts) are left as they are.
export function paragraphs(msg) {
  const t = String(msg ?? "").trim();
  if (!t || /\n/.test(t) || t.length < 80) return String(msg ?? "");
  const s = t.split(/(?<=[.!?])\s+(?=[A-Z"\u201C\u2018'\u0900-\u097F])/u);
  if (s.length < 2) return t;
  const closing = /\?\s*(\u{1F33C}\s*)?$/u.test(s[s.length - 1]);
  if (s.length === 2) return s.join("\n\n");
  if (!closing) return [s[0], s.slice(1).join(" ")].join("\n\n");
  return [s[0], s.slice(1, -1).join(" "), s[s.length - 1]].join("\n\n");
}

// At most one flower per message: when a message carries several (an opening one and a closing one), only the last stays.
export function oneEmoji(msg) {
  const s = String(msg ?? "");
  const flowers = [...s.matchAll(/\u{1F33C}/gu)];
  if (flowers.length < 2) return s;
  const keep = flowers[flowers.length - 1].index;
  let out = "";
  for (let i = 0; i < s.length;) {
    const cp = s.codePointAt(i), ch = String.fromCodePoint(cp);
    if (cp === 0x1F33C && i !== keep) { i += ch.length; if (s[i] === " ") i++; continue; }
    out += ch; i += ch.length;
  }
  return out.replace(/[ \t]+([.!?,])/g, "$1").replace(/[ \t]{2,}/g, " ");
}

// Two replies that say nearly the same thing in different words ("Thank you, please complete your onboarding..." twice) are a repeat too.
const words = (t) => new Set(norm(t).split(" ").filter((w) => w.length > 2));
export function nearSame(a, b, threshold = 0.5) {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return false;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / Math.min(x.size, y.size) >= threshold;
}
export function isNearRepeat(lastText, lastAt, msg, now = Date.now(), windowMs = 3 * 3600_000) {
  return Boolean(lastText) && now - (lastAt || 0) < windowMs && nearSame(lastText, msg);
}
