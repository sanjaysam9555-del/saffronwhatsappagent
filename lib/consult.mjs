import { fmtIST, fmtTz, parseRequest, istDayKey, weekdayIn } from "./calendar.mjs";
import { countryOf, extractPhone } from "./phone.mjs";
import { greetName, welcomeText } from "./leadfields.mjs";
import { detectLang, HI } from "./lang.mjs";

// The booking part of the chat, after the lead has chosen a Google Meet or a phone call:
//   call-pref -> offer three times -> they choose -> ask their email -> book -> confirm.
// Pure logic: the calendar itself is passed in as deps { offer(), book(args) }, so this is easy to test.
// States: q.stage "slots" (times offered, waiting for a choice) and "email" (time chosen, waiting for an email address).

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
export const extractEmail = (t) => (String(t || "").match(EMAIL)?.[0] || "").toLowerCase();

const NONE = /\b(none|neither|not available|can'?t make|cannot make|other times?|another time|different time|something else|else|later date|some other|other days?|another day|different days?|other dates?|more options|more slots|other slots|any other)\b/i;
// "Is that IST?", "which time zone", "my time?": a question we can answer from the list itself.
const TZ_Q = /\b(ist|indian (standard )?time|india time|time ?zone|timezone|my time|my local|local time|which time|what time zone|gmt|utc|est|pst|gst|uk time|us time)\b/i;
const DECLINE = /^\s*(no|nope|nah|not now|maybe later|later|skip|cancel|not interested)\b/i;
const REFUSE_EMAIL = /\b(don'?t|do not|won'?t|no)\s+(want|have|share)\b|prefer not|no email|not comfortable|rather not/i;

const numberOf = (q) => {
  const n = String(q.fields?.number || "");
  return /^\+?\d{8,15}$/.test(n.replace(/\D/g, "")) && !/pending|not shared/i.test(n) ? `+${n.replace(/\D/g, "")}` : "";
};
// Their own time zone, only for leads outside India (Indian leads already see Indian time).
const tzOf = (q, waId) => { const c = countryOf(waId || numberOf(q).replace(/\D/g, "")); return c.india ? "" : c.tz; };

export function slotsText(slots, tz, intro, lang = "en") {
  const lines = slots.map((s, i) => {
    const mine = tz ? fmtTz(s, tz) : "";
    return `${i + 1}. ${fmtIST(s)}${mine ? ` (${mine} for you)` : ""}`;
  });
  return `${intro}\n\n${lines.join("\n")}\n\n${lang === "hi" ? HI.slotsFoot : "Reply with the number that suits you, or tell us another day and time. 🌼"}`;
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
  const hi = q.lang === "hi";
  const intro = q.callPref === "phone"
    ? (hi ? HI.introPhone : "Wonderful! Here are a few times for the call with our Founders (Indian time):")
    : (hi ? HI.introMeet : "Wonderful! Here are a few times for the Google Meet call with our Founders (Indian time):");
  return { q: { ...q, stage: "slots", slots, tries: 0 }, kind: "slots-offered", reply: slotsText(slots, tz, intro, q.lang) };
}

// A lead whose very first message asks to talk ("can we connect to discuss...") is offered times straight away: no questions, no price list.
const WANTS_CALL = /\b(call|calls|calling|callback|connect|talk|speak|discuss|discussion|meeting|catch\s?up|schedule|appointment|consultation|zoom|video\s?call|google\s?meet|meet\s(up|you|with|the|your)|baat|baatcheet)\b/i;
export const wantsCall = (t) => WANTS_CALL.test(String(t || ""));

export async function fastTrack(q, { name = "", svc = "", deps }) {
  const slots = await deps.offer();
  if (!slots?.length) return null;
  const hi = q.lang === "hi";
  const standard = q.greeted ? "" : hi ? HI.welcome(greetName(name)) : welcomeText(name);
  const intro = [standard, hi ? "" : svc, hi ? "Yeh kuch available slots hain. Jo aapko suit kare bataiye, hum call schedule kar denge (Indian time):" : "Here are a few available slots. Let me know which one works for you and I will schedule a call (Indian time):"].filter(Boolean).join("\n\n");
  return { q: { ...q, stage: "slots", callPref: "meet", slots, tries: 0 }, kind: "slots-offered", reply: slotsText(slots, tzOf(q, deps.waId), intro, q.lang) };
}

const done = (q, extra = {}) => ({ ...q, stage: "done", ...extra });

export async function consultTurn(q0, text, deps) {
  const t = String(text || "").trim();
  const q = { ...q0, lang: detectLang(t, q0.lang) };
  const hi = q.lang === "hi";
  const tz = tzOf(q, deps.waId);

  if (q.stage === "slots") {
    if (q.reschedule && DECLINE.test(t)) {
      const { reschedule, ...keep } = q;
      return { q: done(keep), kind: "reschedule-dropped", reply: hi ? `Theek hai, aapki call ${reschedule.from} par hi rahegi. 🌼` : `No problem, your call stays as planned for ${reschedule.from}. 🌼` };
    }
    if (DECLINE.test(t)) return { q: done(q), kind: "call-declined", reply: hi ? "Koi baat nahi.\n\nHamari team aapke liye suitable time arrange karne ke liye sampark karegi. 🌼" : "No problem at all.\n\nOur team will be in touch to arrange a time that suits you. 🌼" };
    const pick = chooseSlot(t, q.slots || [], deps.now ? deps.now() : Date.now());
    if (pick === "none") return alternative(q, t, deps, tz);
    if (pick === null && TZ_Q.test(t) && (/\?/.test(t) || /\bis\b|\bwhich\b|\bwhat\b/i.test(t))) {
      const intro = hi ? HI.tzYes : tz ? "Yes, these are Indian Standard Time (IST). I have added your local time next to each one:" : "Yes, all of these are in Indian Standard Time (IST). Here they are again:";
      return { q, kind: "slots-info", reply: slotsText(q.slots || [], tz, intro, q.lang) };
    }
    if (pick === null) {
      if (/\?/.test(t)) return { q, kind: "escalate", escalate: "lead-question" };
      const tries = (q.tries || 0) + 1;
      if (tries >= 2) return alternative({ ...q, tries: 0 }, t, deps, tz);
      return { q: { ...q, tries }, kind: "slots-ask", reply: hi ? HI.slotsAsk : "Which one works for you? Please reply with 1, 2 or 3, or tell us another day and time." };
    }
    return choose(q, q.slots[pick], t, tz, deps);
  }

  if (q.stage === "email") {
    // They were asked once (for an email, or for a number when a phone call has none). We never insist: whatever they reply, if we can reach
    // them the call is booked, and the details go to them in the chat and on WhatsApp.
    const email = extractEmail(t) || q.email || "";
    const ph = extractPhone(t);
    const n = { ...q, fields: { ...q.fields }, email };
    if (ph.status === "ok" && !numberOf(q)) n.fields.number = `+${ph.number}`;
    const number = numberOf(n);
    if (q.callPref === "phone") {
      if (number) return book(n, deps, tz);                                  // their number is what matters; an email is a bonus
      if (email) return book({ ...n, needsNumber: true }, deps, tz);         // no number to call: booked anyway, and a person gets the number
    } else {
      if (email || number) return book(n, deps, tz);                         // the invite goes to the email, otherwise the details go to their number
      if (REFUSE_EMAIL.test(t)) return book({ ...n, email: "" }, deps, tz);  // nothing to send to: the Meet link is shown in this chat
    }
    const tries = (q.tries || 0) + 1;
    if (tries >= 2) return { q: done(n, { chosenNote: fmtIST(q.chosen) }), kind: "call-needs-invite", escalate: "call-needs-invite", reply: hi ? "Shukriya!\n\nHamari team aapko jald hi invite bhej degi. 🌼" : "Thank you!\n\nOur team will send you the invite shortly. 🌼" };
    return { q: { ...n, tries }, kind: "email-ask", reply: hi ? HI.emailAsk : (ph.status === "ambiguous" ? "That number looks incomplete. Could you share the full mobile number?\n\nNote: Please include the country code if it is outside India." : contactAsk(n)) };
  }
  return null;
}

// A time was chosen: confirm it and ask for the email (or book straight away if the email came with it).
function choose(q, chosen, t, tz, deps, lead = "Lovely") {
  if (q.reschedule) return move(q, chosen, deps, tz);
  const next = { ...q, stage: "email", chosen, tries: 0 };
  const mine = tz ? fmtTz(chosen, tz) : "";
  const when = `${fmtIST(chosen)} IST${mine ? ` (${mine} for you)` : ""}`;
  const email = extractEmail(t) || q.email || "";
  // An email is asked for once (it is only for the calendar invite). A phone call cannot happen without their number, so that is asked for instead.
  if (canBook({ ...next, email })) return book({ ...next, email }, deps, tz);
  if (q.lang === "hi") {
    const extra = numberOf(q) ? "" : q.callPref === "phone" ? " aur call ke liye best number" : " aur apna mobile number (India ke bahar ka ho to country code ke saath)";
    return { q: { ...next, email }, kind: "email-ask", reply: HI.chosen(when, extra) };
  }
  return { q: { ...next, email }, kind: "email-ask", reply: `${lead}, ${when}.\n\n${contactAsk({ ...q, email })}` };
}

// An email (the calendar invite) books a video call, and a phone call needs the number. Without an email we ask once; see the "email" stage.
const canBook = (q) => (q.callPref === "phone" ? Boolean(numberOf(q)) && Boolean(q.email) : Boolean(q.email));
const contactAsk = (q) => {
  const n = numberOf(q);
  if (q.callPref === "phone" && !n) return "Could you share the best number to call you on?\n\nNote: Please include the country code if it is outside India.";
  if (q.callPref === "phone") return "Could you share your email address? It is only to send you the calendar invite.";
  if (n) return "Could you share your email address? It is only to send you the calendar invite.";
  return "Could you share your email address or mobile number? We will send you the call details there.\n\nNote: Please include the country code if it is outside India.";
};

// They want a time we did not offer: offer times from the day they asked for. Only after a few rounds does a person step in.
async function alternative(q, t, deps, tz) {
  const alt = (q.alt || 0) + 1;
  const hi = q.lang === "hi";
  const toTeamText = hi ? "Zaroor.\n\nHamari team jald hi aapko suitable time ke saath sampark karegi. 🌼" : "Of course.\n\nOur team will get back to you shortly with a time that suits you. 🌼";
  const toTeam = (reply) => ({ q: done(q, { wantedTime: t.slice(0, 160), alt }), kind: "call-other-time", escalate: "call-time-request", reply: hi ? toTeamText : reply });
  if (alt > 3) return toTeam("Of course.\n\nOur team will get back to you shortly with a time that suits you. 🌼");
  let req = parseRequest(t, deps.now ? deps.now() : Date.now());
  let more = false;
  if (!req && q.slots?.length && NONE.test(t)) { req = { dayMs: q.slots.at(-1) + 86_400_000 }; more = true; } // "any other day?": show what comes after what we already offered
  if (!req) return { q: { ...q, alt }, kind: "slots-ask", reply: hi ? HI.whichDay : "Of course. Which day and time would suit you best?" };
  let slots = [];
  try { slots = await deps.offer(req); } catch (e) { console.error("offering other times failed:", e.message); return toTeam("Of course.\n\nOur team will get back to you shortly with a time that suits you. 🌼"); }
  const exact = req.exactMs && slots.find((s) => s === req.exactMs);
  if (exact) return choose({ ...q, alt }, exact, "", tz, deps, "Good news, that time is available");
  if (!slots.length) return toTeam("Of course.\n\nOur team will get back to you shortly with a time that suits you. 🌼");
  const onDay = req.dayMs !== undefined && istDayKey(slots[0]) === istDayKey(req.dayMs);
  const intro = hi
    ? (more ? HI.more : onDay ? HI.around : HI.noDay)
    : more ? "Of course! Here are a few more options (Indian time):" : onDay ? "Here are the times available around then (Indian time):" : req.dayMs !== undefined ? "We do not have an opening on that day. The next available times are (Indian time):" : "Here are the closest times (Indian time):";
  return { q: { ...q, stage: "slots", slots, tries: 0, alt }, kind: "slots-offered", reply: slotsText(slots, tz, intro, q.lang) };
}

async function book(q, deps, tz) {
  let res;
  try {
    res = await deps.book({ start: q.chosen, email: q.email, pref: q.callPref || "meet", phone: numberOf(q), fields: q.fields, eventId: q.callBooked?.eventId || "" });
  } catch (e) {
    console.error("calendar booking failed:", e.message);
    return { q: done(q, { chosenNote: fmtIST(q.chosen) }), kind: "call-booking-failed", escalate: "call-booking-failed", error: e.message, reply: q.lang === "hi" ? "Shukriya!\n\nHamari team time confirm karke aapko jald hi invite bhej degi. 🌼" : "Thank you!\n\nOur team will confirm the time and send you the invite shortly. 🌼" };
  }
  if (!res.ok && res.taken) {
    let slots = [];
    try { slots = await deps.offer(); } catch { /* fall through to a person */ }
    if (!slots.length) return { q: done(q, { chosenNote: fmtIST(q.chosen) }), kind: "call-booking-failed", escalate: "call-booking-failed", reply: q.lang === "hi" ? "Maaf kijiye, wo time abhi abhi book ho gaya.\n\nHamari team jald hi dusra time lekar aapse sampark karegi. 🌼" : "Sorry, that time was just taken.\n\nOur team will get back to you shortly with another time. 🌼" };
    return { q: { ...q, stage: "slots", slots, tries: 0, chosen: undefined }, kind: "slots-offered", reply: slotsText(slots, tz, q.lang === "hi" ? "Maaf kijiye, wo time abhi abhi book ho gaya. Yeh kuch aur times hain (Indian time):" : "Sorry, that time was just taken. Here are a few other times (Indian time):", q.lang) };
  }
  const mine = tz ? fmtTz(q.chosen, tz) : "";
  const when = `${fmtIST(q.chosen)} IST${mine ? ` (${mine} for you)` : ""}`;
  const number = numberOf(q);
  const hi = q.lang === "hi";
  const parts = [hi ? HI.bookedHead(when) : `All set! Your call with our Founders is booked for ${when}.`];
  if (q.callPref === "phone") parts.push(hi ? HI.willCall(number) : number ? `They will call you on ${number}.` : "They will call you at that time.");
  if (q.email) parts.push(hi ? HI.invited(q.email) : `We have sent a calendar invite to ${q.email}.`);
  else if (res.meetLink && q.callPref !== "phone") parts.push(hi ? HI.meetLink(res.meetLink) : `Here is the Google Meet link:\n${res.meetLink}`);
  // No email: the details go to them on WhatsApp (their number is the other way to reach them), when that message is set up.
  if (!q.email && number && q.channel === "instagram" && process.env.CALL_TEMPLATE_NAME && !hi) parts.push(`We will also share the call details with you on WhatsApp (${number}).`);
  parts.push(hi ? HI.bookedTail : "We look forward to speaking with you. 🌼");
  return { q: done(q, { callBooked: { start: q.chosen, email: q.email || "", meetLink: res.meetLink || "", label: when, eventId: res.eventId || "", pref: q.callPref || "meet" } }), kind: "call-booked", booked: { start: q.chosen, label: when, eventId: res.eventId || "" }, reply: parts.join("\n\n"), ...(q.needsNumber && !number ? { escalate: "call-needs-number" } : {}) };
}

// A call is already booked and the lead now sends the email (or number) we did not have: add it to the SAME calendar event
// (the guest gets the invite; the number goes in its notes). Never creates a second event. Never throws.
// Returns { q, added } where q.callBooked.email is set once the invite has gone out.
export async function addLateContact(q, { email = "", number = "" } = {}, deps = {}) {
  const cb = q?.callBooked;
  const newEmail = email && email.toLowerCase() !== String(cb?.email || "").toLowerCase() ? email : "";
  if (!cb?.eventId || !deps.addGuest || (!newEmail && !number)) return { q, added: false };
  try {
    const r = await deps.addGuest({ eventId: cb.eventId, start: cb.start, email: newEmail, phone: number || numberOf(q) });
    if (!r?.ok) return { q, added: false, missing: true };
    return { q: newEmail ? { ...q, callBooked: { ...cb, email: newEmail } } : q, added: Boolean(newEmail) };
  } catch (e) {
    console.error("adding the guest to the booked call failed:", e.message);
    return { q, added: false, error: e.message };
  }
}

// What we know about the event, for the calendar invite.
export function detailsText(f = {}) {
  const L = { occasion: "Occasion", date: "Event date", location: "Location", guests: "Guests", requirement: "Looking for" };
  return Object.entries(L).filter(([k]) => f[k]).map(([k, label]) => `${label}: ${f[k]}`).join("\n");
}

// ---- Moving a call that is already booked ----
const RESCHEDULE = /\b(re-?schedul\w*|postpone\w*|prepone\w*|change (the |my |our )?(time|slot|timing|day|date)|different (time|slot|day)|another (time|slot|day)|move (the |my |our )?(call|meeting|slot)|can'?t make (it|the call|that)|cannot make (it|the call|that)|unable to (make|attend)|not available (at|for) (that|the)|time badal|dusra time|alag time)\b/i;
export const wantsReschedule = (t) => RESCHEDULE.test(String(t || ""));
const CANCEL = /\b(cancel|cancell?ed|call off|not interested anymore|no longer)\b/i;
export const wantsCancel = (t) => CANCEL.test(String(t || ""));

// A lead with a booked call asks for another time: offer new times (or the day they named) and move the same event.
export async function startReschedule(q, text, deps) {
  if (!q.callBooked?.eventId || !deps.move) return null;
  const now = deps.now ? deps.now() : Date.now();
  const req = parseRequest(text, now);
  let slots = [];
  try { slots = await deps.offer(req || undefined); } catch (e) { console.error("offering times to move a call failed:", e.message); return null; }
  if (!slots.length) return null;
  const tz = tzOf(q, deps.waId);
  const hi = q.lang === "hi";
  const intro = hi ? "Zaroor! Call ke liye yeh naye times available hain (Indian time):" : "Of course! Here are a few other times for your call (Indian time):";
  return { q: { ...q, stage: "slots", slots, tries: 0, alt: 0, reschedule: { eventId: q.callBooked.eventId, from: q.callBooked.label, fromStart: q.callBooked.start } }, kind: "reschedule-offered", reply: slotsText(slots, tz, intro, q.lang) };
}

async function move(q, chosen, deps, tz) {
  const hi = q.lang === "hi";
  const { reschedule, ...rest } = q;
  const mine = tz ? fmtTz(chosen, tz) : "";
  const when = `${fmtIST(chosen)} IST${mine ? ` (${mine} for you)` : ""}`;
  const handOver = (reply) => ({ q: done(q, { wantedTime: fmtIST(chosen), reschedule: undefined }), kind: "call-other-time", escalate: "call-time-request", reply });
  let res;
  try { res = await deps.move({ eventId: reschedule.eventId, start: chosen }); } catch (e) {
    console.error("moving the call failed:", e.message);
    return handOver(hi ? "Shukriya!\n\nHamari team time badalkar aapko jald hi confirm karegi. 🌼" : "Thank you!\n\nOur team will move the call to that time and confirm it with you shortly. 🌼");
  }
  if (!res.ok) {
    let slots = [];
    try { slots = await deps.offer(); } catch { /* a person */ }
    if (!slots.length) return handOver(hi ? "Maaf kijiye, wo time abhi book ho gaya.\n\nHamari team aapko jald hi naya time batayegi. 🌼" : "Sorry, that time was just taken.\n\nOur team will get back to you shortly with another time. 🌼");
    return { q: { ...q, slots, tries: 0 }, kind: "slots-offered", reply: slotsText(slots, tz, hi ? "Maaf kijiye, wo time abhi book ho gaya. Yeh kuch aur times hain (Indian time):" : "Sorry, that time was just taken. Here are a few other times (Indian time):", q.lang) };
  }
  const booked = { ...(q.callBooked || {}), start: chosen, label: when };
  return {
    q: done(rest, { callBooked: booked, notes: [q.notes, `Call moved to ${when} (was ${reschedule.from})`].filter(Boolean).join(" / ").slice(0, 400) }),
    kind: "call-moved", moved: { start: chosen, label: when, from: reschedule.from, eventId: reschedule.eventId },
    reply: hi ? `Ho gaya! Aapki call ab ${when} par hai. Updated calendar invite aapko jald hi mil jayega. 🌼` : `All done! Your call has been moved to ${when}.\n\nThe updated calendar invite will reach you shortly. We look forward to speaking with you. 🌼`,
  };
}
