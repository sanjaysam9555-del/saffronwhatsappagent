import { getStore } from "@netlify/blobs";

// Per-contact memory, keyed by WhatsApp id (digits with country code).
// Fields: lastIn, lastOut (ms), agentSent (ms), humanSpoke, esc (needs human), followups, dnc, name
const store = () => getStore("wa-contacts");

export async function getContact(waId) {
  try { return (await store().get(`c:${waId}`, { type: "json" })) || {}; } catch { return {}; }
}

export async function saveContact(waId, patch) {
  try {
    const c = { ...(await getContact(waId)), ...patch };
    await store().setJSON(`c:${waId}`, c);
    return c;
  } catch (e) {
    console.warn("contact store unavailable:", e.message);
    return patch;
  }
}

export async function listContacts() {
  try {
    const { blobs } = await store().list({ prefix: "c:" });
    return Promise.all(blobs.map(async (b) => [b.key.slice(2), await getContact(b.key.slice(2))]));
  } catch { return []; }
}

// Outbound events within this window after the agent's own send are treated as ours, not a human's.
export const AGENT_ECHO_MS = 90_000;
