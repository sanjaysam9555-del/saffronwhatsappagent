import { getStore } from "@netlify/blobs";

// Daily counters for the evening summary. Only counted in live mode.
// Counts can drift slightly if two events land in the same instant; they are for a summary, not accounting.
const store = () => getStore("wa-metrics");
export const istDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d); // YYYY-MM-DD

export async function incr(name, n = 1) {
  if (process.env.DRY_RUN !== "false") return;
  try {
    const key = `m:${istDay()}`;
    const cur = (await store().get(key, { type: "json" })) || {};
    cur[name] = (cur[name] || 0) + n;
    await store().setJSON(key, cur);
  } catch (e) { console.warn("metrics:", e.message); }
}

export async function getDay(day = istDay()) {
  try { return (await store().get(`m:${day}`, { type: "json" })) || {}; } catch { return {}; }
}
