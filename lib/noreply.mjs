// L46: every inbound lead message that ends a run without a reply leaves one line in the Agent Log, with the reason.
// The Netlify logs only last 24 hours; this does not. Never throws, never blocks the run.
import { runTrace } from "./readgate.mjs";
import { logExchange } from "./playbook.mjs";

export const noReplyLine = (trace, commit = process.env.COMMIT_REF || "") => {
  if (!trace?.inbound || trace.sent > 0) return "";
  const why = trace.why || "ended with no reason recorded";
  return `(no reply: ${why}${commit ? ` · build ${String(commit).slice(0, 7)}` : ""})`;
};

export async function logNoReply(extraWhy = "") {
  try {
    const t = runTrace();
    if (extraWhy) t.why = extraWhy;
    const line = noReplyLine(t);
    if (!line) return;
    await logExchange({ channel: t.inbound.channel, contact: t.inbound.contact, lead: t.inbound.text, agent: line });
  } catch (e) { console.error("logNoReply:", e.message); }
}

// ---- L47: the day's silent chats, read back from the Agent Log for the daily summary ----
// Rows are [time "13 Nov, 18:49" (IST), channel, contact, lead said, agent replied]. A no-reply row says "(no reply: <why> · build abc1234)".
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const IST = 5.5 * 3600_000;
// "13 Nov, 18:49" -> epoch ms (the year is not in the stamp: the nearest one that is not in the future).
export function stampMs(stamp, now = Date.now()) {
  const m = String(stamp || "").match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*,?\s+(\d{1,2}):(\d{2})/);
  if (!m || MONTHS[m[2].toLowerCase()] === undefined) return 0;
  const y = new Date(now + IST).getUTCFullYear();
  let t = Date.UTC(y, MONTHS[m[2].toLowerCase()], Number(m[1]), Number(m[3]), Number(m[4])) - IST;
  if (t > now + 3600_000) t = Date.UTC(y - 1, MONTHS[m[2].toLowerCase()], Number(m[1]), Number(m[3]), Number(m[4])) - IST;
  return t;
}
// Reasons that are the machinery working (a repeated webhook, a test number, a burst answered by its last message): not a person left waiting.
const TECHNICAL = /^(duplicate|ignored|reset|igdebug|owner command|test mode|later message will answer|that message was already answered|answered by the run before|nothing new from them|media burst|number card|media reference|link reference|media|not a client chat)/i;
const PLAIN = {
  "team-already-in-chat": "your team is already in the chat",
  "history-unavailable": "the chat could not be read",
  "known-vendor": "known vendor", "known-client": "known client",
  "lead-wants-call-in-team-chat": "asked for a call in a chat your team is in",
};
export function plainWhy(why) {
  const w = String(why || "").trim();
  const h = w.match(/^handed to the team:\s*(.+)$/i);
  if (h) return PLAIN[h[1]] || h[1].replace(/-/g, " ");
  const e = w.match(/^ended at\s+(.+)$/i);
  if (e) return `stopped quietly (${e[1]})`;
  if (/^error:/i.test(w)) return `error (${w.slice(6).trim().slice(0, 80)})`;
  if (/no reason recorded/i.test(w)) return "stopped with no reason recorded";
  return w.slice(0, 80);
}
// rows: the whole Agent Log. Returns one entry per contact who wrote in the last `hours` and got nothing, newest first.
export function silentChats(rows = [], now = Date.now(), hours = 24) {
  const byContact = new Map();
  for (const r of rows.slice(1)) {
    const agent = String(r[4] || "");
    const m = agent.match(/^\(no reply:\s*(.*?)(?:\s·\sbuild\s\w+)?\)$/);
    if (!m) continue;
    const at = stampMs(r[0], now);
    if (!at || now - at > hours * 3600_000) continue;
    const why = m[1];
    if (TECHNICAL.test(why)) continue;
    const key = String(r[2] || "").trim() || "?";
    const prev = byContact.get(key);
    byContact.set(key, { contact: key, channel: r[1] || "", said: String(r[3] || "").slice(0, 80), why: plainWhy(why), at, n: (prev?.n || 0) + 1 });
  }
  return [...byContact.values()].sort((a, b) => b.at - a.at);
}
export function silentText(list) {
  if (!list.length) return "";
  return `Wrote in and got no reply from the agent (${list.length}):\n` + list.slice(0, 20).map((s) => `- ${s.contact}${s.n > 1 ? ` (${s.n} messages)` : ""}: "${s.said}" → ${s.why}`).join("\n");
}
