// "agent, catch up": the agent goes back through the chats it may have handled badly or never really answered, reads each whole chat, and writes
// a corrective message that fits that lead. Two steps, so nothing reaches a lead unseen: a PREVIEW to the owner (who, what went wrong, the exact
// words), then "agent, catch up send". Every send still goes through the one-rule gate and Claude's last read (lib/presend.mjs). See docs/LESSONS.md L72.
import { callTools, safeReply, FACTS, STYLE, toolDef, str, clip, historyText, stateText } from "./operator.mjs";
import { oneEmoji } from "./understand.mjs";
import { checkOutgoing } from "./guard.mjs";

export const CATCHUP_CFG = {
  max: () => Number(process.env.CATCHUP_MAX || 20),                       // chats looked at per run
  lookbackMs: () => Number(process.env.CATCHUP_DAYS || 7) * 24 * 3600_000, // only chats whose last message from the lead is this recent
  windowMs: 23 * 3600_000,                                                // both channels let us write freely for 24h after the lead's last message
};

// Pure. Can this contact be looked at? Never: opted out, held for a person, vendors and job seekers, chats a person on the team has spoken in
// (their lead), and chats the lead has not written in lately. A chat the AGENT escalated (esc, but nobody on the team spoke) is exactly what we want.
export function catchUpEligible(c = {}, now = Date.now(), cfg = CATCHUP_CFG) {
  if (!c) return { ok: false, why: "no record" };
  if (c.dnc) return { ok: false, why: "asked us to stop" };
  if (c.skip || c.hold) return { ok: false, why: "held for a person" };
  if (c.kind === "vendor" || c.q?.kind === "vendor" || c.jobSeeker) return { ok: false, why: "vendor or job seeker" };
  if (c.humanSpoke) return { ok: false, why: "your team is in this chat" };
  if (!c.lastIn || now - c.lastIn > cfg.lookbackMs()) return { ok: false, why: "no message from them lately" };
  if (c.catchUpAt && c.catchUpAt > c.lastIn) return { ok: false, why: "already caught up since their last message" };
  return { ok: true, open: now - c.lastIn <= cfg.windowMs };
}

const TOOLS = [
  toolDef("send_message", "Something went wrong or was left unanswered in this chat and a short, warm message from us would put it right. Write that message.", {
    went_wrong: str("One short line for the owner: what we got wrong or left unanswered"),
    text: str("The message to the lead"),
  }, ["went_wrong", "text"]),
  toolDef("flag_for_team", "A person must handle this: it needs a price, availability, a promise, a decision, or the situation is delicate.", { why: str("One short reason for the team") }, ["why"]),
  toolDef("leave_alone", "Nothing to put right: the chat is in order, it needs no answer, they said no thanks or asked us to stop, or a person is already on it.", { why: str("One short reason") }, ["why"]),
];

const SYSTEM = `You are the quality reviewer at Saffron Collective's front desk. You get one whole chat (oldest first) with a lead. Our automatic agent may have handled it badly, and your job is to find out by READING it, then put it right with one tool.
Look for what WE got wrong or never really answered, whatever the words: we asked the same thing twice; we answered as if they had refused when they had actually given what we asked (for example sent their number and we said a number is optional); we held or handed over a question we could have answered; we ignored a question or a detail they gave; we asked something they had already told us; we promised a reply that never came; we said something that does not fit what they said; we left them hanging after a clear request.
Understand misspellings, Hinglish and short broken English. Read what they MEAN.
If you send a message: it continues the chat from where it really stands. Own the slip in one short, natural clause only when we clearly erred ("Sorry for the mix-up", "Apologies for the repeat"), never grovelling. Answer or carry on using what they told us, ask at most one question, and never repeat what the chat already shows. Use their first name only if sure.
Prices, fees, availability of a date, promises, or anything you are not sure of: use flag_for_team. If nothing is wrong, or they said no thanks, or they have not written for a while with nothing open: leave_alone.

${FACTS}

${STYLE}`;

// Claude reads one chat. Returns { kind: "send", text, wentWrong } | { kind: "team", why } | { kind: "leave", why } | null (Claude not reachable).
export async function reviewForCatchUp({ channel = "WhatsApp", name = "", history = [], state = {}, open = true }) {
  if (!Array.isArray(history) || !history.length) return null;
  const calls = await callTools({
    system: SYSTEM,
    messages: [{ role: "user", content: `Channel: ${channel}\nProfile name: ${name || "unknown"}\nTheir free-message window is ${open ? "open" : "CLOSED (a message can only go as our approved check-in, so write nothing now unless it is worth that)"}.\n\nWhat we know:\n${stateText(state, history)}\n\nChat so far (oldest first):\n${historyText(history)}` }],
    tools: TOOLS,
    maxTokens: 700,
    chat: history,
  });
  const c = calls?.[0];
  if (!c) return null;
  const i = c.input || {};
  if (c.name === "flag_for_team") return { kind: "team", why: clip(i.why, 160) };
  if (c.name !== "send_message") return { kind: "leave", why: clip(i.why, 160) };
  const v = safeReply(i.text);
  if (!v.ok) return { kind: "team", why: `Draft was blocked (${v.why}): ${clip(i.went_wrong, 100)}` };
  const text = oneEmoji(v.text);
  const g = checkOutgoing({ msg: text, lastIn: [...history].reverse().find((m) => m.from === "customer")?.text || "", prev: {}, repeatOk: false });
  if (g.action === "skip" || g.action === "handover") return { kind: "team", why: `Draft was blocked by the guard (${g.code})` };
  return { kind: "send", text: g.msg || text, wentWrong: clip(i.went_wrong, 160) };
}

