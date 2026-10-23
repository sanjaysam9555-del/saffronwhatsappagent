import { GREETING } from "./rules.mjs";
import { greetName } from "./leadfields.mjs";
import { detectLang, HI } from "./lang.mjs";

// WhatsApp question flow for people who message you directly (e.g. from an Instagram ad).
// The number is already known on WhatsApp, so we only ask these, in this order:
// (No contact-number question: on WhatsApp we already have it. No budget question: it puts people off.)
export const ORDER = ["occasion", "date", "location", "guests", "requirement"];
const QUESTION = {
  occasion: "Is this for a wedding, a reception, or another occasion?",
  date: "What date are you planning your event for? An approximate month is fine too.",
  location: "Which city or destination are you considering?",
  guests: "Roughly how many guests are you expecting?",
  requirement: "Would you like help with full planning, decoration only, or both?",
};
const LABEL = { number: "Mobile", occasion: "Occasion", date: "Event date", location: "Location", guests: "Guests", requirement: "Looking for" };

// On Instagram we do not have the number yet, so it is asked first (after answering what they asked).
QUESTION.number = "May I have your mobile number, so we can confirm a few details for the quote/design? Please include the country code if it is outside India.";

// What the lead first asked for, picked from their own words, so the opening answers them ("We would love to help you with the decor.").
const WANTS_DECOR = /\b(d[eé]cor(s|ation|ations|ator|ators)?|styling|mandap|florals?|flowers?|theme)\b/i;
const WANTS_PLAN = /\b(plan(ning|ner|ners)?|organi[sz](e|ing|er)|coordinat(ion|or|ors|ing)|full[\s-]service|manage|management)\b/i;
export function serviceLine(text = "") {
  const d = WANTS_DECOR.test(text), p = WANTS_PLAN.test(text);
  if (d && p) return "We would love to help you with the planning and decor.";
  if (d) return "We would love to help you with the decor.";
  if (p) return "We would love to help you with the planning.";
  return "";
}
// ---- Tidy values: what they typed becomes something clean in the sheet and in the summary we show them. ----
// The sheet's own wording: "Planning", "Only Decoration", "Planning + Decoration". Anything we do not recognise ("still deciding") is kept as typed.
export function normalizeRequirement(text = "") {
  const r = String(text).trim();
  if (!r || /^(pending|not shared)$/i.test(r)) return r;
  if (/both|plan.*d[eé]cor|d[eé]cor.*plan|everything|full|end[\s-]to[\s-]end/i.test(r)) return "Planning + Decoration";
  if (/d[eé]cor/i.test(r)) return "Only Decoration";
  if (/plan/i.test(r)) return "Planning";
  return r;
}
const SERVICE_SHOWN = { "Planning + Decoration": "Planning and Decoration", "Only Decoration": "Decoration only", Planning: "Planning" };
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
const istParts = (now) => { const d = new Date(now + 5.5 * 3600_000); return { y: d.getUTCFullYear(), m: d.getUTCMonth() }; };
// "november next year" -> "November 2027"; "12-13 feb" -> "12-13 Feb 2027"; a date with its own year, or no month, is left as typed.
export function normalizeDate(text = "", now = Date.now()) {
  let d = String(text).replace(/\s+/g, " ").trim();
  if (!d) return d;
  const month = d.match(MONTH_RE);
  if (!month || /\b20\d\d\b/.test(d)) return d.replace(/^./, (c) => c.toUpperCase());
  const { y, m } = istParts(now);
  const nextYear = /\bnext\s+year\b|\bcoming\s+year\b/i.test(d), thisYear = /\bthis\s+year\b/i.test(d);
  const mi = MONTHS.indexOf(month[1].slice(0, 3).toLowerCase());
  const year = nextYear ? y + 1 : thisYear ? y : mi < m ? y + 1 : y;
  d = d.replace(/,?\s*\b(next|this|coming)\s+year\b/i, "").replace(/\s+/g, " ").trim();
  return `${d} ${year}`.replace(/^./, (c) => c.toUpperCase());
}
// A date we cannot use yet ("next year", "winter", "after Diwali", "2027"): asked about once, gently. "Not sure" is accepted as it is.
const UNSURE = /not sure|don'?t know|undecided|tbd|still deciding|haven'?t decided|flexible|yet to|abhi nahi|pata nahi/i;
export function isVagueDate(text = "") {
  const d = String(text);
  if (!d.trim() || UNSURE.test(d) || MONTH_RE.test(d) || /\b\d{1,2}[\/.-]\d{1,2}\b/.test(d)) return false;
  return /next year|this year|coming year|winter|summer|monsoon|season|soon|diwali|holi|after|before|first half|second half|early|late|quarter|\b20\d\d\b|year/i.test(d);
}
const DATE_RETRY = "Noted! Even an approximate month works, for example \"November\". Roughly which month are you thinking of?";
export const showService = (v, lang = "en") => (lang === "hi" && HI.service[v]) || SERVICE_SHOWN[v] || v;

