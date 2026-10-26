import { getStore } from "@netlify/blobs";

// Booked Founders' calls, remembered so the lead can be reminded. One record per call, kept in the same store as the rest of the agent's memory.
// { id, start (ms), name, waId, channel, label ("Fri, 23 Oct, 4:30 pm"), join ("Google Meet link: ..." or "Our Founders will call you on this number."), sent: { day, hour } }
const PREFIX = "call:";
const store = () => getStore("wa-agent");

export async function recordCall(rec) {
  try { await store().setJSON(`${PREFIX}${rec.id}`, { sent: {}, ...rec, bookedAt: rec.bookedAt || Date.now() }); } catch (e) { console.warn("recordCall:", e.message); }
}
// Adds to a call that is already remembered (the confirmation just went out: reminders count their gap from that moment).
export async function touchCall(id, patch) {
  try {
    const cur = await store().get(`${PREFIX}${id}`, { type: "json" });
    if (cur) await store().setJSON(`${PREFIX}${id}`, { ...cur, ...patch });
  } catch (e) { console.warn("touchCall:", e.message); }
}
export async function removeCall(id) {
  try { await store().delete(`${PREFIX}${id}`); } catch (e) { console.warn("removeCall:", e.message); }
}
export async function listCalls() {
  try {
    const s = store();
    const { blobs } = await s.list({ prefix: PREFIX });
    const out = [];
    for (const b of blobs) { const v = await s.get(b.key, { type: "json" }); if (v) out.push(v); }
    return out;
  } catch (e) { console.warn("listCalls:", e.message); return []; }
}

// ---- pure: which reminders are due right now? ----
const HOUR = 3600_000;
const istDate = (ms) => new Date(ms + 5.5 * HOUR).toISOString().slice(0, 10);
const istHour = (ms) => new Date(ms + 5.5 * HOUR).getUTCHours();
// Reminders must never feel like pestering, so they are spaced from the last automatic message about the call (the booking, or the WhatsApp confirmation):
// "day": between 10:00 and 13:00 IST the day before the call, only if the call was booked at least 20 hours ahead AND the last message about it was at least 18 hours ago
// "hour": from 75 minutes before the call until it starts, only if the last message about it was at least 3 hours ago
export function dueReminders(calls, now = Date.now()) {
  const out = [];
  for (const c of calls) {
    if (!c.waId || !c.start || c.start <= now) continue;
    const sent = c.sent || {};
    const ahead = c.start - (c.bookedAt || 0);
    const since = now - Math.max(c.bookedAt || 0, c.confirmedAt || 0, sent.day > 0 ? sent.day : 0);
    const dayBefore = istDate(c.start - 24 * HOUR) === istDate(now);
    if (!sent.day && dayBefore && istHour(now) >= 10 && istHour(now) < 13 && ahead >= 20 * HOUR && since >= 18 * HOUR) out.push({ call: c, kind: "day" });
    else if (!sent.hour && c.start - now <= 75 * 60_000 && ahead >= 2 * HOUR && since >= 3 * HOUR) out.push({ call: c, kind: "hour" });
  }
  return out;
}

// The values for the call_reminder_v1 template.
export const reminderParams = (c) => ({
  first_name: String(c.name || "").trim().split(/\s+/)[0] || "there",
  call_time: c.label || "",
  join_info: String(c.join || "Our Founders will call you on this number.").replace(/\s+/g, " ").trim(),
});

// Builds the record kept for a booked call. number: the lead's number if known (WhatsApp id, or the number they shared on Instagram).
export function callRecord({ id, start, label, name = "", number = "", channel = "WhatsApp", pref = "meet", meetLink = "", now = Date.now() }) {
  const waId = String(number || "").replace(/\D/g, "");
  const ok = waId.length >= 8 && waId.length <= 15 && !/pending|not shared/i.test(String(number));
  const join = pref === "phone" || !meetLink || /dry run/i.test(meetLink)
    ? "Our Founders will call you on this number."
    : `Google Meet link: ${meetLink}`;
  return { id: String(id), start, label, name, waId: ok ? waId : "", channel, join, sent: {}, bookedAt: now };
}
