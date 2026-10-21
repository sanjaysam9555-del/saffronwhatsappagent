import { getStore } from "@netlify/blobs";

// Milliseconds since `key` was first seen (records it on first call, returning 0).
export async function ageMs(key) {
  try {
    const store = getStore("wa-agent");
    const first = await store.get(key);
    if (!first) { await store.set(key, String(Date.now())); return 0; }
    return Date.now() - Number(first);
  } catch (e) {
    console.warn("state unavailable:", e.message);
    return 0; // unknown age: treat as new, never nudge early
  }
}

// Rate limit: true if we may send `key` now, and records it. Prevents reply loops/spam.
export async function allow(key, ttlMs) {
  try {
    const store = getStore("wa-agent");
    const last = await store.get(key);
    if (last && Date.now() - Number(last) < ttlMs) return false;
    await store.set(key, String(Date.now()));
    return true;
  } catch (e) {
    console.warn("state unavailable, allowing:", e.message);
    return true;
  }
}

// How long since this row's content last changed. `created` is true the first time the row is seen.
// Used as "quiet time": ManyChat fills the row column by column, so a change means the lead is active.
export async function sinceChange(key, hash) {
  try {
    const store = getStore("wa-agent");
    const cur = await store.get(`chg:${key}`, { type: "json" });
    const now = Date.now();
    if (!cur) { await store.setJSON(`chg:${key}`, { hash, t: now }); return { quiet: 0, created: true }; }
    if (cur.hash !== hash) { await store.setJSON(`chg:${key}`, { hash, t: now }); return { quiet: 0, created: false }; }
    return { quiet: now - cur.t, created: false };
  } catch (e) {
    console.warn("state unavailable:", e.message);
    return { quiet: 0, created: false }; // unknown: treat as fresh, never nudge early
  }
}

export async function getFlag(key) {
  try { return Boolean(await getStore("wa-agent").get(`flag:${key}`)); } catch { return false; }
}
export async function setFlag(key) {
  try { await getStore("wa-agent").set(`flag:${key}`, "1"); } catch (e) { console.warn("flag:", e.message); }
}