const qText = (lang, k) => (lang === "hi" && HI.q[k]) || QUESTION[k];
export const pendingQuestion = (q) => (q?.asked && qText(q.lang, q.asked)) || "";
export const orderOf = (s) => (s.channel === "instagram" ? ["number", ...ORDER] : ORDER);
const PENDING = /^(pending|not shared)$/i;
const REFUSE = /\b(don'?t want|do not want|won'?t|will not|not comfortable|prefer not|rather not|would not like|wouldn'?t like|not willing|no number|privacy|not sharing|can'?t share)\b/i;
export const CALL_INVITE =
  "To help you better and share the right details for your event, we suggest a quick 20-minute call with our Founders. 🌼\n\nWould you prefer a Google Meet video call or a phone call?";
const DECLINE = /^\s*(no|nope|nah|not now|later|maybe later|not interested|skip)\b/i;

const AFFIRM = /^\s*(yes|yep|yeah|yup|correct|right|confirmed?|ok(ay)?|sure|sahi( hai)?|theek( hai)?|haan|ha|done|all good|looks good|perfect)\b/i;
// A lead asking us something is waiting for a person, not for the next question.
const QUESTIONISH = /\?|^\s*(how|what|why|which|where|when|can you|could you|do you|kya|kitna|kitne|kaise|kyun|kaun)\b/i;

export const newState = (fields = {}, source = "WhatsApp", channel = "whatsapp") => ({
  stage: "new", asked: null, source, notes: "", channel,
  fields: Object.fromEntries(["number", ...ORDER].filter((k) => fields[k]).map((k) => [k, fields[k]])),
});

export const confirmText = (name, fields, ack = "", lang = "en") => {
  const hi = lang === "hi";
  const lines = ["number", ...ORDER].filter((k) => fields[k] && !PENDING.test(fields[k])).map((k) => `• ${hi ? HI.label[k] : LABEL[k]}: ${k === "requirement" ? showService(fields[k], lang) : fields[k]}`).join("\n");
  if (hi) return `${ack ? ack + " Humne yeh details note ki hain:" : HI.confirmHead(greetName(name))}\n\n${lines}\n\n${HI.confirmTail}`;
  return `${ack || `Thank you${greetName(name) ? " " + greetName(name) : ""}!`} Here is what we have noted:\n\n${lines}\n\nPlease confirm if this is correct, or reply with anything you would like to add.\n\nOur planner will then reach out with the next steps.`;
};

