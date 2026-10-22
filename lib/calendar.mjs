import { google } from "googleapis";
import { live } from "./sheet.mjs";

// Consultation calls with the Founders. Mirrors the "Consult with Saffron Events" appointment schedule on the owner's calendar:
// 30-minute calls, a 30-minute buffer, at most 4 bookings a day, up to 60 days ahead. Google cannot read an appointment
// schedule's hours through its API, so the weekly hours are kept here (all Indian time).
export const SLOT_MIN = 30;
export const BUFFER_MIN = 30;
export const MAX_PER_DAY = 4;
export const MIN_NOTICE_H = 4;
export const SEARCH_DAYS = 14;
export const IST_MS = 5.5 * 3600_000;

// Weekday (0 = Sunday) -> windows as [start, end] in minutes after midnight, Indian time.
const hm = (h, m = 0) => h * 60 + m;
export const WEEKLY = {
  0: [[hm(11, 30), hm(15, 30)], [hm(16, 30), hm(18, 30)], [hm(19, 30), hm(21, 30)]],
  1: [[hm(11, 30), hm(13, 30)], [hm(15, 30), hm(19, 30)]],
  2: [[hm(11, 30), hm(13, 30)], [hm(15, 30), hm(19, 30)]],
  3: [[hm(11, 30), hm(13, 30)], [hm(15, 30), hm(19, 30)]],
  4: [[hm(11, 30), hm(13, 30)], [hm(15, 30), hm(19, 30)]],
  5: [[hm(11, 30), hm(13, 30)], [hm(15, 30), hm(19, 30)]],
  6: [[hm(11, 0), hm(13, 30)], [hm(15, 30), hm(19, 30)]],
};

export const calendarOwner = () => String(process.env.CALENDAR_OWNER || "").trim();
export const calendarEnabled = () => Boolean(calendarOwner() && process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

// ---- pure slot logic (easy to test) ----
const istParts = (ms) => { const d = new Date(ms + IST_MS); return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay() }; };
const istMidnight = (ms) => { const p = istParts(ms); return Date.UTC(p.y, p.mo, p.d) - IST_MS; };
export const istDayKey = (ms) => { const p = istParts(ms); return `${p.y}-${String(p.mo + 1).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`; };

// busy: [{start, end}] in epoch ms. perDay: { "YYYY-MM-DD": number of consultations already booked }.
// Returns every free slot start (epoch ms) in the next `days`, in order.
export function freeSlots({ now = Date.now(), busy = [], perDay = {}, days = SEARCH_DAYS, from = 0 }) {
  const out = [];
  const earliest = now + MIN_NOTICE_H * 3600_000;
  const buf = BUFFER_MIN * 60_000, len = SLOT_MIN * 60_000;
  const day0 = istMidnight(Math.max(now, from)); // from: the day the lead asked for
  for (let i = 0; i <= days; i++) {
    const dayStart = day0 + i * 86_400_000;
    if ((perDay[istDayKey(dayStart)] || 0) >= MAX_PER_DAY) continue;
    const wd = istParts(dayStart).wd;
    for (const [ws, we] of WEEKLY[wd] || []) {
      for (let m = ws; m + SLOT_MIN <= we; m += SLOT_MIN) {
        const s = dayStart + m * 60_000, e = s + len;
        if (s < earliest) continue;
        if (busy.some((b) => b.start < e + buf && b.end > s - buf)) continue;
        out.push(s);
      }
    }
  }
  return out;
}

