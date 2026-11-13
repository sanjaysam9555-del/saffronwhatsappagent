// "agent, answer Yugdipinder": releases a chat the agent was holding back from (or had paused) and lets it answer the lead's last unanswered
// message exactly as it would have the moment it arrived. Nothing is sent from here: the message goes back into the normal WhatsApp handler,
// which reads the chat first and sends only through the one-rule gate (lib/readgate.mjs). See docs/LESSONS.md L43.
import { analyse } from "./team.mjs";

const HOUR = 3600_000;

// Pure: the messages the lead sent after the last thing we (the agent or a person) wrote, oldest first, at most 3.
export function unansweredTail(msgs = []) {
  const sorted = [...msgs].sort((a, b) => a.t - b.t);
  let i = sorted.length;
  while (i > 0 && sorted[i - 1].from === "customer") i--;
  const tail = sorted.slice(i).slice(-3);
  return { texts: tail.map((m) => m.text), lastAt: tail.length ? tail[tail.length - 1].t : 0 };
}

// deps: { getContact, readMsgs, setFlags, allow, post, now }. Returns { ok, why } or { ok: true, text }.
export async function answerLast(waId, deps) {
  const now = deps.now ? deps.now() : Date.now();
  const msgs = await deps.readMsgs(waId);
  if (!msgs) return { ok: false, why: "I could not read the chat just now, so I cannot see what is waiting. Try again in a minute." };
  const c = await deps.getContact(waId);
  const tail = unansweredTail(msgs);
  if (!tail.texts.length) return { ok: false, why: "the last message in the chat is ours, so nothing is waiting for an answer." };
  const chat = analyse(msgs, c.agentSends || (c.agentSent ? [c.agentSent] : []));
  if (chat.teamSpoke) return { ok: false, why: "your team has already written in this chat, and the agent stays out of chats a person is in. Reply from Wati, or tell me exactly what to send." };
  if (now - tail.lastAt > 23 * HOUR) {
    // L50: a closed 24-hour window is reopened with the approved check-in template (when one is set); their reply is then answered in context (followOpen, L44).
    if (!deps.reopen) return { ok: false, why: "their 24-hour WhatsApp window has closed, so a free message cannot be sent. A template message is needed." };
    if (!(await deps.allow(`reopen:${waId}`, 48 * HOUR))) return { ok: false, why: "I already sent them the check-in message in the last two days." };
    await deps.setFlags(waId, { esc: false, humanSpoke: false });
    const r = await deps.reopen(waId, c);
    if (!r?.ok) return { ok: false, why: r?.why || "I could not send the check-in message." };
    return { ok: true, reopened: true, text: tail.texts.join("\n") };
  }
  if (!(await deps.allow(`answer:${waId}:${tail.lastAt}`, 6 * HOUR))) return { ok: false, why: "I already released this message a moment ago." };
  await deps.setFlags(waId, { esc: false, humanSpoke: false });
  const text = tail.texts.join("\n");
  await deps.post({ eventType: "message", type: "text", owner: false, waId, text, senderName: c.name || "", id: `answer:${waId}:${tail.lastAt}`, replay: true, replayLastInAt: tail.lastAt });
  return { ok: true, text };
}