// One conversation turn. Pure: returns the new state, a reply, and what happened.
// extracted: optional {date, location, occasion, requirement} pulled out of the message by Claude.
// opener: tailored welcome for the first reply. ack: tailored one-line reaction for every later reply. Both optional; plain defaults otherwise.
// pre: a fixed, published answer (e.g. our starting fees) placed before the next question when they asked about price.
export function advance(q, text, extracted = {}, name = "", opener = "", ack = "", pre = "") {
  const t = String(text).trim();
  const s = { ...q, fields: { ...q.fields } };
  s.lang = detectLang(t, s.lang);
  const hi = s.lang === "hi";

  if (s.stage === "confirm") {
    if (AFFIRM.test(t)) {
      s.stage = "call";
      return { q: s, kind: "confirmed", reply: hi ? `${HI.confirmed}\n\n${HI.callInvite}` : `Thank you for confirming!\n\n${CALL_INVITE}` };
    }
    s.notes = [s.notes, t.slice(0, 300)].filter(Boolean).join(" / ");
    return { q: s, kind: "addition", reply: hi ? HI.addition : `${ack || "Thank you, we have noted this."}\n\nOur planner will review everything and be in touch shortly.` };
  }

  if (s.stage === "call") {
    if (DECLINE.test(t)) {
      s.stage = "done";
      return { q: s, kind: "call-declined", reply: hi ? HI.declined : "No problem at all.\n\nOur planner will be in touch with the next steps. 🌼" };
    }
    const pref = /\b(video|meet|google|online|zoom)\b/i.test(t) ? "meet" : /\b(phone|voice|call me|normal call|regular call|mobile|audio)\b/i.test(t) ? "phone" : null;
    if (pref) {
      s.stage = "done";
      s.callPref = pref;
      return {
        q: s, kind: "call-pref",
        reply: pref === "meet"
          ? "Wonderful!\n\nWe will share a few available times with you shortly, along with the Google Meet link. 🌼"
          : "Wonderful!\n\nWe will share a few available times with you shortly, and our Founders will call you on this number. If you would prefer a different number, just reply with it. 🌼",
      };
    }
    if (QUESTIONISH.test(t)) return { q: s, kind: "escalate" };
    s.callTries = (s.callTries || 0) + 1;
    if (s.callTries >= 2) {
      s.stage = "done";
      s.callPref = "either";
      return { q: s, kind: "call-pref", reply: "Thank you!\n\nOur team will be in touch to arrange a time that suits you. 🌼" };
    }
    return { q: s, kind: "call-ask", reply: hi ? HI.callAsk : "Just to check, would you prefer a Google Meet video call or a phone call?" };
  }

  const firstTurn = s.stage === "new";
  if (!firstTurn && !pre && QUESTIONISH.test(t)) return { q: s, kind: "escalate" };

  const order = orderOf(s);
  // A number shared late (after "later") still counts, wherever in the chat it arrives.
  if (extracted.number && (!s.fields.number || PENDING.test(s.fields.number))) s.fields.number = String(extracted.number).slice(0, 20);
  for (const k of order) if (k !== "number" && extracted[k] && !s.fields[k]) s.fields[k] = String(extracted[k]).slice(0, 80);

  // The mobile number: never taken from free text. Not given yet -> explain once, then move on without pushing.
  let numberNote = "";
  if (!firstTurn && s.asked === "number" && !s.fields.number && !pre) {
    s.numTries = (s.numTries || 0) + 1;
    if (extracted.numberAmbiguous && s.numTries < 2) {
      return { q: s, kind: "ask", reply: "That number looks incomplete. Could you share it with the country code, for example +44 or +91?" };
    }
    if (REFUSE.test(t)) {
      s.fields.number = "Not shared";
      numberNote = "No problem, we will continue right here.";
    } else {
      s.fields.number = "Pending";
      numberNote = "Happy to continue here.\n\nA number simply helps our Founders reach you with exact details. No spam, just one call. You can share it whenever you like. 🌼";
    }
  }
  // Without extraction, a reply to a question we asked is taken as the answer to that question.
  // (Not when they clearly answered something else instead, e.g. a date in reply to "wedding or reception?": the date is kept and the question is asked again.)
  const gaveOther = Object.keys(extracted).some((k) => k !== "number" && k !== "numberAmbiguous" && extracted[k]);
  if (!firstTurn && t && !pre && s.asked && s.asked !== "number" && !s.fields[s.asked] && !GREETING.test(t) && !gaveOther) s.fields[s.asked] = t.slice(0, 80);

  // Tidy what they gave. A date that is too vague to use is asked about once more, gently; the second answer is accepted as it is.
  let retryDate = false;
  if (s.fields.requirement) s.fields.requirement = normalizeRequirement(s.fields.requirement);
  if (s.fields.date) {
    if (!s.dateTried && isVagueDate(s.fields.date)) { s.dateTried = true; delete s.fields.date; retryDate = true; }
    else s.fields.date = normalizeDate(s.fields.date);
  }

  const next = retryDate ? "date" : order.find((k) => !s.fields[k]);
  if (next) {
    s.stage = "asking";
    s.asked = next;
    // A first reply stays short: no links and no extra explanation, just the answer and one question. Links come later, with the summary.
    const brief = firstTurn && pre ? pre.split("\n\n").filter((p) => p.trim() && !/https?:\/\/|explained in detail here/i.test(p)).join("\n\n") : pre;
    const answer = brief ? `${brief}\n\n` : "";
    // Already welcomed a moment ago ("Hi" -> "How can we help you today?"): do not welcome them a second time.
    // If they said what they want (decor, planning), the opening answers it in fixed words. Otherwise the written opener, otherwise the standard one.
    const svc = firstTurn && !brief ? serviceLine(t) : "";
    const standard = s.greeted ? "" : hi ? HI.welcome(greetName(name)) : `Hello${greetName(name) ? " " + greetName(name) : ""}!\n\nThank you for reaching out to Saffron Collective 🌼`;
    const welcome = svc ? [standard, svc].filter(Boolean).join("\n\n") : brief ? standard : opener || standard; // when we are already answering a question, the plain welcome is enough
    const lead = firstTurn
      ? `${welcome ? welcome + "\n\n" : ""}${answer}${hi ? HI.intro + "\n\n" : ""}`
      : `${ack ? ack + "\n\n" : ""}${numberNote ? numberNote + "\n\n" : ""}${answer}`; // later questions stand on their own; a short reaction only when one was written
    return { q: s, kind: "ask", reply: lead + (retryDate ? (hi ? HI.dateRetry : DATE_RETRY) : qText(s.lang, next)) };
  }
  s.stage = "confirm";
  s.asked = null;
  let reply = confirmText(name, s.fields, ack, s.lang);
  // If the number is still missing, one last gentle ask, and never again.
  if (s.channel === "instagram" && PENDING.test(s.fields.number || "") && s.fields.number === "Pending" && !s.numLastAsk) {
    s.numLastAsk = true;
    if (!hi) reply = reply.replace("Our planner will then reach out with the next steps.", "If you are comfortable, you can also share your mobile number here, with the country code if it is outside India.\n\nOur planner will then reach out with the next steps.");
  }
  return { q: s, kind: "summary", reply };
}

