// Gentle follow-ups for WhatsApp leads who have not answered something we asked, whoever asked it: the agent or your team.
//   First follow-up: a short message in the chat, written by Claude from the real conversation, a few hours after our last message,
//                    while WhatsApp's 24-hour window is still open. If our last message did not need an answer, nothing is sent.
//   Second (agent chats only): one approved template the next day. Then it stops for good.
//   Chats your team has spoken in: only the first follow-up; the existing quiet follow-ups (every 2 days, 3 times) carry on after it.
// Any reply from the lead starts the count again.
export const NUDGE_CFG = {
  afterMs: () => Number(process.env.NUDGE_AFTER_HOURS || 3) * 3600_000,       // agent chats: quiet this long after our last message
  teamAfterMs: () => Number(process.env.NUDGE_TEAM_AFTER_HOURS || 6) * 3600_000, // chats your team is in: wait a little longer
  windowMs: 23 * 3600_000,                                                    // WhatsApp lets us write freely for 24h after their last message
  reminderGapMs: 18 * 3600_000,                                               // the template goes at least this long after the first follow-up
  staleMs: 5 * 24 * 3600_000,                                                 // never chase a chat whose last message from them is older than this
  from: () => Number(process.env.SEND_FROM_HOUR || 10),
  to: () => Number(process.env.SEND_TO_HOUR || 20),
  // Chats whose last message from the lead is older than this are never touched, so switching this on does not message people from before it existed.
  notBefore: () => Date.parse(process.env.NUDGE_NOT_BEFORE || "2026-10-22T17:30:00Z"),
};
const IN_FLOW = ["asking", "confirm", "call", "slots", "email"];

// Pure. "SESSION" (message in the chat), "TEMPLATE" (the approved reminder) or null (leave alone).
// The caller re-reads the real chat first, so lastIn / lastOut here are the true times of the last message from them / from us.
export function nudgeKind(c, now = Date.now(), hourIST = 12, cfg = NUDGE_CFG) {
  if (!c) return null;
  const agentChat = Boolean(c.q && IN_FLOW.includes(c.q.stage));
  if (!agentChat && !c.humanSpoke) return null;
  if (c.dnc || c.hold || c.skip || c.kind === "vendor") return null;
  if (c.esc && !c.humanSpoke) return null; // waiting for your team to answer them: not theirs to answer
  if (!c.lastIn || !c.lastOut || c.lastOut < c.lastIn) return null; // the lead spoke last: nothing to chase
  if (c.lastIn < cfg.notBefore()) return null;
  if (hourIST < cfg.from() || hourIST >= cfg.to()) return null;
  const n = c.nudges || 0;
  if (n === 0) return now - c.lastOut >= (c.humanSpoke ? cfg.teamAfterMs() : cfg.afterMs()) && now - c.lastIn < cfg.windowMs ? "SESSION" : null;
  if (n === 1 && !c.humanSpoke) return c.nudgedAt && now - c.nudgedAt >= cfg.reminderGapMs && now - c.lastIn >= cfg.windowMs && now - c.lastIn < cfg.staleMs ? "TEMPLATE" : null;
  return null;
}
