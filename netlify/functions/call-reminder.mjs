import { listCalls, recordCall, removeCall, dueReminders, reminderParams } from "../../lib/calls.mjs";
import { sendTemplateMessage } from "../../lib/wati.mjs";
import { testAllows } from "../../lib/testmode.mjs";
import { incr } from "../../lib/metrics.mjs";
import { live } from "../../lib/sheet.mjs";
import { logNeedsTeam } from "../../lib/needsteam.mjs";

// Every 15 minutes: a WhatsApp reminder the day before (10:00-13:00 IST) and about an hour before each booked call.
// Needs the approved template named in CALL_REMINDER_TEMPLATE; without it nothing is sent. Nothing is sent unless the agent is live.
export const config = { schedule: "*/15 * * * *" };

export default async () => {
  const tpl = (process.env.CALL_REMINDER_TEMPLATE || "").trim();
  if (!live()) return console.log("Not live: no call reminders.");
  if (!tpl) return console.log("CALL_REMINDER_TEMPLATE not set: no call reminders.");
  const now = Date.now();
  const calls = await listCalls();
  for (const c of calls) if (c.start && now - c.start > 36 * 3600_000) await removeCall(c.id); // tidy up old ones
  let sent = 0;
  for (const { call, kind } of dueReminders(calls, now)) {
    if (!testAllows({ waId: call.waId })) continue;
    try {
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
