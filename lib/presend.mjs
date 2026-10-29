// Before any message that no lead has just asked for (a follow-up, a reminder, a missed-call note, a message the owner ordered), Claude is given the
// real chat and the message we plan to send, and says whether to send it. Fails closed: if the chat cannot be read or Claude cannot answer, nothing is sent.
// This is also what hands Claude the chat for the gate in lib/readgate.mjs (docs/LESSONS.md L35).
import { callTools } from "./operator.mjs";
import { noteRead } from "./readgate.mjs";

const clip = (s, n = 300) => String(s ?? "").slice(0, n);
const TOOLS = [
  { name: "send_it", description: "The planned message fits this chat as it stands now. Send it.", input_schema: { type: "object", properties: { why: { type: "string", description: "One short reason" } }, required: ["why"] } },
  { name: "do_not_send", description: "Do not send: the chat shows it would be wrong (they already answered, asked something else, asked us to stop, the team is handling it, the call was cancelled or moved, it repeats or contradicts what was said).", input_schema: { type: "object", properties: { why: { type: "string", description: "One short reason for the team" } }, required: ["why"] } },
];

const SYSTEM = `You are the last reader before Saffron Collective (luxury wedding and event planning, Gurugram) sends an automatic message to a lead. You get the real chat (oldest first) and the message we plan to send, and the reason it is being sent. Decide by calling exactly one tool.
Read the WHOLE chat first. Send it only if it fits the chat as it stands right now. Do NOT send if: the lead already gave what the message asks for; the lead asked something or wrote last and a reply is needed instead; the lead asked us to stop or said they are not interested; our team is already talking to them or the call took place; the call was cancelled, moved or already confirmed; it repeats or rephrases what we already said; or it contradicts the chat. If the chat is empty, the planned message may still be right when the reason says it is a first message.
When the owner ordered the message, refuse ONLY if it clearly contradicts the chat (for example it repeats what was just sent, or the lead asked us to stop).`;

const lineOf = (m) => `${m.from === "customer" ? "THEM" : "US"}: ${clip(m.text)}`;

// Returns { send: boolean, why }. channel: "WhatsApp" | "Instagram". to: the WhatsApp number or Instagram id the message goes to.
// history: the chat, oldest first (null/undefined = it could not be read: nothing is sent).
export async function contextCheck({ channel = "WhatsApp", to, history, planned, purpose = "", state = "", ordered = false }) {
  if (!Array.isArray(history)) return { send: false, why: "the chat could not be read" };
  noteRead(to); // the caller read this chat (WhatsApp reads already did; this covers an Instagram record)
  const calls = await callTools({
    system: SYSTEM,
    chat: history,
    messages: [{ role: "user", content: `Channel: ${channel}\nWhy this message is being sent: ${purpose || "automatic follow-up"}${ordered ? " (the owner ordered it)" : ""}\n${state ? `What we know: ${clip(state, 500)}\n` : ""}\nChat so far (oldest first):\n${history.slice(-20).map(lineOf).join("\n") || "(no earlier messages)"}\n\nMESSAGE WE PLAN TO SEND:\n${clip(planned, 900)}` }],
    tools: TOOLS,
    maxTokens: 200,
  });
  const c = calls?.[0];
  if (!c) return { send: false, why: "Claude could not check the chat" };
  return c.name === "send_it" ? { send: true, why: clip(c.input?.why, 120) } : { send: false, why: clip(c.input?.why, 160) || "Claude said not to send" };
}