// deps: { wa(): [{id,name,c}], ig(): [{id,name,c}], read(channel,id): history|null, now(), save(plan), }
// Returns { items: [{channel,id,name,kind,text,wentWrong,why,open}], skipped: n }.
export async function catchUpPlan(deps, { scope = "all" } = {}) {
  const now = deps.now ? deps.now() : Date.now();
  const pools = [];
  if (scope !== "instagram") pools.push(...(await deps.wa()).map((x) => ({ ...x, channel: "WhatsApp" })));
  if (scope !== "whatsapp") pools.push(...(await deps.ig()).map((x) => ({ ...x, channel: "Instagram" })));
  const eligible = pools.map((p) => ({ ...p, e: catchUpEligible(p.c, now) })).filter((p) => p.e.ok).sort((a, b) => (b.c.lastIn || 0) - (a.c.lastIn || 0));
  const items = [];
  for (const p of eligible.slice(0, CATCHUP_CFG.max())) {
    const history = await deps.read(p.channel, p.id, p.c);
    if (!Array.isArray(history) || !history.length) { items.push({ channel: p.channel, id: p.id, name: p.name, kind: "unread", why: "I could not read the chat" }); continue; }
    const r = await reviewForCatchUp({ channel: p.channel, name: p.name, history, state: p.c.q || {}, open: p.e.open });
    if (!r) { items.push({ channel: p.channel, id: p.id, name: p.name, kind: "unread", why: "Claude could not be reached" }); continue; }
    if (r.kind === "leave") continue;
    items.push({ channel: p.channel, id: p.id, name: p.name, open: p.e.open, lastIn: p.c.lastIn, ...r });
  }
  return { items, skipped: eligible.length - Math.min(eligible.length, CATCHUP_CFG.max()) };
}

const label = (it) => `${it.name || "No name"} (${it.channel === "WhatsApp" ? `+${it.id}` : "Instagram"})`;

// The owner's preview. Plain text for WhatsApp.
export function previewText({ items = [], skipped = 0 } = {}) {
  const sends = items.filter((i) => i.kind === "send"), team = items.filter((i) => i.kind === "team"), unread = items.filter((i) => i.kind === "unread");
  if (!items.length) return "I went through the recent chats and found nothing to put right.";
  const out = [];
  if (sends.length) out.push(`I would write to ${sends.length}:\n\n` + sends.map((i, n) => `${n + 1}. ${label(i)}${i.open ? "" : " (window closed: " + (i.channel === "WhatsApp" ? "approved check-in only" : "cannot send on Instagram, your team must") + ")"}\nWrong: ${i.wentWrong}\nSay: "${i.text}"`).join("\n\n"));
  if (team.length) out.push(`For your team:\n` + team.map((i) => `- ${label(i)}: ${i.why}`).join("\n"));
  if (unread.length) out.push(`Could not check: ` + unread.map((i) => `${label(i)} (${i.why})`).join(", "));
  if (skipped) out.push(`${skipped} more chats are waiting for the next round.`);
  if (sends.length) out.push(`Reply "agent, catch up send" to send these, or "agent, catch up skip <name>" first to leave one out. Nothing is sent until then.`);
  return out.join("\n\n");
}

// Sends what was previewed. deps: { send(item): Promise<{ok,why}>, mark(item), skip: [names] }. Each send re-reads the chat inside deps.send.
export async function catchUpSend(plan, deps, { skip = [] } = {}) {
  const left = skip.map((s) => String(s).toLowerCase());
  const done = [], held = [];
  for (const it of (plan?.items || []).filter((i) => i.kind === "send")) {
    if (left.some((s) => s && String(it.name || "").toLowerCase().includes(s))) { held.push(`${label(it)}: left out as you asked`); continue; }
    try {
      const r = await deps.send(it);
      if (r?.ok) { done.push(label(it)); await deps.mark(it); } else held.push(`${label(it)}: ${r?.why || "not sent"}`);
    } catch (e) { held.push(`${label(it)}: ${clip(e.message, 120)}`); }
  }
  return `Sent to ${done.length}${done.length ? ": " + done.join(", ") : ""}.${held.length ? "\n\nNot sent:\n" + held.map((h) => "- " + h).join("\n") : ""}`;
}
