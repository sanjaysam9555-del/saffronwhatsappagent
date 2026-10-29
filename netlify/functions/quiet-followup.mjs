import { withChat } from "../../lib/readgate.mjs";
import { sendTemplateMessage } from "../../lib/wati.mjs";
import { readChatFull } from "../../lib/team.mjs";
import { contextCheck } from "../../lib/presend.mjs";
import { testAllows } from "../../lib/testmode.mjs";
import { listContacts, saveContact } from "../../lib/contacts.mjs";
import { incr } from "../../lib/metrics.mjs";
import { sheetsClient, sheetReady, live } from "../../lib/sheet.mjs";

// Daily at 11:00 IST (sends only 10:00-20:00 IST). Follows up with people a human has already spoken to who then
// went quiet: every 2 days after our last message, up to 3 times, then stops. Never after an opt-out, for vendors,
// while a message is waiting for the team, or once the person has replied since our last message.
// Contacts found by the 90-day chat backfill are held until you approve them on the "Chat Review" tab.
export const config = { schedule: "30 5 * * *" }; // 11:00 IST

const DAY = 24 * 3600_000;
export const MIN_GAP_DAYS = 2;
export const MAX_FOLLOWUPS = 3;

export function isEligible(c, now = Date.now()) {
  return Boolean(
    c.humanSpoke && !c.dnc && !c.esc && !c.hold && !c.skip && c.kind !== "vendor" && c.lastOut &&
    (!c.lastIn || c.lastIn < c.lastOut) &&
    now - c.lastOut >= MIN_GAP_DAYS * DAY &&
    (c.followups || 0) < MAX_FOLLOWUPS,
  );
}

// "Chat Review" tab: WhatsApp | Name | Last message from | Last message | Quiet days | Messages from us | Approve (Y/N)
async function applyApprovals() {
  if (!sheetReady()) return;
  try {
    const { data } = await sheetsClient(true).spreadsheets.values.get({ spreadsheetId: process.env.LEADS_SHEET_ID, range: "Chat Review!A:G" });
    for (const r of (data.values || []).slice(1)) {
      const waId = String(r[0] || "").replace(/\D/g, "");
      const v = String(r[6] || "").trim().toUpperCase();
      if (!waId) continue;
      if (v === "Y") await saveContact(waId, { hold: false });
      else if (v === "N") await saveContact(waId, { skip: true, hold: false });
    }
  } catch (e) { console.warn("applyApprovals:", e.message); }
}

const istHour = () =>
  Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));

export default () => withChat(() => runGated()); // every message that can leave runs inside the one-rule gate (lib/readgate.mjs)
const runGated = async () => {
  const h = istHour();
  const from = Number(process.env.SEND_FROM_HOUR || 10), to = Number(process.env.SEND_TO_HOUR || 20);
  if (h < from || h >= to) return console.log(`Outside sending hours (IST ${h}:00).`);
  // One approved template per attempt, e.g. QUIET_TEMPLATES=quiet_followup_1,quiet_followup_2,quiet_followup_3
  const templates = (process.env.QUIET_TEMPLATES || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (templates.length < MAX_FOLLOWUPS) return console.log("QUIET_TEMPLATES needs 3 template names; nothing to do.");

  await applyApprovals();
  const max = Number(process.env.MAX_PER_RUN || 10);
  let sent = 0, refreshed = 0;
  for (const [waId, c0] of await listContacts()) {
    if (sent >= max) break;
    if (!testAllows({ waId })) continue;
    let c = c0;
    let chatMsgs = null; // this contact's own chat only (never carried over from the previous one)
    // Business-App messages never reach the webhook, so re-read the stored chat before deciding. Approved or live contacts only.
    if (!c.dnc && !c.hold && !c.skip && !c.esc && c.kind !== "vendor" && refreshed < 80) {
      refreshed++;
      const chat = await readChatFull(waId, c);
      chatMsgs = chat?.msgs;
      if (!chat) continue; // can't see the chat: don't guess
      c = await saveContact(waId, {
        humanSpoke: c.humanSpoke || chat.teamSpoke,
        ...(chat.lastOutAt ? { lastOut: chat.lastOutAt } : {}),
        ...(chat.lastCustomerAt ? { lastIn: chat.lastCustomerAt } : {}),
      });
    }
    if (!isEligible(c)) continue;
    const n = c.followups || 0;
    try {
      // Claude reads the whole chat and the planned message before it goes (the one rule, lib/readgate.mjs). No chat read this run: nothing is sent.
      const v = await contextCheck({ channel: "WhatsApp", to: waId, history: chatMsgs, planned: `Approved quiet follow-up template ${n + 1} of ${MAX_FOLLOWUPS} ("${templates[n]}"): a gentle check-in`, purpose: "the lead has been quiet; gentle follow-up outside the chat window" });
      if (!v.send) { console.log(`quiet follow-up ${waId}: Claude said not to send (${v.why})`); continue; }
      await saveContact(waId, { agentSent: Date.now() }); // so the Sent event isn't mistaken for a human
      await sendTemplateMessage(waId, templates[n], { first_name: (c.name || "there").split(" ")[0] }, "quiet-followup");
      await saveContact(waId, { followups: n + 1, lastOut: Date.now(), agentSent: Date.now() });
      await incr("quiet_followups_sent");
      sent++;
    } catch (e) {
      console.error(`quiet follow-up ${waId}:`, e.message);
    }
  }
  console.log(`Quiet follow-ups ${live() ? "sent" : "(dry run)"}: ${sent}`);
};
