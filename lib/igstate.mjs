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
