// L49: "agent, book Poorvi Tuesday 4 pm". The owner books a Founders' call for a lead the agent stays out of (a chat the team is in).
// It uses the same calendar rules as the agent (call hours, 30-minute buffer, 4 a day), books the same kind of event with a Meet link,
// remembers the call so the reminders go out, and tells the lead through the one-rule gate only if their 24-hour window is open.
import { parseRequest, fmtIST, fmtTz } from "./calendar.mjs";
import { countryOf } from "./phone.mjs";

// deps: { now, contact, name, waId, stillFree({start,name,email,phone}), offer(req), book({start,email,pref,phone,name}), keep(call), send(text), windowClosed(), mark(patch) }
export async function bookFor({ when, email = "", phone = false, tell = true }, deps) {
  const now = deps.now ? deps.now() : Date.now();
  const req = parseRequest(when, now);
  if (!req || req.exactMs === undefined) return { ok: false, why: 'I need the day and the time, for example "Tuesday 4 pm" or "16 Nov at 5:30 pm".' };
  const start = req.exactMs;
  if (start <= now) return { ok: false, why: "that time has already passed." };
  const free = await deps.stillFree({ start, name: deps.name, email, phone: deps.waId });
  if (!free) {
    let alt = [];
    try { alt = (await deps.offer({ dayMs: req.dayMs, minutes: req.minutes })) || []; } catch { /* no alternatives to show */ }
    return { ok: false, why: `${fmtIST(start)} IST is not free (outside the call hours, too soon, or taken).${alt.length ? ` Free times near it: ${alt.map((s) => fmtIST(s)).join("; ")}.` : ""}` };
  }
  const pref = phone ? "phone" : "meet";
  let res;
  try { res = await deps.book({ start, email, pref, phone: `+${deps.waId}`, name: deps.name }); }
  catch (e) { return { ok: false, why: `the calendar would not book it (${String(e.message).slice(0, 100)}).` }; }
  if (!res?.ok) return { ok: false, why: `${fmtIST(start)} IST was just taken. Try another time.` };
  const c = countryOf(deps.waId);
  const mine = c.india ? "" : fmtTz(start, c.tz);
  const label = `${fmtIST(start)} IST${mine ? ` (${mine} for you)` : ""}`;
  await deps.keep({ id: res.eventId || `wa-${deps.waId}-${start}`, start, label, name: deps.name, number: deps.waId, channel: "WhatsApp", pref, meetLink: res.meetLink });
  const lines = [`Your call with our Founders is booked for ${label}.`];
  if (phone) lines.push("They will call you on this number.");
  else if (email) lines.push(`We have sent a calendar invite to ${email}.`);
  else if (res.meetLink) lines.push(`Here is the Google Meet link:\n${res.meetLink}`);
  lines.push("We look forward to speaking with you. 🌼");
  const text = lines.join("\n\n");
  let told = "no message was sent";
  if (tell) {
    if (await deps.windowClosed()) told = "their 24-hour WhatsApp window is closed, so no message went out: please confirm with them by template or call";
    else { try { await deps.send(text); told = "they have been told on WhatsApp"; } catch (e) { told = `the booking is made but the message did not go through (${String(e.message).slice(0, 80)})`; } }
  }
  if (deps.mark) await deps.mark({ callBooked: { start, email, meetLink: res.meetLink || "", label, eventId: res.eventId || "", pref } });
  return { ok: true, label, told, meetLink: res.meetLink || "" };
}
