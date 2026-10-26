import { fmtIST } from "./calendar.mjs";
import { slotsText } from "./consult.mjs";
import { countryOf } from "./phone.mjs";
import { cleanOccasion, normalizeRequirement, normalizeDate } from "./qualify.mjs";

// Finds Instagram leads who have a call booked (or a time chosen) so the owner can order "send the call confirmation to Darshika".
// Pure: the contacts come in as [{ sid, name, username, q }].
const last10 = (v) => String(v || "").replace(/\D/g, "").slice(-10);
export const waNumber = (v) => {
  const d = String(v || "").replace(/\D/g, "");
  if (/pending|not shared|shared in this chat/i.test(String(v || ""))) return "";
  const full = d.length === 10 ? `91${d}` : d;
  return full.length >= 11 && full.length <= 15 ? full : "";
};

export function callInfo(c, now = Date.now()) {
  const q = c?.q || {};
  const start = q.callBooked?.start || q.chosen || 0;
  const label = q.callBooked?.label || (q.chosen ? `${fmtIST(q.chosen)} IST` : "");
  return {
    sid: c.sid, name: c.name || "", username: c.username || "", number: waNumber(q.fields?.number),
    label, start, sent: Boolean(q.waConfirmSent), past: Boolean(start) && start < now, q,
  };
}

export function matchCalls(contacts, query, now = Date.now()) {
  const text = String(query || "").trim();
  if (!text) return [];
  const digits = text.replace(/\D/g, "");
  const needle = text.replace(/^@/, "").toLowerCase();
  return contacts
    .filter((c) => c?.q)
    .map((c) => callInfo(c, now))
    .filter((m) => digits.length >= 7 ? last10(m.number) === digits.slice(-10) : [m.name, m.username].some((s) => s && String(s).toLowerCase().includes(needle)));
}

// The message that offers new times to a lead who chose one that is no longer free (or never finished choosing).
export function reofferText(slots, number = "", taken = true, apologise = false, note = "") {
  const c = number ? countryOf(number) : { india: true, tz: "" };
  const intro = note ? "Here are a few times for the call (Indian time):"
    : apologise ? `Sorry for the confusion in our last message${taken ? ", and that time was just taken" : ", and thank you for sharing your details"}. Here are a few times for a call with our Founders (Indian time):`
    : taken ? "Sorry, that time was just taken. Here are a few other times (Indian time):"
    : "Thank you for sharing your details. Here are a few times for a call with our Founders (Indian time):";
  return slotsText(slots, c.india ? "" : c.tz, note ? `${String(note).trim().slice(0, 400)}\n\n${intro}` : intro, "en");
}

// Details the owner states about a lead are the truth: they replace what is saved (a lead\'s own words are never overwritten silently, the owner\'s are).
// Returns { fields, changed: ["occasion", ...] }. A number is only replaced when replaceNumber is true.
export function applyOwnerFields(fields = {}, given = {}, { replaceNumber = false } = {}) {
  const out = { ...fields }, changed = [];
  const set = (k, v) => { v = String(v).replace(/\s+/g, " ").trim().slice(0, 80); if (v && out[k] !== v) { out[k] = v; changed.push(k); } };
  if (given.occasion) set("occasion", cleanOccasion(given.occasion) || given.occasion);
  if (given.requirement) set("requirement", normalizeRequirement(given.requirement));
  if (given.date) set("date", normalizeDate(given.date));
  if (given.location) set("location", given.location);
  if (given.guests) set("guests", given.guests);
  const num = waNumber(given.number);
  if (num && (replaceNumber || !waNumber(out.number))) set("number", `+${num}`);
  return { fields: out, changed };
}
