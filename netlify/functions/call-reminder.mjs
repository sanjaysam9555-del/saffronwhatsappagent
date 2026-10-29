import { contextCheck } from "../../lib/presend.mjs";
import { getRecentMessages } from "../../lib/wati.mjs";
import { withChat } from "../../lib/readgate.mjs";
import { listCalls, recordCall, removeCall, dueReminders, reminderParams } from "../../lib/calls.mjs";
import { KEEP_CALL_MS } from "../../lib/missed.mjs";
import { sendTemplateMessage } from "../../lib/wati.mjs";
import { testAllows } from "../../lib/testmode.mjs";
import { incr } from "../../lib/metrics.mjs";
import { live } from "../../lib/sheet.mjs";
import { logNeedsTeam } from "../../lib/needsteam.mjs";

// Every 15 minutes: a WhatsApp reminder the day before (10:00-13:00 IST) and about an hour before each booked call.
// Needs the approved template named in CALL_REMINDER_TEMPLATE; without it nothing is sent. Nothing is sent unless the agent is live.
export const config = { schedule: "*/15 * * * *" };

export default () => withChat(() => runGated()); // every message that can leave runs inside the one-rule gate (lib/readgate.mjs)
const runGated = async () => {
  const tpl = (process.env.CALL_REMINDER_TEMPLATE || "").trim();
  if (!live()) return console.log("Not live: no call reminders.");
  if (!tpl) return console.log("CALL_REMINDER_TEMPLATE not set: no call reminders.");
  const now = Date.now();
  const calls = await listCalls();
  for (const c of calls) if (c.start && now - c.start > KEEP_CALL_MS) await removeCall(c.id); // tidy up old ones (kept 8 days so a missed call can be followed up)
  let sent = 0;
  for (const { call, kind } of dueReminders(calls, now)) {
    if (!testAllows({ waId: call.waId })) continue;
    try {
      // Claude reads the whole chat before a reminder goes: the call may have been cancelled, moved or already talked about (the one rule, lib/readgate.mjs).
      const v = await contextCheck({ channel: "WhatsApp", to: call.waId, history: await getRecentMessages(call.waId, 20), planned: `Approved reminder template for the call on ${call.label} (${kind})`, purpose: "reminder for a booked Founders' call" });
      if (!v.send) {
        console.log(`call-reminder: ${call.id} ${kind}: Claude said not to send (${v.why})`);
        if (!/could not|cannot/i.test(v.why)) await recordCall({ ...call, sent: { ...(call.sent || {}), [kind]: -1 } }); // a real "no" is final; an unreadable chat is tried again next run
        continue;
      }
      await sendTemplateMessage(call.waId, tpl, reminderParams(call), "call-reminder");
      await recordCall({ ...call, sent: { ...(call.sent || {}), [kind]: now } });
      await incr(`call_reminders_${kind}`);
      sent++;
    } catch (e) {
      console.error(`call reminder ${call.id}:`, e.message);
      await recordCall({ ...call, sent: { ...(call.sent || {}), [kind]: -1 } }); // do not retry every 15 minutes
      await logNeedsTeam({ waId: call.waId, name: call.name, channel: call.channel, reason: "reminder-failed", lastMsg: `Call ${call.label}` }).catch(() => {});
    }
  }
  console.log(`Call reminders sent: ${sent}.`);
};
