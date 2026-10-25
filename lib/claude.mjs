// Claude drafts light replies ONLY after the keyword gate in rules.mjs has already ruled out
// money/date/commitment topics. Even then, Claude's output is checked in code before sending.
import { welcomeText } from "./leadfields.mjs";
import { READ_SYSTEM, readPrompt, normalizeRead } from "./understand.mjs";
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";

// Categories that may be auto-sent. Everything else is escalated to a human.
export const AUTO_OK = new Set(["greeting", "thanks", "ack", "signup_help", "general_info"]);

const SYSTEM = `You write short WhatsApp replies for Saffron Collective, a luxury wedding and event planning firm in Gurugram, India.
You receive the customer's latest message and recent chat history. Reply in the customer's language (English, Hindi or Hinglish), warm and professional, under 60 words, no emojis except at most one.
Classify the message into exactly one category:
- greeting: a hello or opening message
- thanks: thanks / okay / acknowledgement that needs no real answer
- ack: they shared details or asked to be contacted; reassure that a planner will reach out
- signup_help: a vendor asking how to join (the sign-up link is provided to you)
- general_info: simple question about what Saffron does (weddings, event planning, destination weddings, decoration)
- escalate: anything else, including complaints, negotiation, specific requests, anything you are unsure about
HARD RULES: never mention prices, fees, packages, discounts, dates, availability or payment. Never promise anything, never confirm bookings or commitments, never invent facts, venues or vendors. If unsure, use category "escalate".
Respond with ONLY JSON: {"category": "...", "reply": "..."}. For "escalate" use an empty reply.`;

export function checkReply(category, reply) {
  if (!AUTO_OK.has(category)) return { ok: false, why: `category ${category}` };
  if (!reply || reply.length > 600) return { ok: false, why: "bad length" };
  if (/₹|\brs\.?\s?\d|\binr\b|\d+\s?(k|lakh|lac|crore)\b|\bdiscount\b|\bpackage\b/i.test(reply))
    return { ok: false, why: "money language" };
  const urls = reply.match(/https?:\/\/\S+/g) || [];
  if (urls.some((u) => !u.startsWith(process.env.VENDOR_SIGNUP_URL || "https://invalid.invalid")))
    return { ok: false, why: "unexpected url" };
  return { ok: true };
}

export function parseModelJson(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// history: [{from: "customer"|"us", text}] oldest first
export async function draftReply({ text, name, history = [] }) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const convo = history.map((h) => `${h.from === "us" ? "Saffron" : "Customer"}: ${h.text}`).join("\n");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system: SYSTEM + `\nVendor sign-up link (only URL you may use): ${process.env.VENDOR_SIGNUP_URL}`,
      messages: [{
        role: "user",
        content: `Customer name: ${name || "unknown"}\nRecent chat:\n${convo || "(none)"}\n\nLatest customer message:\n${text}`,
      }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const parsed = parseModelJson(data.content?.[0]?.text);
  if (!parsed) return null;
  const verdict = checkReply(parsed.category, parsed.reply);
  return verdict.ok
    ? { category: parsed.category, reply: parsed.reply.trim() }
    : { category: "escalate", reason: `blocked: ${verdict.why}` };
}

// Pulls event details out of a free-text WhatsApp message. Never guesses: absent means null.
// A plain-code reading of the message, used when Claude's reading is missing or empty, so that what a lead already said is never asked again.
const MONTH = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DAY = "\\d{1,2}(?:st|nd|rd|th)?";
const DATE_RE = new RegExp(`\\b(?:${DAY}(?:\\s*(?:-|to|and|&)\\s*${DAY})?\\s*(?:of\\s+)?)?(?:${MONTH})\\b(?:\\s+${DAY}\\b(?!\\s*(?:guests?|people|pax)))?(?:,?\\s*(?:20\\d\\d|next\\s+year|this\\s+year))?`, "i");
const NUM_DATE_RE = /\b\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?\b/;
const YEAR_RE = /\b(next\s+year|this\s+year|coming\s+year)\b/i;
export function localFields(text = "", asked = null) {
  const t = String(text || "");
  const out = {};
  const d = t.match(DATE_RE)?.[0] || t.match(NUM_DATE_RE)?.[0] || (asked === "date" ? t.match(YEAR_RE)?.[0] : "");
  const bareMay = /^may$/i.test((d || "").trim()) && !(asked === "date" && t.trim().length <= 12); // "may I know..." is not a month
  if (d && d.trim() && !bareMay) out.date = d.trim().replace(/\s+/g, " ").slice(0, 60);
  if (/\b(engagement|roka|ring ceremony|sagai)\b/i.test(t)) out.occasion = "Engagement";
  else if (/\breception\b/i.test(t) && !/\bwedding\b/i.test(t)) out.occasion = "Reception";
  else if (/\b(wedding|marriage|shaadi|shadi|vivah|getting married|get married)\b/i.test(t)) out.occasion = "Wedding";
  else if (/\b(birthday|anniversary|baby shower|corporate|sangeet|mehendi|mehndi|haldi)\b/i.test(t)) out.occasion = t.match(/\b(birthday|anniversary|baby shower|corporate|sangeet|mehendi|mehndi|haldi)\b/i)[0].toLowerCase().replace(/^./, (c) => c.toUpperCase());
  if (asked === "guests") { const g = t.match(/\b(\d{2,4})\b/); if (g) out.guests = g[1]; }
  return out;
}

// Claude's reading first; anything it missed is filled in by plain code. Never throws.
// `read` is the result of understandChat (Claude's reading of the whole chat): when it is given, it replaces the single-message reading.
export async function extractFields(text, asked, read = null) {
  const local = localFields(text, asked);
  const fromClaude = read ? read.fields : await claudeFields(text, asked);
  return { ...local, ...fromClaude, ...(read?.intent === "correcting" ? { correcting: true } : {}) };
}

// One Claude call that reads the whole recent chat, what we hold and the newest message. Null when it cannot (the plain rules then carry on as before). Never throws.
export async function understandChat({ text, name, history, q, asked }) {
  if (!process.env.ANTHROPIC_API_KEY || !String(text || "").trim()) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 300, system: READ_SYSTEM, messages: [{ role: "user", content: readPrompt({ text, name, history, q, asked }) }] }),
    });
    if (!res.ok) { console.error("understandChat: Claude API", res.status); return null; }
    return normalizeRead(parseModelJson((await res.json()).content?.[0]?.text));
  } catch (e) { console.error("understandChat:", e.message); return null; }
}