// Up to three options on different days, with some variety: the earliest, then an evening one, then the earliest of the next day.
export function pickOffers(slots, n = 3) {
  const byDay = new Map();
  for (const s of slots) { const k = istDayKey(s); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(s); }
  const days = [...byDay.values()];
  const minutes = (s) => { const d = new Date(s + IST_MS); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
  const picks = [];
  days.slice(0, n).forEach((list, i) => {
    const evening = list.find((s) => minutes(s) >= hm(15, 30));
    picks.push(i === 1 && evening ? evening : list[0]);
  });
  return picks;
}

// Offers for a day they asked for: up to three times that day (closest to the time they named, or spread across the day),
// topped up with the next days if that day has fewer.
export function pickFor(slots, req = {}) {
  if (!slots.length) return [];
  const minutes = (s) => { const d = new Date(s + IST_MS); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
  const firstDay = istDayKey(slots[0]);
  const same = slots.filter((s) => istDayKey(s) === firstDay);
  let picks;
  if (req.minutes != null) picks = [...same].sort((a, b) => Math.abs(minutes(a) - req.minutes) - Math.abs(minutes(b) - req.minutes)).slice(0, 3);
  else if (same.length <= 3) picks = same;
  else picks = [...new Set([same[0], same[Math.floor(same.length / 2)], same.at(-1)])];
  if (picks.length < 3) {
    const rest = pickOffers(slots.filter((s) => istDayKey(s) !== firstDay), 3 - picks.length);
    picks = [...picks, ...rest];
  }
  return picks.sort((a, b) => a - b);
}

// A day and/or time in the lead's words: "Wednesday evening", "28 Oct at 5pm", "tomorrow", "next week", "after 6pm".
// Returns { dayMs (IST midnight), minutes, exactMs } or null when they named neither a day nor a time.
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const WDAY = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
// Whole weekday words only, so "wedding" or "satisfied" are not read as Wednesday or Saturday.
export const weekdayIn = (t) => {
  const m = String(t).toLowerCase().match(/\b(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday|rsday)?|thurs(?:day)?|fri(?:day)?|sat(?:urday)?)\b/);
  return m ? WDAY[m[1].slice(0, 3)] : undefined;
};
export function parseRequest(text, now = Date.now()) {
  const t = String(text || "").toLowerCase();
  let wd;
  const today = istMidnight(now);
  const todayWd = istParts(now).wd;
  let dayMs;
  if (/\btoday\b/.test(t)) dayMs = today;
  else if (/\bday after( tomorrow)?\b/.test(t)) dayMs = today + 2 * 86_400_000;
  else if (/\b(tomorrow|tmrw|tmr)\b/.test(t)) dayMs = today + 86_400_000;
  else if (/\bnext week\b/.test(t)) dayMs = today + (((8 - todayWd) % 7) || 7) * 86_400_000;
  else {
    const dm = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s*)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/) || t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{1,2})(?:st|nd|rd|th)?\b/);
    const sl = t.match(/\b(\d{1,2})[\/-](\d{1,2})\b/);
    let d, m;
    if (dm) { if (/^\d/.test(dm[1])) { d = Number(dm[1]); m = MON[dm[2]]; } else { m = MON[dm[1]]; d = Number(dm[2]); } }
    else if (sl && Number(sl[1]) <= 31 && Number(sl[2]) <= 12) { d = Number(sl[1]); m = Number(sl[2]) - 1; }
    if (d && m !== undefined && d >= 1 && d <= 31) {
      const y = istParts(now).y;
      let c = Date.UTC(y, m, d) - IST_MS;
      if (c < today) c = Date.UTC(y + 1, m, d) - IST_MS;
      dayMs = c;
    } else {
      wd = weekdayIn(t);
      if (wd !== undefined) { const delta = (wd - todayWd + 7) % 7; dayMs = today + (delta || 7) * 86_400_000; }
    }
  }
  let minutes;
  const tm = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/) || t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (tm) {
    let h = Number(tm[1]); const mi = Number(tm[2] || 0); const ap = tm[3];
    if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0;
    if (!ap && h >= 1 && h <= 8) h += 12; // "6:30" in a call context means the evening
    if (h <= 23 && mi <= 59) minutes = h * 60 + mi;
  } else if (/\bmorning\b/.test(t)) minutes = 11 * 60 + 30;
  else if (/\bafternoon\b/.test(t)) minutes = 15 * 60 + 30;
  else if (/\bevening|night\b/.test(t)) minutes = 18 * 60 + 30;
  if (dayMs === undefined && minutes === undefined) return null;
  const exactMs = dayMs !== undefined && tm && minutes !== undefined ? dayMs + minutes * 60_000 : undefined;
  return { dayMs, minutes, exactMs, wd, explicit: Boolean(tm) };
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const clock = (h, m) => `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
export function fmtIST(ms) {
  const d = new Date(ms + IST_MS);
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${clock(d.getUTCHours(), d.getUTCMinutes())}`;
}
// Their own clock, for leads abroad: "Fri 6:00 am".
export function fmtTz(ms, tz) {
  if (!tz) return "";
  try {
    const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(new Date(ms));
    const g = (t) => p.find((x) => x.type === t)?.value || "";
    return `${g("weekday")} ${g("hour")}:${g("minute")} ${g("dayPeriod").toLowerCase()}`;
  } catch { return ""; }
}

