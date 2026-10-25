import { getStore } from "@netlify/blobs";

// One message at a time per chat. Two quick messages ("After 15 Feb" then "2027") start two background runs; without this they
// both read the same saved state, both answer, and the lead gets the same question twice (and one save can overwrite the other).
// A run takes the chat's lock, does its work, and releases it; a run that finds the lock taken waits its turn and then reads the
// state the first run left behind. `waited` tells the caller it was a quick follow-up. If the store is unavailable we carry on without a lock.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function acquireLock(name, { ttlMs = 90_000, waitMs = 80_000, pollMs = 600, settleMs = 250, store } = {}) {
  const none = (waited) => ({ waited, release: async () => {} });
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  let waited = false;
  try {
    const s = store || getStore({ name: "wa-agent", consistency: "strong" });
    const key = `lock:${name}`;
    const start = Date.now();
    for (;;) {
      const cur = await s.get(key, { type: "json" });
      if (!cur || Date.now() - Number(cur.t) > ttlMs) {
        await s.setJSON(key, { token, t: Date.now() });
        await sleep(settleMs); // if two runs wrote at the same moment, only the last writer's token is still there
        const back = await s.get(key, { type: "json" });
        if (back?.token === token) {
          return { waited, release: async () => { try { const now = await s.get(key, { type: "json" }); if (now?.token === token) await s.delete(key); } catch { /* the lock expires by itself */ } } };
        }
      }
      waited = true;
      if (Date.now() - start > waitMs) return none(true); // the other run is taking too long: carry on rather than leave the lead unanswered
      await sleep(pollMs);
    }
  } catch (e) { console.warn("lock unavailable, carrying on:", e.message); return none(waited); }
}
