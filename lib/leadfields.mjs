import { normalizePhone } from "./phone.mjs";
import { SENSITIVE } from "./rules.mjs";

// Leads sheet columns (0-based). A..M exist today; N,O are written by the agent;
// P = ManyChat "last message" text, Q = ManyChat subscriber id (add both via ManyChat's Google Sheets action), R = Priority (HOT / WARM, written by the agent).
export const COL = {
  name: 0, mobile: 1, location: 2, date: 3, occasion: 4, requirement: 5, source: 6,
  psId: 11, status: 13, lastMsg: 15, mcId: 16, priority: 17,
};

// The order ManyChat asks in: date, location, number, then the rest.
export const FLOW = [
  { key: "date", col: COL.date, label: "event date", q: "What date are you planning your event for? An approximate month is fine too." },
  { key: "location", col: COL.location, label: "location", q: "Which city or destination are you considering?" },
  { key: "number", col: COL.mobile, label: "WhatsApp number", q: "What is the best WhatsApp number to reach you on?" },
  { key: "occasion", col: COL.occasion, label: "occasion", q: "Is this for a wedding, a reception, or another occasion?" },
  { key: "requirement", col: COL.requirement, label: "what you need from us", q: "Would you like help with planning, decoration, or both?" },
];

const blank = (v) => !String(v ?? "").trim();
export const clean = (v) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, 80) : null;
};
export const joinList = (l) => (l.length > 1 ? l.slice(0, -1).join(", ") + " and " + l.at(-1) : l[0] || "");
export const firstName = (name) => (clean(name) || "there").split(" ")[0];

// The name to greet someone by: their first name when the profile name looks like a person, otherwise "" (so we say "Hello!" and never
// "Thank you Planning!"). Business pages, handles and single letters are skipped.
const NOT_A_PERSON = /\b(studios?|events?|planning|planners?|d[eé]cors?|official|weddings?|photograph\w*|designs?|designers?|productions?|films?|creations?|entertainment|catering|caterers?|jewel\w*|boutique|store|shop|travels?|rentals?|cars?|agency|company|co|pvt|ltd|llp|india|collective|team|page|world|hub|club|media|digital|fashion|makeup|mua|artist|vendor|services?|solutions?|enterprises?|traders?|house|palace|resort|hotel|farms?|banquets?|gallery|labs?)\b/i;
const TITLE = /^(dr|mr|mrs|ms|miss|mx|prof|professor|er|ca|cs|adv|advocate|capt|captain|col|maj|ar|shri|shree|smt|sri|sir|madam)\.?\s+/i;
export function greetName(name) {
  const raw = String(name ?? "").normalize("NFKC");
  if (/[0-9_@]/.test(raw)) return "";
  let n = raw.replace(/^[^\p{L}]+/u, "").replace(/\s+/g, " ").trim();
  while (TITLE.test(n)) n = n.replace(TITLE, "");
  if (TITLE.test(n + " ")) return ""; // nothing but a title // "Dr. Shivani Bhardwaj" is greeted as Shivani, never "Dr"
  if (!n || NOT_A_PERSON.test(n)) return "";
  const first = n.split(" ")[0].replace(/[^\p{L}'’-]/gu, "");
  if (first.length < 2 || first.length > 20) return "";
  if (!/\s/.test(n) && first.length > 10 && first === first.toLowerCase()) return ""; // one long lowercase word is a handle
  return first === first.toLowerCase() || first === first.toUpperCase() ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : first;
}

// A blank cell is "not answered". Any answer counts, including "still deciding" or "none".
export function missingFields(row) {
  return FLOW.filter((f) => (f.key === "number" ? !normalizePhone(row[COL.mobile]) : blank(row[f.col])));
}

export const rowFields = (row) => ({
  date: clean(row[COL.date]), location: clean(row[COL.location]),
  occasion: clean(row[COL.occasion]), requirement: clean(row[COL.requirement]),
});

// Values for the lead_followup_v1 template, one per line of the message: Name, Event, Date, Location, Service Required.
// Template variables can't be empty or contain line breaks, so blanks become "Not provided".
const tv = (x) => String(x ?? "").replace(/\s+/g, " ").trim() || "Not provided";
export function confirmParams(name, f) {
  const given = String(name ?? "").replace(/\s+/g, " ").trim();
  return {
    first_name: given.split(" ")[0] || "there", full_name: tv(name), event: tv(f.occasion),
    event_date: tv(f.date), location: tv(f.location), service: tv(f.requirement),
  };
}

// What they asked for, in words for a message ("Both" -> "Planning and Decoration").
export function serviceWords(req) {
  const r = String(req || "");
  if (!r.trim() || /^(pending|not shared)$/i.test(r.trim())) return "";
  if (/both|plan.*d[eé]cor|d[eé]cor.*plan|everything|full/i.test(r)) return "Planning and Decoration";
  if (/d[eé]cor/i.test(r)) return "Decoration";
  if (/plan/i.test(r)) return "Planning";
  return r.trim();
}

// Values for the call_booked_v1 template (sent on WhatsApp once a call is booked and we hold their number).
export function callBookedParams(name, f, when, reading) {
  return {
    first_name: String(clean(name) || "there").split(" ")[0], occasion: tv(f.occasion), event_date: tv(f.date),
    location: tv(f.location), guests: tv(f.guests), service: tv(serviceWords(f.requirement)), call_time: tv(when),
    reading_title: tv(reading?.title), reading_link: tv(reading?.url),
  };
}

// One line, no line breaks: WhatsApp template variables can't contain them.
export function summaryLine(f) {
  return [
    f.occasion && `Occasion: ${f.occasion}`, f.date && `Date: ${f.date}`,
    f.location && `Location: ${f.location}`, f.requirement && `Looking for: ${f.requirement}`,
  ].filter(Boolean).join(" | ");
}

// A lead who typed a sentence where a number was expected, or whose last message is a question,
// is waiting for a human answer, not another prompt.
function findQuestion(row, waId) {
  const cell = String(row[COL.mobile] ?? "").trim();
  const words = cell.split(/\s+/).filter((w) => /[A-Za-zऀ-ॿ]{2,}/.test(w));
  if (!waId && words.length >= 3 && cell.split(/\s+/).length >= 4) return cell;
  const last = String(row[COL.lastMsg] ?? "").trim();
  if (last && (/\?\s*$/.test(last) || /^(how|what|where|when|can|could|do|is|are|kya|kitna|kaha|kahan)\b/i.test(last))) return last;
  return null;
}

export function assess(row) {
  const waId = normalizePhone(row[COL.mobile]);
  const missing = missingFields(row);
  const question = findQuestion(row, waId);
  return {
    waId, missing, question,
    complete: missing.length === 0 && !question,
    priority: question && SENSITIVE.test(question) ? "URGENT" : "NORMAL",
  };
}

export const igNudgeText = (row, a) =>
  `Hi ${firstName(row[COL.name])}! Just checking in 🌼 ${a.missing[0]?.q || "Is there anything you would like to add?"}`;

// For the team to send by hand from the Instagram inbox (outside Meta's 24h automation window).
export function suggestNudge(row, a) {
  const labels = joinList(a.missing.map((m) => m.label));
  const ask = a.missing.length ? ` Also, could you share your ${labels}?` : "";
  if (a.question) return `Hi ${firstName(row[COL.name])}! Thanks for asking 🌼 [ANSWER THEIR QUESTION: "${a.question.slice(0, 100)}"]${ask}`;
  return `Hi ${firstName(row[COL.name])}! Thanks for reaching out to Saffron Collective 🌼 To help our planner prepare, could you share your ${labels}?`;
}
