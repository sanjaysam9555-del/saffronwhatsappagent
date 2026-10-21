import { sendTemplateMessage } from "../../lib/wati.mjs";
import { listContacts } from "../../lib/contacts.mjs";
import { getDay, istDay } from "../../lib/metrics.mjs";
import { sheetsClient, sheetReady, live } from "../../lib/sheet.mjs";

// 20:30 IST every day. Full breakdown goes on the "Daily Summary" tab; a short WhatsApp headline goes to you.
// "Daily Summary" headers: Date | New leads | Summaries sent | WA leads started | WA leads completed | WA leads confirmed |
//   IG nudges sent | IG nudges failed | WA finish sent | Quiet follow-ups | Vendor links | Escalations | Opt-outs |
//   Awaiting team | Open nudges | Urgent nudges | Details
export const config = { schedule: "0 15 * * *" };

const DAY = 24 * 3600_000;

export function buildSummary(m, open) {
  const n = (k) => m[k] || 0;
  const lines = [
    `New leads from Instagram sheet: ${n("new_leads")}`,
    `Completed Instagram flows, WhatsApp confirmation sent: ${n("summaries_sent")}`,
    `Instagram stepped in on (ManyChat): ${n("ig_nudges_sent")} sent, ${n("ig_nudges_failed")} failed`,
    `Moved to WhatsApp to finish details: ${n("wa_finish_sent")}`,
    `WhatsApp leads: ${n("wa_leads_started")} started, ${n("wa_continued_from_ig")} continued from Instagram, ${n("wa_leads_completed")} completed, ${n("wa_leads_confirmed")} confirmed`,
    `Quiet follow-ups sent: ${n("quiet_followups_sent")}`,
    `Vendor sign-up links sent: ${n("vendor_links_sent")}`,
    `Passed to the team: ${n("escalations")}   Opt-outs: ${n("opt_outs")}`,
    `Went cold today: ${n("cold_leads")}`,
    "",
    `WAITING ON YOU: ${open.awaiting} chats need a reply, ${open.nudges} Instagram nudges to send by hand (${open.urgent} urgent)`,
  ];
  return lines.join("\n");
}

export default async () => {
  const day = istDay();
  const m = await getDay(day);
  const now = Date.now();

  const awaitingList = (await listContacts()).filter(([, c]) => c.esc && c.escAt && now - c.escAt < 3 * DAY && !c.dnc);
  let nudges = 0, urgent = 0;
  if (sheetReady()) {
    try {
      const { data } = await sheetsClient(true).spreadsheets.values.get({ spreadsheetId: process.env.LEADS_SHEET_ID, range: "IG Nudges!A:H" });
      const open = (data.values || []).slice(1).filter((r) => r[0] && !String(r[7] ?? "").trim());
      nudges = open.length;
      urgent = open.filter((r) => r[1] === "URGENT").length;
    } catch (e) { console.warn("nudge tab:", e.message); }
  }
  const open = { awaiting: awaitingList.length, nudges, urgent };
  const details = buildSummary(m, open) +
    (awaitingList.length ? "\n\nChats waiting on you:\n" + awaitingList.slice(0, 15).map(([id, c]) => `- ${c.name || id}: "${(c.escText || "").slice(0, 80)}"`).join("\n") : "");

  const n = (k) => m[k] || 0;
  const row = [day, n("new_leads"), n("summaries_sent"), n("wa_leads_started"), n("wa_leads_completed"), n("wa_leads_confirmed"),
    n("ig_nudges_sent"), n("ig_nudges_failed"), n("wa_finish_sent"), n("quiet_followups_sent"), n("vendor_links_sent"),
    n("escalations"), n("opt_outs"), open.awaiting, nudges, urgent, details];

  if (!live()) return console.log("[DRY_RUN] daily summary:\n" + details);

  if (sheetReady()) {
    await sheetsClient().spreadsheets.values.append({
      spreadsheetId: process.env.LEADS_SHEET_ID, range: "Daily Summary!A:Q", valueInputOption: "RAW", requestBody: { values: [row] },
    });
  }
  const to = (process.env.OWNER_NUMBER || "").replace(/\D/g, "");
  if (to && process.env.OWNER_SUMMARY_TEMPLATE) {
    const completed = n("summaries_sent") + n("wa_leads_completed");
    const followups = n("ig_nudges_sent") + n("wa_finish_sent") + n("quiet_followups_sent");
    await sendTemplateMessage(to, process.env.OWNER_SUMMARY_TEMPLATE, [
      day, String(n("new_leads") + n("wa_leads_started")), String(completed), String(followups),
      String(open.awaiting + urgent), `https://docs.google.com/spreadsheets/d/${process.env.LEADS_SHEET_ID}`,
    ], "owner-summary");
  }
};