async function claudeFields(text, asked) {
  if (!process.env.ANTHROPIC_API_KEY) return {};
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 200,
        system: "Extract event details from a customer's WhatsApp message to a wedding planner. Respond with ONLY JSON: " +
          '{"date": string|null, "location": string|null, "occasion": string|null, "requirement": string|null, "guests": string|null}. ' +
          "Read the WHOLE message and fill in every detail it contains, not only the one we asked about: a single line can give occasion, date and city together. " +
          "date = the event date or month as they wrote it, and \"November next year\" or \"in March\" counts as a date; location = city/venue/destination; occasion = wedding/reception/engagement/etc; " +
          "requirement = planning, decoration, or both; guests = guest count as they wrote it (e.g. 150, around 200). Use null for anything not stated. Never guess. Keep each value under 60 characters, in their words.",
        messages: [{ role: "user", content: `We just asked about: ${asked || "their event"}\nMessage: ${text}` }],
      }),
    });
    if (!res.ok) { console.error("extractFields: Claude API", res.status); return {}; }
    const parsed = parseModelJson((await res.json()).content?.[0]?.text) || {};
    const out = {};
    for (const k of ["date", "location", "occasion", "requirement", "guests"]) {
      if ((typeof parsed[k] === "string" || typeof parsed[k] === "number") && String(parsed[k]).trim() && String(parsed[k]).length <= 80) out[k] = String(parsed[k]).trim();
    }
    return out;
  } catch (e) { console.error("extractFields:", e.message); return {}; }
}