// ---- After the conversation is finished (call booked, declined, ...): the lead's later messages are answered by Claude, in context. ----
// What the assistant is told about where the chat stands.
export function doneContext(q) {
  const f = q.fields || {};
  const known = Object.entries(f).filter(([, v]) => v && !PENDING.test(v)).map(([k, v]) => `${LABEL[k] || k}: ${v}`).join("; ") || "nothing yet";
  const call = q.callBooked
    ? `A call with our Founders is booked for ${q.callBooked.label || "the time already confirmed"}${q.callBooked.email ? `; the calendar invite went to ${q.callBooked.email}` : ""}.`
    : q.callPref === "declined" || q.stage === "done" ? "No call is booked yet; our team will be in touch." : "";
  return `${call} Details we hold: ${known}.${q.notes ? ` Notes: ${q.notes}` : ""}`;
}

// Pure: save what the lead just told us. Contact details and event details go into the record; the words go into the notes.
export function applyAfter(q, text, { number = "", email = "", fields = {} } = {}) {
  const s = { ...q, fields: { ...q.fields } };
  const bits = [];
  if (number) { if (s.channel === "instagram") s.fields.number = number; else bits.push(`Another number: ${number}`); }
  if (email) bits.push(`Email: ${email}`);
  for (const k of ORDER) if (fields[k]) { s.fields[k] = String(fields[k]).slice(0, 80); bits.push(`${LABEL[k]} updated: ${s.fields[k]}`); }
  if (!number && !email && !Object.keys(fields).length) bits.push(`Message: ${String(text || "").trim().slice(0, 160)}`);
  s.notes = [s.notes, ...bits].filter(Boolean).join(" / ").slice(0, 400);
  return s;
}

// The one line that restates what we are waiting for, added to a nudge. Fixed wording; the AI never writes the question.
export function nudgeAsk(q) {
  const hi = q?.lang === "hi";
  switch (q?.stage) {
    case "asking": return qText(q.lang, q.asked) || "";
    case "confirm": return hi ? HI.nudgeConfirm : "Just reply \"yes\" if the details we noted are correct, or tell us what you would like to change.";
    case "call": return hi ? HI.callAsk : "Would you prefer a Google Meet video call or a phone call?";
    case "slots": return hi ? HI.nudgeSlots : "Please reply with the number of the time that suits you, or tell us another day and time.";
    case "email": return hi ? HI.nudgeEmail : "Could you share your email address for the calendar invite?";
    default: return "";
  }
}
