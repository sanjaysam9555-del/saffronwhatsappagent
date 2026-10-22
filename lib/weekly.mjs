// The Monday review: numbers for the week, chats where the lead sounded unhappy with the agent, and what is waiting on the owner.
// Pure functions, so they are easy to test. The scheduled job (netlify/functions/weekly-review.mjs) does the reading and writing.

export const WEEKLY_TAB = "Weekly Review";
export const WEEKLY_HEADERS = ["Week", "New leads", "Details completed", "Calls booked", "Calls moved", "Handed to team", "Questions waiting for you", "Suggestions to approve", "Chats where the lead seemed unhappy"];

const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
// "22 Oct, 14:03" (the stamp used in the Agent Log and Needs Team tabs) -> epoch ms. No year is stored, so the nearest past year is used.
export function parseStamp(s, now = Date.now()) {
  const m = String(s || "").match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{1,2}):(\d{2})/);
  if (!m || MON[m[2].toLowerCase()] === undefined) return null;
  const y = new Date(now + 5.5 * 3600_000).getUTCFullYear();
  let t = Date.UTC(y, MON[m[2].toLowerCase()], Number(m[1]), Number(m[3]), Number(m[4])) - 5.5 * 3600_000;
  if (t > now + 86_400_000) t = Date.UTC(y - 1, MON[m[2].toLowerCase()], Number(m[1]), Number(m[3]), Number(m[4])) - 5.5 * 3600_000;
  return t;
}

// A lead repeating themselves or objecting to what the agent did. Each one is a chance to improve a reply.
export const UNHAPPY = /\b(already (told|said|mentioned|gave|shared|answered)|i (just |already )?(said|told|mentioned|wrote)|same (question|thing)|not what i asked|didn'?t (answer|understand|ask)|you('re| are) not (listening|reading)|why (are|do) you (keep )?ask|asked (this|that) (already|before)|again\?|repeat(ing)?|bot\b|robot|automated|human|real person|koi (insaan|person)|pehle (bata|bol)|bata (chuka|diya))\b/i;

export function unhappyChats(logRows, now = Date.now(), days = 7, max = 10) {
  const since = now - days * 86_400_000;
  const out = [];
  for (const r of logRows) {
    const t = parseStamp(r[0], now);
    if (t === null || t < since) continue;
    if (UNHAPPY.test(String(r[3] || ""))) out.push({ when: r[0], contact: r[2] || "", lead: String(r[3]).slice(0, 120), agent: String(r[4] || "").slice(0, 120) });
  }
  return out.slice(-max);
}

export function sumMetrics(days) {
  const t = {};
  for (const d of days) for (const [k, v] of Object.entries(d || {})) t[k] = (t[k] || 0) + (Number(v) || 0);
  return t;
}

// One row for the Weekly Review tab, and the numbers for the WhatsApp message.
export function weeklyNumbers(totals, { waiting = 0, suggested = 0, unhappy = 0 } = {}) {
  const n = (k) => totals[k] || 0;
  return {
    leads: n("new_leads"), // every new row on the leads sheet, from any channel
    completed: n("ig_leads_completed") + n("wa_leads_completed"),
    booked: n("calls_booked"), moved: n("calls_moved"),
    handed: n("escalations") + n("ig_escalations"),
    waiting, suggested, unhappy,
  };
}
export const weeklyRow = (weekLabel, w, unhappyList) => [weekLabel, w.leads, w.completed, w.booked, w.moved, w.handed, w.waiting, w.suggested, unhappyList.map((u) => `${u.contact}: "${u.lead}"`).join(" | ").slice(0, 900)];

// Values for the weekly_review_v1 template (no empty values, no line breaks).
export function weeklyParams(weekLabel, w, sheetLink) {
  return { week: weekLabel, leads: String(w.leads), calls: String(w.booked), handed_over: String(w.handed), to_approve: String(w.suggested + w.waiting), sheet_link: sheetLink };
}

export const weekLabel = (now = Date.now()) => {
  const f = (t) => new Date(t + 5.5 * 3600_000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${f(now - 7 * 86_400_000)} to ${f(now - 86_400_000)}`;
};
