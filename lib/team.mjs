import { getRecentMessages } from "./wati.mjs";

// A message from our number counts as "the agent" if it was sent within this long of a send the agent recorded.
export const AGENT_MATCH_MS = 150_000;

// Pure: read a chat history (oldest first) and say who spoke. Messages from your number that the agent did not send
// (typed in the Business App or in Wati's inbox) mean a person on your team has been in this chat.
export function analyse(msgs, agentSends = []) {
  const ours = (t) => agentSends.some((s) => Math.abs(s - t) <= AGENT_MATCH_MS);
  let lastTeamAt = 0, lastAgentAt = 0, lastCustomerAt = 0;
  for (const m of msgs) {
    if (m.from === "customer") lastCustomerAt = Math.max(lastCustomerAt, m.t);
    else if (ours(m.t)) lastAgentAt = Math.max(lastAgentAt, m.t);
    else lastTeamAt = Math.max(lastTeamAt, m.t);
  }
  return { teamSpoke: lastTeamAt > 0, lastTeamAt, lastAgentAt, lastCustomerAt, lastOutAt: Math.max(lastTeamAt, lastAgentAt) };
}

// Reads Wati's stored chat. Returns null if it could not be read (callers should then fail safe, not assume "no team").
export async function readChat(waId, contact = {}, pageSize = 30) {
  const msgs = await getRecentMessages(waId, pageSize);
  if (!msgs) return null;
  return analyse(msgs, contact.agentSends || (contact.agentSent ? [contact.agentSent] : []));
}
