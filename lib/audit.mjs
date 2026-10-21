import { OPTOUT } from "./rules.mjs";

const DAY = 24 * 3600_000;
export const AUDIT_HEADERS = ["Sheet row", "Name", "WhatsApp", "Event date", "Details", "Chat status", "Last from us", "Last from lead", "Quiet days", "Suggested action", "Approve (Y/N)", "Result"];

export function classifyLead(a, chat, analysed, followups = 0, now = Date.now()) {
  if (!a.waId) return { status: "No valid number", action: a.question ? "TEAM" : "MANUAL", why: a.question ? "Asked a question on Instagram" : "Get number from Instagram chat" };
  if (chat === null) return { status: "Chat unreadable", action: "MANUAL", why: "Could not read Wati, check by hand" };
  if (chat.some((m) => m.from === "customer" && OPTOUT.test(m.text))) return { status: "Opted out", action: "SKIP", why: "Asked us to stop" };
  const detailsAction = a.complete ? "SEND_SUMMARY" : "SEND_FINISH";
  if (!chat.length) return { status: "Never contacted", action: detailsAction, why: a.complete ? "Send confirm-details message" : "Send message asking for missing details" };
  const { teamSpoke, lastOutAt, lastCustomerAt } = analysed;
  const quiet = Math.floor((now - Math.max(lastOutAt, lastCustomerAt)) / DAY);
  if (lastCustomerAt > lastOutAt) return { status: "Lead wrote last", action: "TEAM", why: "Waiting for a reply from the team", quiet };
  if (!lastCustomerAt && !teamSpoke) return { status: "Agent messaged, no reply", action: quiet >= 2 && detailsAction === "SEND_FINISH" ? "SEND_FINISH" : "WAIT", why: "Only our automated message so far", quiet };
  if (!teamSpoke) return { status: "Replied to agent", action: "TEAM", why: "Lead replied, team has not spoken yet", quiet };
  if (followups >= 3) return { status: "Follow-ups used up", action: "WAIT", why: "3 follow-ups already sent", quiet };
  if (quiet < 2) return { status: "Team replied recently", action: "WAIT", why: "Under 2 days since our last message", quiet };
  return { status: lastCustomerAt ? "Went quiet after conversation" : "Team messaged, no reply", action: "QUIET_FOLLOWUP", why: `Follow-up ${followups + 1} of 3`, quiet };
}