// ---- Google Calendar ----
function client() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes: ["https://www.googleapis.com/auth/calendar"], subject: calendarOwner() });
  return google.calendar({ version: "v3", auth });
}

async function busyAndCounts(cal, fromMs, toMs) {
  const owner = calendarOwner();
  const fb = await cal.freebusy.query({ requestBody: { timeMin: new Date(fromMs).toISOString(), timeMax: new Date(toMs).toISOString(), timeZone: "Asia/Kolkata", items: [{ id: owner }] } });
  const busy = (fb.data.calendars?.[owner]?.busy || []).map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) }));
  const ev = await cal.events.list({ calendarId: owner, timeMin: new Date(fromMs).toISOString(), timeMax: new Date(toMs).toISOString(), singleEvents: true, q: "Consult with Saffron", maxResults: 250 });
  const perDay = {};
  for (const e of ev.data.items || []) {
    if (e.status === "cancelled" || !e.start?.dateTime) continue;
    const k = istDayKey(Date.parse(e.start.dateTime));
    perDay[k] = (perDay[k] || 0) + 1;
  }
  return { busy, perDay };
}

// Three slots to offer, from the day they asked for if they named one. Throws if the calendar cannot be read
// (the caller falls back to a person). Returns [] if the day is beyond what the schedule allows.
export async function offerSlots(req = null, now = Date.now()) {
  const from = req?.dayMs && req.dayMs > now ? req.dayMs : now;
  if (from > now + 60 * 86_400_000) return [];
  const cal = client();
  const { busy, perDay } = await busyAndCounts(cal, from - 86_400_000, from + (SEARCH_DAYS + 2) * 86_400_000);
  const free = freeSlots({ now, busy, perDay, from });
  return req ? pickFor(free, req) : pickOffers(free);
}

// Books a consultation with a Google Meet link. Re-checks the slot first.
// Returns { ok: true, meetLink, start } | { ok: false, taken: true } ; throws on errors.
export async function bookConsult({ start, name, email, phone, details = "", pref = "meet", source = "" }) {
  if (!live()) return { ok: true, meetLink: "(dry run: no event created)", start, dry: true };
  const cal = client();
  const owner = calendarOwner();
  const { busy, perDay } = await busyAndCounts(cal, start - 86_400_000, start + 2 * 86_400_000);
  const stillFree = freeSlots({ now: start - MIN_NOTICE_H * 3600_000 - 1000, busy, perDay, days: 2 }).includes(start);
  if (!stillFree) return { ok: false, taken: true };
  const end = start + SLOT_MIN * 60_000;
  const who = String(name || "").replace(/\s+/g, " ").trim() || "Lead";
  const description = [
    "<b>Booked by</b>", who, email || "", phone || "", "",
    pref === "phone" ? "<b>Prefers a phone call:</b> please call on the number above (Meet link is a backup)." : "<b>Prefers:</b> Google Meet video call",
    source ? `<b>Booked by our assistant on ${source}</b>` : "",
    details,
  ].filter((l, i, a) => l !== "" || (a[i - 1] !== "")).join("\n");
  const res = await cal.events.insert({
    calendarId: owner, conferenceDataVersion: 1, sendUpdates: email ? "all" : "none",
    requestBody: {
      summary: `Consult with Saffron Events (${who})`, description, colorId: "7", guestsCanInviteOthers: true,
      start: { dateTime: new Date(start).toISOString(), timeZone: "Asia/Kolkata" }, end: { dateTime: new Date(end).toISOString(), timeZone: "Asia/Kolkata" },
      attendees: email ? [{ email }] : [],
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 120 }, { method: "popup", minutes: 10 }] },
      conferenceData: { createRequest: { requestId: `saffron-${start}-${Math.random().toString(36).slice(2, 8)}`, conferenceSolutionKey: { type: "hangoutsMeet" } } },
    },
  });
  const meetLink = res.data.hangoutLink || res.data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri || "";
  return { ok: true, meetLink, start, eventId: res.data.id };
}
