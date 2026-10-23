import { getContact, saveContact, listContacts } from "./contacts.mjs";
import { getRecentMessages, sendSessionMessage, getContactsPage } from "./wati.mjs";
import { logExchange } from "./playbook.mjs";

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
  history: (waId) => getRecentMessages(waId, 12),
  setFlags: (waId, patch) => saveContact(waId, patch),
  windowClosed: async (waId) => { const c = await getContact(waId); return Boolean(c.lastIn) && Date.now() - c.lastIn > 23 * 3600_000; },
  send: async (waId, text) => {
    await saveContact(waId, { agentSent: Date.now(), lastOut: Date.now() }); // so Wati's echo is not mistaken for a person on the team
    await sendSessionMessage(waId, text);
    await logExchange({ channel: "WhatsApp", contact: `+${waId}`, lead: "(order from owner)", agent: text });
  },
};
