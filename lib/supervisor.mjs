import { reviewChat, vendorWelcome } from "./operator.mjs";

const MIN = 60_000, HOUR = 3600_000;
export const WAIT_MS = 20 * MIN;      // give the normal flow time to answer first
export const WINDOW_MS = 22 * HOUR;   // WhatsApp only lets us reply freely for 24 hours; stay inside it

// Which contacts are worth a look: they wrote last, nobody answered for a while, the 24-hour window is still open,
// nobody on the team has taken over, and this message has not been reviewed already.
export function needsReview(c, now = Date.now()) {
  if (!c || !c.lastIn || c.dnc || c.skip || c.hold) return false;
  if (c.lastOut && c.lastOut >= c.lastIn) return false;
  if (now - c.lastIn < WAIT_MS || now - c.lastIn > WINDOW_MS) return false;
  if (c.humanSpoke && c.lastHuman && c.lastHuman >= c.lastIn) return false;
  if (c.supervisedAt && c.supervisedAt >= c.lastIn) return false;
  return true;
}

// deps: { contacts() -> [[waId, c]], history(waId), send(waId,text), save(waId,patch), logTeam(obj), count(name), allowed(waId) }
export async function superviseOnce(deps, { now = Date.now(), max = 15 } = {}) {
  const out = { looked: 0, sent: 0, flagged: 0, fine: 0 };
  for (const [waId, c] of await deps.contacts()) {
    if (out.looked >= max) break;
    if (!needsReview(c, now) || !deps.allowed(waId)) continue;
    const history = await deps.history(waId);
    if (!history || !history.length) continue; // cannot see the chat: do not guess
    if (history[history.length - 1].from !== "customer") { await deps.save(waId, { supervisedAt: c.lastIn }); continue; } // someone did answer
    out.looked++;
    const r = await reviewChat({ channel: "WhatsApp", profileName: c.name, history, state: { kind: c.kind, stage: c.q?.stage, greeted: c.greeted, fields: c.q?.fields } });
    await deps.save(waId, { supervisedAt: c.lastIn });
    if (!r || r.kind === "fine") { out.fine++; continue; }
    const base = { waId, name: c.name || `+${waId}`, lastMsg: history[history.length - 1].text };
    if (r.kind === "vendor") {
      await deps.save(waId, { kind: "vendor" });
      await deps.send(waId, vendorWelcome({ name: r.name || c.name, business: r.business }));
      await deps.logTeam({ ...base, reason: "supervisor-sent", reply: "(vendor sign-up link sent)" });
      await deps.count("supervisor_sent"); out.sent++;
    } else if (r.kind === "reply" && !c.esc) { // a chat already handed to the team is never answered behind their back
      await deps.send(waId, r.text);
      await deps.logTeam({ ...base, reason: "supervisor-sent", reply: r.text.slice(0, 120) });
      await deps.count("supervisor_sent"); out.sent++;
    } else {
      await deps.logTeam({ ...base, reason: "supervisor-flag", reply: r.why || r.text || "" });
      await deps.count("supervisor_flagged"); out.flagged++;
    }
  }
  return out;
}