// A tailored first reply for someone messaging us for the first time. Claude only writes the warm opening (reads what they
// actually said); the next question is added by code. Never quotes money, dates or availability. Null means "use the standard opener".
export async function draftOpening({ text, name, greeted = false }) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 120,
        system: "You write two short lines for the FIRST reply from Saffron Collective, a luxury wedding and event planning firm in Gurugram, to someone who has just messaged us. " +
          "The greeting and the welcome are added separately by code, so do NOT write a greeting, a welcome, their name or any emoji. " +
          "Write exactly two lines separated by one blank line, each ONE short sentence of at most 14 words. " +
          "Line 1: acknowledge their situation like a warm human planner, e.g. 'Congratulations on the upcoming wedding in your family, what wonderful news.' (congratulate only if a wedding or engagement is mentioned). " +
          "Line 2: respond to what they want, e.g. \"We'd be delighted to help bring the celebrations to life.\" " +
          "If they asked about pricing, line 2 is: 'Pricing depends on your plans, and our planner will walk you through it.' " +
          "If they asked to connect or talk, line 2 says our planner will arrange a call. If they asked about availability or dates, line 2 says our planner will confirm. " +
          "HARD RULES: never state or hint at any price, fee, package, discount, date, time slot or availability; never say you checked a calendar; never promise anything specific; " +
          "never invent facts. Do NOT ask any question (the next question is added separately). Reply in their language (English, Hindi or Hinglish). Output only the two lines.",
        messages: [{ role: "user", content: `Name: ${name || "unknown"}\nTheir message: ${text}` }],
      }),
    });
    if (!res.ok) return null;
    const out = String((await res.json()).content?.[0]?.text || "").trim();
    if (!out || out.includes("?")) return null;
    if (/₹|\brs\.?\s?\d|\binr\b|\d+\s?(k|lakh|lac|crore)\b|\bdiscount\b|\bpackage\b|https?:\/\//i.test(out)) return null;
    const lines = out.split(/\n\s*\n/).map((l) => l.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
    if (!lines.length || lines.length > 2 || lines.some((l) => l.length > 130)) return null;
    const [l1, l2] = lines;
    // Greeting and welcome are written by code; if they were welcomed a moment ago, just the two lines.
    return greeted ? lines.join("\n\n") : `${welcomeText(name)}\n${l1}${l2 ? `\n\n${l2}` : ""}`;
  } catch { return null; }
}

// A short, human reaction to what a lead just told us during the questions ("Udaipur, lovely choice!"). The next question is added
// by code. Null means "use the plain default". Never comments on price, dates, availability or what we can do.
export async function draftAck({ text, name, kind, asked, fields = {} }) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const known = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("; ") || "nothing yet";
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 120,
        system: "You are a warm, polished wedding planner at Saffron Collective replying on WhatsApp. The lead just answered one of our questions. " +
          "Write ONE short reaction (6 to 18 words) to what they actually said, in their language (English, Hindi or Hinglish), like a thoughtful human: " +
          "for example 'Udaipur, such a beautiful choice!' or 'A December wedding, how lovely!' or 'No problem, an approximate month works too.' " +
          "If their answer is vague or unsure, reassure them kindly. If they added a detail, acknowledge that detail specifically. " +
          "HARD RULES: do NOT ask any question; never mention price, fees, budget, packages, discounts, availability, being free or booked, or any time slot; " +
          "never promise or confirm anything; never invent facts or praise a venue or vendor by name unless they named it; at most one emoji (🌼); no greeting. Output only the sentence.",
        messages: [{ role: "user", content: `Lead name: ${name || "unknown"}\nWe were collecting: ${kind === "confirmed" ? "final confirmation" : kind === "addition" ? "an extra detail they added" : asked || "event details"}\nDetails so far: ${known}\nTheir message: ${text}` }],
      }),
    });
    if (!res.ok) return null;
    const out = String((await res.json()).content?.[0]?.text || "").trim();
    if (!out || out.length > 160 || out.includes("?") || /\n/.test(out)) return null;
    if (/₹|\brs\.?\s?\d|\binr\b|\d+\s?(k|lakh|lac|crore)\b|\bdiscount\b|\bpackage\b|\bavailab|\bbudget\b|https?:\/\//i.test(out)) return null;
    return out;
  } catch { return null; }
}

// One warm line for a lead who has gone quiet in the middle of our questions. It never asks anything (the code adds the question).
// Null means "use the plain fallback line".
export async function draftNudge({ name, fields = {} }) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const known = Object.entries(fields).filter(([, v]) => v && !/^(pending|not shared)$/i.test(v)).map(([k, v]) => `${k}: ${v}`).join("; ") || "nothing yet";
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 120,
        system: "You are a warm, polished wedding planner at Saffron Collective on WhatsApp. A lead stopped replying in the middle of our questions a few hours ago. " +
          "Write ONE gentle, no-pressure line (10 to 25 words) that says we are happy to continue whenever they are ready, and where it fits mention a detail they already told us " +
          "(for example 'Your November wedding in Jaipur sounds lovely, we would love to continue whenever you are ready.'). " +
          "HARD RULES: do NOT ask any question; no greeting; never mention price, fees, budget, packages, discounts, availability, being free or booked, or any time; " +
          "never pressure or say 'last chance'; never invent facts; at most one emoji (🌼). Output only the sentence.",
        messages: [{ role: "user", content: `Lead name: ${name || "unknown"}\nDetails so far: ${known}` }],
      }),
    });
    if (!res.ok) return null;
    const out = String((await res.json()).content?.[0]?.text || "").trim();
    if (!out || out.length > 200 || out.includes("?") || /\n/.test(out)) return null;
    if (/₹|\brs\.?\s?\d|\binr\b|\d+\s?(k|lakh|lac|crore)\b|\bdiscount\b|\bpackage\b|\bavailab|\bbudget\b|https?:\/\//i.test(out)) return null;
    return out;
  } catch { return null; }
}

