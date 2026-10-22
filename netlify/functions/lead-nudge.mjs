import { sendSessionMessage, sendTemplateMessage, getRecentMessages } from "../../lib/wati.mjs";
import { analyse } from "../../lib/team.mjs";
import { testAllows } from "../../lib/testmode.mjs";
import { listContacts, saveContact } from "../../lib/contacts.mjs";
import { incr } from "../../lib/metrics.mjs";
import { live } from "../../lib/sheet.mjs";
import { logExchange } from "../../lib/playbook.mjs";
import { draftFollowUp, draftNudge } from "../../lib/claude.mjs";
import { nudgeAsk } from "../../lib/qualify.mjs";
import { nudgeKind, NUDGE_CFG } from "../../lib/nudge.mjs";

// Every 30 minutes, 10:00-20:00 IST only. See lib/nudge.mjs for the rules. Nothing is sent unless the agent is live.
export const config = { schedule: "*/30 * * * *" };

const istHour = () => Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));

export default async () => {
  const h = istHour();
  const from = Number(process.env.SEND_FROM_HOUR || 10), to = Number(process.env.SEND_TO_HOUR || 20);
  if (h < from || h >= to) return console.log(`Outside sending hours (IST ${h}:00).`);
  if (!live()) return console.log("Not live: no follow-ups.");
  const template = (process.env.NUDGE_TEMPLATE || (process.env.QUIET_TEMPLATES || "").split(",")[0] || "").trim();
  const max = Number(process.env.MAX_PER_RUN || 10);
  const now = Date.now();
  let sent = 0, reminders = 0, looked = 0;
  for (const [waId, c0] of await listContacts()) {
    if (sent + reminders >= max || looked >= 60) break;
    if (!testAllows({ waId })) continue;
    // Cheap pre-check on what we remember (the real chat is read next): active in the last day, not a stopped, held or vendor chat.
    if (c0.dnc || c0.hold || c0.skip || c0.kind === "vendor" || !c0.lastIn || c0.lastIn < NUDGE_CFG.notBefore() || now - c0.lastIn >= NUDGE_CFG.staleMs) continue;
    if ((c0.nudges || 0) >= 2) continue;
    looked++;
    // Messages typed in the Business App never reach the webhook, so read the real chat. If we cannot see it, do nothing.
    const msgs = await getRecentMessages(waId, 20);
    if (!msgs) continue;
    const chat = analyse(msgs, c0.agentSends || (c0.agentSent ? [c0.agentSent] : []));
    if (!chat.lastOutAt) continue;
    let c = c0;
    if (chat.teamSpoke && !c.humanSpoke) c = await saveContact(waId, { humanSpoke: true });
    if (chat.lastCustomerAt && chat.lastCustomerAt > chat.lastOutAt) { await saveContact(waId, { lastIn: chat.lastCustomerAt }); continue; } // they replied: nothing to chase
    c = { ...c, lastIn: chat.lastCustomerAt || c.lastIn, lastOut: chat.lastOutAt };
    if (c.nudgeSkipFor === chat.lastOutAt) continue; // already looked at this exact last message: it did not need an answer
    const kind = nudgeKind(c, now, h);
    if (!kind || (kind === "TEMPLATE" && !template)) continue;
    const n = c.nudges || 0;
    const first = String(c.name || "").split(" ")[0] || "there";
    try {
      if (kind === "SESSION") {
        let msg = "";
        const f = await draftFollowUp({ name: first === "there" ? "" : first, history: msgs, fields: c.q?.fields });
        if (f && !f.send) { await saveContact(waId, { nudgeSkipFor: chat.lastOutAt }); continue; } // our last message was not waiting for an answer
        if (f?.send) msg = f.reply;
        else if (c.q && !c.humanSpoke) { // Claude unavailable: in the agent's own chats, fall back to a plain line plus the question we were waiting on
          const line = (await draftNudge({ name: first === "there" ? "" : first, fields: c.q.fields })) || "Just checking in. We would love to continue whenever you are ready. 🌼";
          msg = [line, nudgeAsk(c.q)].filter(Boolean).join("\n\n");
        } else continue; // chats your team is in: never send a generic line
        await saveContact(waId, { agentSent: Date.now() });
        await sendSessionMessage(waId, msg);
        await logExchange({ channel: "WhatsApp", contact: `+${waId}`, lead: "(no reply yet)", agent: msg });
        await incr("nudges_sent"); sent++;
      } else {
        await saveContact(waId, { agentSent: Date.now() });
        await sendTemplateMessage(waId, template, { first_name: first }, "lead-nudge");
        await logExchange({ channel: "WhatsApp", contact: `+${waId}`, lead: "(no reply yet)", agent: `Reminder template ${template} sent` });
        await incr("nudge_reminders_sent"); reminders++;
      }
      await saveContact(waId, { nudges: n + 1, nudgedAt: Date.now(), lastOut: Date.now(), agentSent: Date.now() });
    } catch (e) {
      console.error(`follow-up ${waId}:`, e.message);
    }
  }
  console.log(`Follow-ups sent: ${sent} in chat, ${reminders} reminders.`);
};
