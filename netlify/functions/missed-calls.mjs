import { withChat } from "../../lib/readgate.mjs";
import { listCalls, touchCall } from "../../lib/calls.mjs";
import { sendSessionMessage, sendTemplateMessage, getRecentMessages } from "../../lib/wati.mjs";
import { getContact, saveContact } from "../../lib/contacts.mjs";
import { testAllows } from "../../lib/testmode.mjs";
import { incr } from "../../lib/metrics.mjs";
import { live } from "../../lib/sheet.mjs";
import { allow } from "../../lib/state.mjs";
import { logNeedsTeam } from "../../lib/needsteam.mjs";
import { logExchange } from "../../lib/playbook.mjs";
import { contextCheck } from "../../lib/presend.mjs";
import { afterCall, assess, nextStep, missedText, sharedText, missedParams, stepTemplate, windowOpen, inSendingHours, FIRST_AFTER_MS, GIVE_UP_AFTER_MS } from "../../lib/missed.mjs";

// Every 30 minutes (09:00-20:00 IST). A booked call that nobody picked up gets, from the agent itself:
//   1. a QUESTION ("we could not connect last time, would you like to connect at a different time?"). Times are offered only after the lead says yes (the WhatsApp handler does that),
//   2. a short follow-up a day later, 3. a last note two days after that, then the lead is marked cold and the team is told once.
// Rules and wording: lib/missed.mjs. A call counts as missed only when the team's own message says so, or the owner orders "agent, missed call <name>";
// when nobody has said, the team is asked once. Nothing is sent unless the agent is live. See docs/LESSONS.md L25.
export const config = { schedule: "*/30 * * * *" };

const HOUR = 3600_000;

export default () => withChat(() => runGated()); // every message that can leave runs inside the one-rule gate (lib/readgate.mjs)
const runGated = async () => {
  const now = Date.now();
  if (!live()) return console.log("Not live: no missed-call follow-ups.");
  if (!inSendingHours(now)) return console.log("Outside sending hours: no missed-call follow-ups.");
  let sent = 0, looked = 0;
  for (const call of await listCalls()) {
    if (looked >= 25) break;
    if (!call.waId || !call.start || now < call.start + FIRST_AFTER_MS || now > call.start + GIVE_UP_AFTER_MS + 3 * 24 * HOUR) continue;
    if (call.follow && !["asked"].includes(call.follow.state)) continue; // answered, closed, cold, or handed to the team
    if (!testAllows({ waId: call.waId })) continue;
    looked++;
    try {
      const c = await getContact(call.waId);
      if (c.dnc || c.kind === "vendor") continue;
      const msgs = await getRecentMessages(call.waId, 30);
      if (!msgs) continue; // could not read the chat: do nothing rather than guess
      const read = afterCall(msgs, call, c.agentSends || (c.agentSent ? [c.agentSent] : []));
      if (call.follow?.step) {
        const n = nextStep(call, read.lastCustomerAt, now, read);
        if (n.do === "send") sent += await deliver(call, n.step, read.lastCustomerAt, c, msgs, n.kind);
        else if (n.do === "cold") await goCold(call);
        else if (n.why === "replied") await touchCall(call.id, { follow: { ...call.follow, state: "replied" } });
        else if (n.why === "team" && n.do === "none") { console.log(`missed-calls: ${call.id}: the team has been in touch since our last note, chain stopped`); await touchCall(call.id, { follow: { ...call.follow, state: "team" } }); }
        continue;
      }
      const a = assess(call, read, now);
      if (a.do === "ask-team") {
        await touchCall(call.id, { teamAsked: now });
        await logNeedsTeam({ waId: call.waId, name: call.name, channel: call.channel, reason: "missed-call-check", lastMsg: `Call ${call.label}` });
        await incr("missed_checks");
      } else if (a.do === "send") sent += await deliver(call, 1, read.lastCustomerAt, c, msgs, a.kind);
      else console.log(`missed-calls: ${call.id}: ${a.do} (${a.why})`);
    } catch (e) { console.error(`missed-calls ${call.id}:`, e.message); }
  }
  console.log(`Missed-call follow-ups sent: ${sent}.`);
};