// A follow-up for a lead who has not answered. Claude reads the real conversation (what we asked, in whose words, what they said) and
// decides whether our last message is actually waiting for their answer. Returns { send: false } when nothing should be sent,
// { send: true, reply } otherwise, or null when it could not be done safely (the caller then leaves the chat alone or uses its fallback).
// history: [{from: "customer"|"us", text}] oldest first.
export async function draftFollowUp({ name, history = [], fields = {} }) {
  if (!process.env.ANTHROPIC_API_KEY || !history.length) return null;
  try {
    const known = Object.entries(fields).filter(([, v]) => v && !/^(pending|not shared)$/i.test(v)).map(([k, v]) => `${k}: ${v}`).join("; ") || "nothing recorded";
    const convo = history.slice(-12).map((h) => `${h.from === "us" ? "Saffron" : "Lead"}: ${String(h.text || "").slice(0, 400)}`).join("\n");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 300,
        system: "You are a warm, polished wedding planner at Saffron Collective writing on WhatsApp. The last message in this chat is from us and the lead has not replied for a few hours. " +
          "Decide whether our last message is actually waiting for their answer (a question, a request for details, a choice, a confirmation, a proposal or call time they have not responded to). " +
          "If the conversation had naturally ended, they said they will get back later or are busy, they said they are not interested, or they asked us for something we still owe them, then do NOT follow up. " +
          "Otherwise write ONE gentle, no-pressure follow-up (12 to 45 words) in the language and tone the lead has been using (English, Hindi or Hinglish). " +
          "Pick up exactly where the chat stopped: refer to the specific thing we asked, and say in a natural way that you are happy to continue whenever they are ready. You may ask that same question again once, briefly, in fresh words. " +
          "HARD RULES: no greeting like 'Hello' (they know us); never mention price, fees, budget, packages, discounts, availability, being free or booked, or any date or time we would offer; " +
          "never promise or confirm anything; never invent facts; never pressure or say 'last chance'; no links; at most one emoji (🌼); at most one question mark. " +
          'Output ONLY JSON: {"waiting": true|false, "reply": string}. If waiting is false, reply is an empty string.',
        messages: [{ role: "user", content: `Lead name: ${name || "unknown"}\nDetails recorded: ${known}\n\nChat (oldest first):\n${convo}` }],
      }),
    });
    if (!res.ok) return null;
    const parsed = parseModelJson((await res.json()).content?.[0]?.text);
    if (!parsed || typeof parsed.waiting !== "boolean") return null;
    if (!parsed.waiting) return { send: false };
    const out = String(parsed.reply || "").trim();
    if (!out || out.length > 330 || /\n/.test(out) || (out.match(/\?/g) || []).length > 1) return null;
    if (/₹|\brs\.?\s?\d|\binr\b|\d+\s?(k|lakh|lac|crore)\b|\bdiscount\b|\bpackage\b|\bavailab|\bbudget\b|\bfree\b|\bbooked\b|https?:\/\//i.test(out)) return null;
    return { send: true, reply: out };
  } catch { return null; }
}

