import { getContact, saveContact, listContacts } from "./contacts.mjs";
import { getRecentMessages, sendSessionMessage, getContactsPage } from "./wati.mjs";
import { logExchange } from "./playbook.mjs";
import { getIg, saveIg, listIgContacts } from "./igstate.mjs";
import { matchCalls, waNumber, reofferText, applyOwnerFields } from "./callconfirm.mjs";
import { setEventDetails } from "./calendar.mjs";
import { detailsText } from "./consult.mjs";
import { upsertInstagramLead } from "./sheet.mjs";
import { offerSlots, slotStillFree } from "./calendar.mjs";
import { sendInstagramText } from "./manychat.mjs";
import { addIgHistory } from "./igstate.mjs";
import { callBookedParams } from "./leadfields.mjs";
import { readingFor } from "./guides.mjs";
import { sendTemplateMessage } from "./wati.mjs";
import { incr } from "./metrics.mjs";
import { touchCall } from "./calls.mjs";
import { oneEmoji } from "./understand.mjs";

const last10 = (v) => String(v || "").replace(/\D/g, "").slice(-10);

// Finds WhatsApp contacts by number (any format) or by part of their name, among the chats the agent has seen and Wati's own list.
export async function findContacts(query) {
  const q = String(query || "").trim();
  if (!q) return [];
  const digits = q.replace(/\D/g, "");
  const byId = new Map();
  const add = (waId, name) => { if (waId && !byId.has(waId)) byId.set(waId, { waId, name: name || "" }); else if (name && !byId.get(waId).name) byId.get(waId).name = name; };
  if (digits.length >= 7) {
    const want = digits.slice(-10);
    for (const [id, c] of await listContacts()) if (last10(id) === want || id.endsWith(digits)) add(id, c.name);
    if (!byId.size && digits.length >= 10) add(digits.length === 10 ? `91${digits}` : digits, "");
    return [...byId.values()];
  }
  const needle = q.toLowerCase();
  for (const [id, c] of await listContacts()) if (String(c.name || "").toLowerCase().includes(needle)) add(id, c.name);
  if (!byId.size) for (const c of await getContactsPage(1, 200)) if (String(c.name || "").toLowerCase().includes(needle)) add(c.waId, c.name);
  return [...byId.values()];
}