// Sends one step. Returns 1 if a message went out. A plain chat message while their 24-hour window is open, otherwise the approved template;
// without a template the team gets a line to do it by hand (and nothing more is sent automatically).
async function deliver(call, step, lastCustomerAt, c, msgs, kind = "") {
  const shared = kind === "shared";
  const text0 = shared ? sharedText(call.name) : missedText(step, call.name);
  // Claude reads the whole chat and the planned message before it goes (the one rule, lib/readgate.mjs). It is asked again at the next run if it said no.
  const v = await contextCheck({ channel: "WhatsApp", to: call.waId, history: msgs, planned: text0, purpose: shared ? `the booked call (${call.label}) was missed, then our team spoke to the lead and shared details; one simple follow-up asking if they had a chance to look at what was shared` : `the booked call (${call.label}) was not picked up; missed-call follow-up ${step} of 3` });
  if (!v.send) { console.log(`missed-calls: ${call.id}: Claude said not to send (${v.why})`); return 0; }
  if (!(await allow(`missed:${call.id}:${step}`, 12 * HOUR))) return 0; // never twice, even if two runs overlap
  const text = shared ? sharedText(call.name) : missedText(step, call.name);
  const tpl = stepTemplate(step, process.env, kind);
  const open = windowOpen(lastCustomerAt || c.lastIn);
  const now = Date.now();
  if (!open && !tpl) {
    await touchCall(call.id, { follow: { step, at: now, state: "manual", via: "no-template" } });
    await logNeedsTeam({ waId: call.waId, name: call.name, channel: call.channel, reason: "missed-call-due", lastMsg: `Call ${call.label}. Follow-up ${step} of 3`, reply: text });
    return 0;
  }
  try {
    await saveContact(call.waId, { agentSent: now }); // so Wati's echo is not mistaken for a person on the team
    if (open) await sendSessionMessage(call.waId, text);
    else await sendTemplateMessage(call.waId, tpl, missedParams(call.name), "missed-call");
  } catch (e) {
    console.error(`missed-call message ${call.id}:`, e.message);
    await touchCall(call.id, { follow: { step, at: now, state: "manual", via: "send-failed" } });
    await logNeedsTeam({ waId: call.waId, name: call.name, channel: call.channel, reason: "missed-call-due", lastMsg: `Call ${call.label}. Follow-up ${step} of 3 did not send: ${String(e.message).slice(0, 80)}`, reply: text });
    return 0;
  }
  // The agent now has this chat again: the lead's answer to the question is read by the WhatsApp handler (see wati-process-background, "missed").
  await saveContact(call.waId, { humanSpoke: false, esc: false, lastOut: now, lastOutText: text.slice(0, 600), missed: { callId: call.id, step, askedAt: now, state: "asked" } });
  await touchCall(call.id, { follow: { step, at: now, state: "asked", kind: shared ? "shared" : undefined, via: open ? "chat" : "template" } });
  await logExchange({ channel: "WhatsApp", contact: `+${call.waId}`, lead: "(missed call, no reply yet)", agent: open ? text : `Template ${tpl} sent: ${text}` });
  await incr(`missed_followups_${step}`);
  return 1;
}

async function goCold(call) {
  await touchCall(call.id, { follow: { ...call.follow, state: "cold" } });
  const c = await getContact(call.waId);
  if (c.missed) await saveContact(call.waId, { missed: { ...c.missed, state: "cold" } });
  await logNeedsTeam({ waId: call.waId, name: call.name, channel: call.channel, reason: "missed-call-cold", lastMsg: `Call ${call.label}. Three follow-ups, no reply` });
  await incr("missed_cold");
}