// The holding reply when a question needs a person (pricing, availability, a specific request). Acknowledges what they actually
// asked instead of a generic line, and hands over to the team. Null means "use the standard holding line".
export async function draftHold({ text, name }) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 150,
        system: "You are a warm, polished planner at Saffron Collective (luxury wedding and event planning, Gurugram) replying on WhatsApp. " +
          "The person asked something that only our team can answer (pricing, availability, a specific request, or a detailed question). " +
          "Write a short reply (max 35 words) in their language (English, Hindi or Hinglish) that shows you understood what they asked and says a member of our team will personally get back to them shortly, as two short lines separated by one blank line (first shows you understood, second says the team will get back). " +
          "HARD RULES: do NOT answer it; never state or hint at any price, fee, package, discount, date, time slot or availability; never say you checked anything; never promise a specific time or outcome; " +
          "never invent facts; do not ask a question; at most one emoji (🌼). Output only the message.",
        messages: [{ role: "user", content: `Name: ${name || "unknown"}\nTheir message: ${text}` }],
      }),
    });
    if (!res.ok) return null;
    let out = String((await res.json()).content?.[0]?.text || "").trim();
    if (!out || out.length > 300 || out.includes("?")) return null;
    out = out.replace(/\n{3,}/g, "\n\n");
    if (/₹|\brs\.?\s?\d|\binr\b|\d+\s?(k|lakh|lac|crore)\b|\bdiscount\b|\bpackage\b|https?:\/\/|\b(we are|we're|is|are) (available|free|booked)\b/i.test(out)) return null;
    return out;
  } catch { return null; }
}

// Who is this person? Decides whether to run the new-client questions. "client" = wants wedding/event services for themselves.
// "vendor" = offers services, supplies, vehicles, venues, or shares a portfolio/rates/photos. "unclear" = anything else.
// Without an API key, or on any error, falls back to "client" (the previous behaviour).
// Who is writing, plus (for a vendor) the first name and business they gave us, so the welcome can use them.
export async function classifySenderDetail({ text, name }) {
  const none = { who: "client", name: "", business: "" };
  if (!process.env.ANTHROPIC_API_KEY) return none;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 80,
        system: "A wedding and event planning company received a first WhatsApp or Instagram message from an unknown person. Decide who is writing. " +
          'Respond with ONLY JSON: {"who": "client" | "vendor" | "unclear", "name": "", "business": ""}. ' +
          "client = a person or family planning their own wedding or event who wants planning/decor services. " +
          "vendor = a business or freelancer offering services, rentals, vehicles, venues, products, or sharing a catalogue, portfolio, rates or work photos. " +
          "unclear = anything else, or if you cannot tell. When unsure, answer unclear. " +
          'For a vendor only: "name" is the first name they give for themselves in the message (empty if none), "business" is their business name exactly as they wrote it (empty if none). Never guess.',
        messages: [{ role: "user", content: `Profile name: ${name || "unknown"}\nMessage: ${text}` }],
      }),
    });
    if (!res.ok) return none;
    const j = parseModelJson((await res.json()).content?.[0]?.text) || {};
    const who = ["client", "vendor", "unclear"].includes(j.who) ? j.who : "client";
    const tidy = (v, max) => String(v ?? "").replace(/[^\p{L}\p{N} .&'’-]/gu, "").replace(/\s+/g, " ").trim().slice(0, max);
    return who === "vendor" ? { who, name: tidy(j.name, 20).split(" ")[0], business: tidy(j.business, 40) } : { who, name: "", business: "" };
  } catch { return none; }
}
export async function classifySender(args) { return (await classifySenderDetail(args)).who; }

