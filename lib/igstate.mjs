import { getStore } from "@netlify/blobs";

// Per-Instagram-lead memory, keyed by the ManyChat subscriber id. Kept apart from the WhatsApp contacts store so the
// WhatsApp follow-up jobs never see Instagram ids.
const store = () => getStore({ name: "ig-contacts", consistency: "strong" });

export async function getIg(sid) {
  try { return (await store().get(`c:${sid}`, { type: "json" })) || {}; } catch { return {}; }
}
export async function saveIg(sid, patch) {
  try {
    const c = { ...(await getIg(sid)), ...patch };
    await store().setJSON(`c:${sid}`, c);
    return c;
  } catch (e) { console.warn("ig store unavailable:", e.message); return patch; }
}

// For testing only ("agenttest reset"): forget everything about one subscriber so a test can start again.
// It also clears the "already sent this" limits (greeting, hold message, guide links...), so the test gets a fresh first reply.
export async function resetIg(sid) {
  try {
    await store().setJSON(`c:${sid}`, {}); await store().setJSON(`q:${sid}`, []); await store().setJSON(`h:${sid}`, []);
    try {
      const limits = getStore("wa-agent");
      for (const prefix of ["igreply", "igack", "igguide", "igmediaack", "igbudget", "igevt"]) {
        const { blobs } = await limits.list({ prefix: `${prefix}:${sid}` });
        for (const b of blobs || []) await limits.delete(b.key);
      }
    } catch (e) { console.warn("reset: could not clear limits:", e.message); }
    return true;
  } catch { return false; }
}

// Messages arrive one request each, often in bursts ("hi" / "I need your services" / "wedding"). Each is queued; after a short
// pause only the LAST one to arrive replies, to everything queued so far, so a burst gets one answer and the state never races.
export async function queueMessage(sid, text) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const key = `q:${sid}`;
    const cur = (await store().get(key, { type: "json" })) || [];
    cur.push({ id, text, t: Date.now() });
    await store().setJSON(key, cur.slice(-10));
    return id;
  } catch (e) { console.warn("ig queue unavailable:", e.message); return null; } // caller answers the message directly
}
// Returns the queued texts joined, if `id` is still the newest message; otherwise null (a later message will answer).
export async function claimQueue(sid, id) {
  try {
    const key = `q:${sid}`;
    const cur = (await store().get(key, { type: "json" })) || [];
    if (!cur.length || cur.at(-1).id !== id) return null;
    await store().setJSON(key, []);
    return cur.map((m) => m.text).join("\n");
  } catch { return null; }
}

// A rolling record of each Instagram chat (what they wrote and what we sent), so Claude can read the conversation so far.
// ManyChat does not give us the old messages, so this starts from the first message the agent sees. Kept apart from the
// lead's state so saving a state change can never overwrite it. Messages the team types by hand in Instagram are not seen.
export const HISTORY_KEEP = 20;
export async function addIgHistory(sid, from, text) {
  const t = String(text ?? "").trim().slice(0, 600);
  if (!sid || !t) return;
  try {
    const cur = (await store().get(`h:${sid}`, { type: "json" })) || [];
    cur.push({ from, text: t, t: Date.now() });
    await store().setJSON(`h:${sid}`, cur.slice(-HISTORY_KEEP));
  } catch (e) { console.warn("ig history unavailable:", e.message); }
}
// Oldest first, shaped like the WhatsApp history ({from: "customer"|"us", text}). `skipNewest` leaves out the message being answered now.
export async function getIgHistory(sid, { n = 12, skipNewest = "" } = {}) {
  try {
    let cur = (await store().get(`h:${sid}`, { type: "json" })) || [];
    const last = cur[cur.length - 1];
    if (skipNewest && last && last.from === "customer" && last.text === String(skipNewest).trim().slice(0, 600)) cur = cur.slice(0, -1);
    return cur.slice(-n).map((m) => ({ from: m.from, text: m.text }));
  } catch { return []; }
}
