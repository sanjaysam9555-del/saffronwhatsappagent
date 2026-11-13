// L48: a chat the team is already in stays the team's, but a lead who asks for a call there must not sit among the ordinary "team is in this chat" rows.
// The agent still sends nothing; the hand-over is flagged URGENT (so the team alert goes out) and says what was asked and how to book it.
const ASKS_FOR_CALL = /\b(call|calls|calling|callback|video\s?call|zoom|google\s?meet|meet(?:ing)?|appointment|consultation|schedule)\b/i;
export const asksForCall = (t) => ASKS_FOR_CALL.test(String(t || ""));
// c: the saved contact. Vendors, job seekers and known contacts never reach here as leads (known ones are handled before).
export const teamChatReason = (text, c = {}) =>
  asksForCall(text) && c.kind !== "vendor" && !c.jobSeeker ? "lead-wants-call-in-team-chat" : "team-already-in-chat";
