import { fmtIST } from "./calendar.mjs";
import { slotsText } from "./consult.mjs";
import { countryOf } from "./phone.mjs";

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
export function reofferText(slots, number = "", taken = true) {
  const c = number ? countryOf(number) : { india: true, tz: "" };
  const intro = taken ? "Sorry, that time was just taken. Here are a few other times (Indian time):" : "Thank you for sharing your details! 🌼 Here are a few times for a call with our Founders (Indian time):";
  return slotsText(slots, c.india ? "" : c.tz, intro, "en");
}
