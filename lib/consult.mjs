import { fmtIST, fmtTz, parseRequest, istDayKey, weekdayIn } from "./calendar.mjs";
import { countryOf, extractPhone } from "./phone.mjs";
import { firstName } from "./leadfields.mjs";

// The booking part of the chat, after the lead has chosen a Google Meet or a phone call:
//   call-pref -> offer three times -> they choose -> ask their email -> book -> confirm.
// Pure logic: the calendar itself is passed in as deps { offer(), book(args) }, so this is easy to test.
// States: q.stage "slots" (times offered, waiting for a choice) and "email" (time chosen, waiting for an email address).

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
export const extractEmail = (t) => (String(t || "").match(EMAIL)?.[0] || "").toLowerCase();

const NONE = /\b(none|neither|not available|can'?t make|cannot make|other time|another time|different time|something else|else|later date|some other)\b/i;
const DECLINE = /^\s*(no|nope|nah|not now|maybe later|later|skip|cancel|not interested)\b/i;
const REFUSE_EMAIL = /\b(don'?t|do not|won'?t|no)\s+(want|have|share)\b|prefer not|no email|not comfortable|rather not/i;

const numberOf = (q) => {
  const n = String(q.fields?.number || "");
  return /^\+?\d{8,15}$/.test(n.replace(/\D/g, "")) && !/pending|not shared/i.test(n) ? `+${n.replace(/\D/g, "")}` : "";
};
// Their own time zone, only for leads outside India (Indian leads already see Indian time).
const tzOf = (q, waId) => { const c = countryOf(waId || numberOf(q).replace(/\D/g, "")); return c.india ? "" : c.tz; };

export function slotsText(slots, tz, intro) {
  const lines = slots.map((s, i) => {
    const mine = tz ? fmtTz(s, tz) : "";
    return `${i + 1}. ${fmtIST(s)}${mine ? ` (${mine} for you)` : ""}`;
  });
  return `${intro}\n\n${lines.join("\n")}\n\nReply with the number that suits you, or tell us another day and time. 🌼`;
}

// Which of the offered times did they mean? Returns an index, "none" (nothing suits), or null (unclear).
export function chooseSlot(text, slots, now = Date.now()) {
  const t = String(text || "").trim();
  if (!t) return null;
  const ORD = { first: 0, "1st": 0, second: 1, "2nd": 1, third: 2, "3rd": 2 };
  const word = t.match(/\b(first|1st|second|2nd|third|3rd)\b/i)?.[1]?.toLowerCase();
  if (word) return ORD[word] < slots.length ? ORD[word] : null;
  const clockish = /\b(am|pm)\b/i.test(t) || /\d:\d\d/.test(t) || weekdayIn(t) !== undefined;
  const digit = clockish ? null : t.match(/^\D{0,12}([1-9])\D{0,6}$/);
  if (digit) return Number(digit[1]) <= slots.length ? Number(digit[1]) - 1 : null;
  // A day, date or time in their words: does exactly one of the offered times fit?
  const req = parseRequest(t, now);
  if (req) {
    const mins = (s) => { const d = new Date(s + 5.5 * 3600_000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
    const hits = slots.map((s, i) => i).filter((i) => {
      const s = slots[i];
      if (req.wd !== undefined && new Date(s + 5.5 * 3600_000).getUTCDay() !== req.wd) return false;
      if (req.wd === undefined && req.dayMs !== undefined && istDayKey(s) !== istDayKey(req.dayMs)) return false;
      if (req.explicit && mins(s) !== req.minutes) return false;
      return true;
    });
    if (hits.length === 1) return hits[0];
    if (!hits.length) return "none"; // they named a day or time we did not offer
    return null;
  }
  if (NONE.test(t)) return "none";
  return null;
}

// Offer the first set of times. Returns null if there is nothing to offer (the caller falls back to a person).
export async function startConsult(q, deps) {
  const slots = await deps.offer();
  if (!slots?.length) return null;
  const tz = tzOf(q, deps.waId);
  const intro = q.callPref === "phone"
    ? "Wonderful! Here are a few times for the call with our Founders (Indian time):"
    : "Wonderful! Here are a few times for the Google Meet call with our Founders (Indian time):";
  return { q: { ...q, stage: "slots", slots, tries: 0 }, kind: "slots-offered", reply: slotsText(slots, tz, intro) };
}

// A lead whose very first message asks to talk ("can we connect to discuss...") is offered times straight away: no questions, no price list.
const WANTS_CALL = /\b(call|calls|calling|callback|connect|talk|speak|discuss|discussion|meeting|catch\s?up|schedule|appointment|consultation|zoom|video\s?call|google\s?meet|meet\s(up|you|with|the|your)|baat|baatcheet)\b/i;
export const wantsCall = (t) => WANTS_CALL.test(String(t || ""));

export async function fastTrack(q, { name = "", svc = "", deps }) {
  const slots = await deps.offer();
  if (!slots?.length) return null;
  const standard = q.greeted ? "" : `Hello${name ? " " + firstName(name) : ""}!\n\nThank you for reaching out to Saffron Collective 🌼`;
  const intro = [standard, svc, "Here are a few available slots. Let me know which one works for you and I will schedule a call (Indian time):"].filter(Boolean).join("\n\n");
  return { q: { ...q, stage: "slots", callPref: "meet", slots, tries: 0 }, kind: "slots-offered", reply: slotsText(slots, tzOf(q, deps.waId), intro) };
}

const done = (q, extra = {}) => ({ ...q, stage: "done", ...extra });

export async function consultTurn(q, text, deps) {
  const t = String(text || "").trim();
  const tz = tzOf(q, deps.waId);

  if (q.stage === "slots") {
    if (DECLINE.test(t)) return { q: done(q), kind: "call-declined", reply: "No problem at all.\n\nOur team will be in touch to arrange a time that suits you. 🌼" };
    const pick = chooseSlot(t, q.slots || [], deps.now ? deps.now() : Date.now());
    if (pick === "none") return alternative(q, t, deps, tz);
    if (pick === null) {
      if (/\?/.test(t)) return { q, kind: "escalate", escalate: "lead-question" };
      const tries = (q.tries || 0) + 1;
      if (tries >= 2) return alternative({ ...q, tries: 0 }, t, deps, tz);
      return { q: { ...q, tries }, kind: "slots-ask", reply: "Which one works for you? Please reply with 1, 2 or 3, or tell us another day and time." };
    }
    return choose(q, q.slots[pick], t, tz, deps);
  }

  if (q.stage === "email") {
    const email = extractEmail(t);
    const ph = extractPhone(t);
    const n = { ...q, fields: { ...q.fields } };
    if (ph.status === "ok" && !numberOf(q)) n.fields.number = `+${ph.number}`;
    if (email) return book({ ...n, email }, deps, tz);
    if (REFUSE_EMAIL.test(t)) return book({ ...n, email: "" }, deps, tz);
    const tries = (q.tries || 0) + 1;
    if (tries >= 2) return { q: done(n, { chosenNote: fmtIST(q.chosen) }), kind: "call-needs-invite", escalate: "call-needs-invite", reply: "Thank you!\n\nOur team will send you the invite shortly. 🌼" };
    return { q: { ...n, tries }, kind: "email-ask", reply: "Could you share your email address? It is only to send you the calendar invite." };
  }
  return null;
}

// A time was chosen: confirm it and ask for the email (or book straight away if the email came with it).
function choose(q, chosen, t, tz, deps, lead = "Lovely") {
  const next = { ...q, stage: "email", chosen, tries: 0 };
  const mine = tz ? fmtTz(chosen, tz) : "";
  const when = `${fmtIST(chosen)} IST${mine ? ` (${mine} for you)` : ""}`;
  const needNumber = (q.callPref === "phone" && !numberOf(q)) || !q.fields?.number; // never asked yet (they went straight to booking)
  const email = extractEmail(t);
  if (email) return book({ ...next, email }, deps, tz);
  return { q: next, kind: "email-ask", reply: `${lead}, ${when}.\n\nCould you share your email address${needNumber ? (q.callPref === "phone" ? " and the best number to call you on" : " and your mobile number (with the country code if it is outside India)") : ""}? We will send you the calendar invite with the Google Meet link.` };
}

// They want a time we did not offer: offer times from the day they asked for. Only after a few rounds does a person step in.
async function alternative(q, t, deps, tz) {
  const alt = (q.alt || 0) + 1;
  const toTeam = (reply) => ({ q: done(q, { wantedTime: t.slice(0, 160), alt }), kind: "call-other-time", escalate: "call-time-request", reply });
  if (alt > 3) return toTeam("Of course.\n\nOur team will get back to you shortly with a time that suits you. 🌼");
  const req = parseRequest(t, deps.now ? deps.now() : Date.now());
  if (!req) return { q: { ...q, alt }, kind: "slots-ask", reply: "Of course. Which day and time would suit you best?" };
  let slots = [];
  try { slots = await deps.offer(req); } catch (e) { console.error("offering other times failed:", e.message); return toTeam("Of course.\n\nOur team will get back to you shortly with a time that suits you. 🌼"); }
  const exact = req.exactMs && slots.find((s) => s === req.exactMs);
  if (exact) return choose({ ...q, alt }, exact, "", tz, deps, "Good news, that time is available");
  if (!slots.length) return toTeam("Of course.\n\nOur team will get back to you shortly with a time that suits you. 🌼");
  const onDay = req.dayMs !== undefined && istDayKey(slots[0]) === istDayKey(req.dayMs);
  const intro = onDay ? "Here are the times available around then (Indian time):" : req.dayMs !== undefined ? "We are fully booked on that day. The next available times are (Indian time):" : "Here are the closest times (Indian time):";
  return { q: { ...q, stage: "slots", slots, tries: 0, alt }, kind: "slots-offered", reply: slotsText(slots, tz, intro) };
}

async function book(q, deps, tz) {
  let res;
  try {
    res = await deps.book({ start: q.chosen, email: q.email, pref: q.callPref || "meet", phone: numberOf(q), fields: q.fields });
  } catch (e) {
    console.error("calendar booking failed:", e.message);
    return { q: done(q, { chosenNote: fmtIST(q.chosen) }), kind: "call-booking-failed", escalate: "call-booking-failed", error: e.message, reply: "Thank you!\n\nOur team will confirm the time and send you the invite shortly. 🌼" };
  }
  if (!res.ok && res.taken) {
    let slots = [];
    try { slots = await deps.offer(); } catch { /* fall through to a person */ }
    if (!slots.length) return { q: done(q, { chosenNote: fmtIST(q.chosen) }), kind: "call-booking-failed", escalate: "call-booking-failed", reply: "Sorry, that time was just taken.\n\nOur team will get back to you shortly with another time. 🌼" };
    return { q: { ...q, stage: "slots", slots, tries: 0, chosen: undefined }, kind: "slots-offered", reply: slotsText(slots, tz, "Sorry, that time was just taken. Here are a few other times (Indian time):") };
  }
  const mine = tz ? fmtTz(q.chosen, tz) : "";
  const when = `${fmtIST(q.chosen)} IST${mine ? ` (${mine} for you)` : ""}`;
  const number = numberOf(q);
  const parts = [`All set! Your call with our Founders is booked for ${when}.`];
  if (q.callPref === "phone") parts.push(number ? `Our Founders will call you on ${number}.` : "Our Founders will call you at that time.");
  if (q.email) parts.push(`We have sent a calendar invite to ${q.email}.`);
  else if (res.meetLink) parts.push(`Here is the Google Meet link:\n${res.meetLink}`);
  parts.push("We look forward to speaking with you. 🌼");
  return { q: done(q, { callBooked: { start: q.chosen, email: q.email || "", meetLink: res.meetLink || "", label: when } }), kind: "call-booked", booked: { start: q.chosen, label: when }, reply: parts.join("\n\n") };
}

// What we know about the event, for the calendar invite.
export function detailsText(f = {}) {
  const L = { occasion: "Occasion", date: "Event date", location: "Location", guests: "Guests", requirement: "Looking for" };
  return Object.entries(L).filter(([k]) => f[k]).map(([k, label]) => `${label}: ${f[k]}`).join("\n");
}
