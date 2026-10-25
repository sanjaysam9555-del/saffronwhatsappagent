// Lead phone cells are messy ("8287469294, please whatsapp me", "31 Jan", "+15483337252").
// Returns digits with country code (e.g. "919876543210") or null if no confident number.
export function normalizePhone(raw) {
  if (!raw) return null;
  const s = String(raw);

  const intl = s.match(/\+\s?(\d[\d\s-]{8,16}\d)/);
  if (intl) {
    const d = intl[1].replace(/\D/g, "");
    return d.length >= 10 && d.length <= 15 ? d : null;
  }

  const token = s.match(/\d[\d\s-]{8,}\d/);
  if (!token) return null;
  const d = token[0].replace(/\D/g, "");

  if (d.length === 10 && /^[6-9]/.test(d)) return "91" + d;
  if (d.length === 11 && d.startsWith("0") && /^[6-9]/.test(d[1])) return "91" + d.slice(1);
  if (d.length === 12 && d.startsWith("91") && /^[6-9]/.test(d[2])) return d;
  return null; // ambiguous (e.g. 12 digits not starting 91): leave for a human
}

// Webhook waId is digits with country code; compare on last 10 digits.
export const sameNumber = (a, b) => a && b && a.slice(-10) === b.slice(-10);

// Country of a WhatsApp number (digits with country code), for the team's notes and call timing.
const COUNTRIES = [
  ["971", "UAE", "Asia/Dubai"], ["353", "Ireland", "Europe/Dublin"], ["91", "India", "Asia/Kolkata"],
  ["61", "Australia", "Australia/Sydney"], ["44", "UK", "Europe/London"], ["65", "Singapore", "Asia/Singapore"],
  ["49", "Germany", "Europe/Berlin"], ["33", "France", "Europe/Paris"], ["64", "New Zealand", "Pacific/Auckland"],
  ["27", "South Africa", "Africa/Johannesburg"], ["1", "US/Canada", "America/New_York"],
];
export function countryOf(waId) {
  const d = String(waId || "").replace(/\D/g, "");
  const c = COUNTRIES.find(([code]) => d.startsWith(code));
  return c ? { code: c[0], name: c[1], tz: c[2], india: c[0] === "91" } : { code: "", name: "", tz: "", india: false };
}
// "Mon 14:05" in their time zone, for the team to see before calling.
export function theirTime(waId, now = new Date()) {
  const { tz } = countryOf(waId);
  if (!tz) return "";
  try { return now.toLocaleString("en-GB", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
}

// A number a lead types in a message, from any country. Returns { status, number }:
//  ok        -> number is digits with country code ("447911123456")
//  ambiguous -> looks like a phone number but we can't tell the country (ask for the country code)
//  none      -> no number in the message
export function extractPhone(raw) {
  const s = String(raw || "");
  const intl = s.match(/(?:\+|\b00)\s?(\d[\d\s().-]{7,17}\d)/);
  if (intl) {
    const d = intl[1].replace(/\D/g, "");
    if (d.length >= 8 && d.length <= 15) return { status: "ok", number: d };
  }
  const tok = s.match(/\d[\d\s().-]{8,}\d/);
  // A reply that is only digits but too short to be a number ("986251968": one digit missing) is a number they tried to give: ask for it again.
  const onlyDigits = /^\s*\+?[\d\s().-]+$/.test(s);
  const count = s.replace(/\D/g, "").length;
  if (onlyDigits && count >= 6 && count < 10) return { status: "ambiguous", short: true };
  if (!tok) return { status: "none" };
  const indian = normalizePhone(tok[0]);
  if (indian) return { status: "ok", number: indian };
  const d = tok[0].replace(/\D/g, "");
  return d.length >= 10 && d.length <= 15 ? { status: "ambiguous" } : { status: "none" };
}