// The chat is finished (call booked, declined, ...) and the lead writes again. Claude reads the message in context and answers like a
// person would (thanks a number, notes an email, welcomes details, says hello back). Anything needing a person (a question we cannot
// answer from the context, a change to the call, a complaint) comes back as a handover and code sends the holding reply and alerts the team.
// Null means "could not do it safely": the caller hands over too.
export async function draftAfter({ text, name, context = "", shared = {}, greeted = true }) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 300,
        system: "You reply for Saffron Collective, a luxury wedding and event planning firm in Gurugram, on Instagram or WhatsApp. The chat with this lead is already complete; " +
          "what we know and what is booked is given to you. The lead has just written again. Read their message in that context and reply like a warm, polished human planner would, to exactly what they said. " +
          "Examples: if they share a mobile number, thank them and say we have updated it in our records and will use it to reach them if needed. If they share an email, thank them and say it is noted; when the context says the calendar invite went to that email, say we have sent the calendar invite there. " +
          "If they thank us, say they are welcome, and only if a call is booked say we look forward to speaking with them. If they add event details (date, city, guests, occasion, what they want), thank them and say we have added it for our Founders. " +
          "If they just say hi, greet them back and ask if there is anything they would like to share. " +
          "HAND OVER instead of replying (handover \"question\") when they ask anything a person must answer: pricing, availability, what we can or cannot do, or anything you cannot answer from the context. " +
          "Use handover \"change\" when they want to reschedule, cancel or change the call. Also hand over when they are upset, complain, or the message is unclear. " +
          "HARD RULES: never state or hint at any price, fee, package, discount, date, time slot or availability, except the booked call time exactly as given in the context; never invent facts; never promise anything beyond the context; ask at most one question; maximum 45 words; at most one emoji (🌼); reply in their language (English, Hindi or Hinglish); do not greet them unless they greeted. " +
          "Output ONLY JSON: {\"handover\":\"none\"|\"question\"|\"change\",\"reply\":\"...\",\"fields\":{\"date\":null,\"location\":null,\"occasion\":null,\"requirement\":null,\"guests\":null},\"news\":true|false}. " +
          "fields holds only event details they stated in THIS message (null otherwise). news is true when the message holds anything new our team should read.",
        messages: [{ role: "user", content: `Name: ${name || "unknown"}\nWhere we stand: ${context}\nNumber they shared now: ${shared.number || "none"}\nEmail they shared now: ${shared.email || "none"}\nTheir message: ${text}` }],
      }),
    });
    if (!res.ok) return null;
    const p = parseModelJson((await res.json()).content?.[0]?.text);
    if (!p || !["none", "question", "change"].includes(p.handover)) return null;
    const fields = {};
    for (const k of ["date", "location", "occasion", "requirement", "guests"]) {
      const v = p.fields?.[k];
      if ((typeof v === "string" || typeof v === "number") && String(v).trim() && String(v).length <= 80) fields[k] = String(v).trim();
    }
    if (p.handover !== "none") return { handover: p.handover, reply: "", fields: {}, news: false };
    const reply = String(p.reply || "").trim();
    if (!reply || reply.length > 400 || (reply.match(/\?/g) || []).length > 1) return null;
    if (/₹|\brs\.?\s?\d|\binr\b|\d+\s?(k|lakh|lac|crore)\b|\bdiscount\b|\bpackage\b|\bavailab|https?:\/\//i.test(reply)) return null;
    return { handover: "none", reply: reply.replace(/\n{3,}/g, "\n\n"), fields, news: !!p.news || Object.keys(fields).length > 0 };
  } catch { return null; }
}

// A suggested answer to a question the agent could not answer, for the owner to approve in the weekly review (never sent without a Y).
// Only general information about what Saffron does and the website's own pages. Anything about money, dates, availability, discounts or
// commitments comes back as null with a reason, so the owner writes that one herself.
export async function draftSuggestion({ question, pages = [] }) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 300,
        system: "You help the owner of Saffron Collective, a luxury wedding and event planning firm in Gurugram, India (full planning, partial planning, day-of coordination, décor and styling, destination weddings; Delhi NCR and pan-India), " +
          "teach her chat assistant. A lead asked a question the assistant could not answer. Suggest the reply the assistant could give next time, in a warm, polished, human voice, under 60 words, at most one emoji (🌼), no greeting. " +
          "You may only use general facts stated above and, if one fits, point to ONE of these website pages by its exact URL:\n" + pages.map((p) => `${p.title}: ${p.url}`).join("\n") + "\n" +
          "If the question is about price, fees, budget, discount, payment, dates, availability, a specific venue/vendor/person, a booking or contract, a complaint, or anything you are not sure of, do NOT answer: set answer to null and give a short reason for the owner. Never invent facts. " +
          "Output ONLY JSON: {\"answer\": string|null, \"why\": string}.",
        messages: [{ role: "user", content: `Lead's question: ${question}` }],
      }),
    });
    if (!res.ok) return null;
    const p = parseModelJson((await res.json()).content?.[0]?.text);
    if (!p) return null;
    const answer = typeof p.answer === "string" ? p.answer.trim() : "";
    if (!answer) return { answer: null, why: String(p.why || "Needs you").slice(0, 120) };
    const urls = answer.match(/https?:\/\/\S+/g) || [];
    if (answer.length > 420 || /₹|\brs\.?\s?\d|\binr\b|\d+\s?(k|lakh|lac|crore)\b|\bdiscount\b|\bpackage\b|\bavailab|\bfree\b|\bguarantee/i.test(answer) || urls.some((u) => !pages.some((pg) => u.replace(/[.,)]+$/, "") === pg.url))) {
      return { answer: null, why: "A safe suggestion could not be written" };
    }
    return { answer, why: "" };
  } catch { return null; }
}
