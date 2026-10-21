import { normalizePhone } from "./phone.mjs";
import { SENSITIVE } from "./rules.mjs";

// Leads sheet columns (0-based). A..M exist today; N,O are written by the agent;
// P = ManyChat "last message" text, Q = ManyChat subscriber id (add both via ManyChat's Google Sheets action).
export const COL = {
  name: 0, mobile: 1, location: 2, date: 3, occasion: 4, requirement: 5, source: 6,
  psId: 11, status: 13, lastMsg: 15, mcId: 16,
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
  return [given.split(" ")[0] || "there", tv(name), tv(f.occasion), tv(f.date), tv(f.location), tv(f.requirement)];
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
