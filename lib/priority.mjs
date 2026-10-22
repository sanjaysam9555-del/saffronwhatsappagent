import { normalizeDate } from "./qualify.mjs";

// A hot-lead flag for the sheet (column R, "Priority"): who your team should call first.
//   HOT  = a call is booked or asked for, or every detail is in and the event is within 9 months, or a very large event (300+ guests)
//   WARM = at least three event details shared
//   ""   = anything less
const REAL = (v) => v && !/^(pending|not shared)$/i.test(String(v));
const MONTH = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
// Months from now to the event, or null if the date has no month.
export function monthsAway(date, now = Date.now()) {
  const d = normalizeDate(String(date || ""), now);
  const m = d.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i);
  const y = d.match(/\b(20\d\d)\b/);
  if (!m || !y) return null;
  const n = new Date(now + 5.5 * 3600_000);
  return (Number(y[1]) - n.getUTCFullYear()) * 12 + (MONTH[m[1].toLowerCase()] - n.getUTCMonth());
}
export function leadPriority(q = {}, now = Date.now()) {
  const f = q.fields || {};
  const details = ["occasion", "date", "location", "guests", "requirement"].filter((k) => REAL(f[k]));
  const guests = Number(String(f.guests || "").replace(/[^\d]/g, "")) || 0;
  const away = monthsAway(f.date, now);
  if (q.callBooked || ["meet", "phone"].includes(q.callPref) || ["slots", "email"].includes(q.stage)) return "HOT";
  if (guests >= 300) return "HOT";
  if (details.length === 5 && away !== null && away >= 0 && away <= 9) return "HOT";
  if (details.length >= 3) return "WARM";
  return "";
}