// What an order from the owner can do, with the real Wati and contact store behind it.
export const ownerDeps = {
  find: findContacts,
  // Instagram leads with a call booked or a time chosen, matched by name, @handle or number.
  findCalls: async (query) => matchCalls(await listIgContacts(), query),
  // Offers a fresh list of times to an Instagram lead who chose a time that is gone (or never chose), and puts the chat back to choosing.
  reofferTimes: async (m, extra = {}) => {
    const cur0 = (await getIg(m.sid)).q || m.q;
    // What the owner states replaces what is saved (the lead's detail was missed or misread); a saved number is only filled in, never replaced.
    const { fields } = applyOwnerFields(cur0.fields || {}, extra);
    const hasNumber = Boolean(waNumber(fields.number));
    const cur = { ...cur0, fields, callPref: cur0.callPref && !["declined", "either"].includes(cur0.callPref) ? cur0.callPref : hasNumber ? "phone" : "meet" };
    m = { ...m, number: waNumber(fields.number) || m.number };
    const slots = await offerSlots();
    if (!slots.length) throw new Error("the calendar has no free times to offer right now");
    let taken = false;
    if (cur.chosen) { try { taken = !(await slotStillFree({ start: cur.chosen, name: m.name || m.username, phone: m.number })); } catch { taken = false; } }
    const text = oneEmoji(reofferText(slots, m.number, taken, Boolean(extra.apologise), extra.note));
    await sendInstagramText(m.sid, text); // Instagram only lets us write within 24 hours of their last message; if that has passed this throws and nothing is changed
    await addIgHistory(m.sid, "us", text);
    await saveIg(m.sid, { q: { ...cur, stage: "slots", slots, tries: 0, chosen: undefined }, esc: false, escAt: undefined, lastOut: Date.now(), lastOutText: text.slice(0, 600) }); // the chat goes back to the agent: a hand-over earlier no longer keeps it quiet
    await logExchange({ channel: "Instagram", contact: m.username ? `@${m.username}` : m.name, lead: "(order from owner)", agent: text });
    return { note: `Done. ${m.name || "They"} ${taken ? "was told that time is taken and " : ""}received ${slots.length} new times on Instagram. When they pick one, the call is booked and the WhatsApp confirmation goes out.` };
  },
  // The owner corrects what is saved about a lead: the lead's details, the sheet row, and the calendar event if a call is booked.
  correctLead: async (m, given) => {
    const cur = (await getIg(m.sid)).q || m.q;
    const { fields, changed } = applyOwnerFields(cur.fields || {}, given, { replaceNumber: true });
    if (!changed.length) return { note: `Nothing to change: ${m.name || "the lead"} already has those details.` };
    const q = { ...cur, fields, notes: [cur.notes, `Corrected by owner: ${changed.join(", ")}`].filter(Boolean).join(" / ").slice(0, 400) };
    await saveIg(m.sid, { q });
    let where = ["the lead's record"];
    try { await upsertInstagramLead(m.sid, m.name || m.username, q, { notes: q.notes, lastMsg: "(corrected by owner)" }); where.push("the sheet"); } catch (e) { console.warn("sheet:", e.message); }
    if (q.callBooked?.eventId) { try { await setEventDetails({ eventId: q.callBooked.eventId, details: detailsText(fields) }); where.push("the calendar event"); } catch (e) { console.warn("calendar:", e.message); } }
    return { note: `Done. Changed ${changed.join(", ")} for ${m.name || "the lead"} in ${where.join(", ")}.${q.callBooked && !q.waConfirmSent ? "" : q.callBooked ? " The WhatsApp confirmation that went out earlier still shows the old details: say \"send the call confirmation to " + (m.name || "them") + " again\" to send a corrected one." : ""}` };
  },
  // The approved WhatsApp template with their details and call time. `m.number` may have been given by the owner.
  sendCallConfirmation: async (m) => {
    const tpl = process.env.CALL_TEMPLATE_NAME;
    if (!tpl) throw new Error("CALL_TEMPLATE_NAME is not set in Netlify");
    const number = waNumber(m.number);
    if (!number) throw new Error("there is no valid WhatsApp number for this lead");
    const cur = (await getIg(m.sid)).q || m.q;
    const fields = { ...(cur.fields || {}) };
    if (!waNumber(fields.number)) fields.number = `+${number}`;
    await sendTemplateMessage(number, tpl, callBookedParams(m.name, fields, m.label, readingFor(fields)), "call-confirmation");
    await saveIg(m.sid, { q: { ...cur, fields, waConfirmSent: true } });
    if (cur.callBooked?.eventId) await touchCall(cur.callBooked.eventId, { confirmedAt: Date.now() });
    await incr("call_confirmations_sent");
    await logExchange({ channel: "Instagram", contact: m.username ? `@${m.username}` : m.name, lead: "(order from owner)", agent: `WhatsApp call confirmation sent to +${number}` });
  },
  history: (waId) => getRecentMessages(waId, 12),
  setFlags: (waId, patch) => saveContact(waId, patch),
  windowClosed: async (waId) => { const c = await getContact(waId); return Boolean(c.lastIn) && Date.now() - c.lastIn > 23 * 3600_000; },
  send: async (waId, text) => {
    await saveContact(waId, { agentSent: Date.now(), lastOut: Date.now() }); // so Wati's echo is not mistaken for a person on the team
    await sendSessionMessage(waId, text);
    await logExchange({ channel: "WhatsApp", contact: `+${waId}`, lead: "(order from owner)", agent: text });
  },
};
