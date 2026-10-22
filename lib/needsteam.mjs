import { sheetsClient, sheetReady, live } from "./sheet.mjs";
import { sendTemplateMessage } from "./wati.mjs";
import { allow } from "./state.mjs";
import { countryOf, theirTime } from "./phone.mjs";

// The "Needs Team" tab is the one place to see everything the agent handed to a person.
// Columns: Time (IST) | Channel | Name | Number | Country / their time | Why | Priority | Their last message | Agent replied | Done
export const TAB = "Needs Team";
export const HEADERS = ["Time (IST)", "Channel", "Name", "Number", "Country / their time now", "Why", "Priority", "Their last message", "Agent replied", "Done"];
const DONE_COL = 9;

// reason code -> [plain words for the team, urgent?]. Urgent ones also send an instant WhatsApp alert.
export const REASONS = {
  "money-or-commitment": ["Asked about payment, discount or contract", true],
  "pricing-or-availability-question": ["Asked about dates or availability", true],
  "lead-question": ["Asked a question during the questions", true],
  "existing-client": ["Says they are an existing client", true],
  "ready-for-call": ["Ready for the Founders' call. Send times and the Meet invite", true],
  "lead-added-details": ["Added extra details after the summary", false],
  "call-time-request": ["Wants a different time for the Founders' call. Please arrange it", true],
  "call-needs-invite": ["Chose a call time but gave no email. Please send the invite", true],
  "call-confirmation-failed": ["Could not send the WhatsApp call confirmation. Please send it by hand", false],
  "call-booking-failed": ["Could not book the call automatically. Please book and invite them", true],
  "looks-like-vendor": ["Looks like a vendor or collaborator", false],
  "who-is-this": ["Unclear who this is. Please check the chat", false],
  "media-received": ["Sent photos or a file", false],
  "team-already-in-chat": ["Your team is already in this chat", false],
  "history-unavailable": ["Could not read the chat history", false],
  "known-vendor": ["Known vendor wrote in", false],
  "known-client": ["Known client wrote in", false],
  "budget-under-40L": ["Mentioned a budget under about ₹40 lakh. Team to decide", false],
  "possible-duplicate": ["May be the same person as an Instagram lead", false],
  "unclear": ["Message the agent could not answer", false],
  "send-failed": ["The agent could not reply on Instagram. Please reply by hand", true],
};
export const describe = (reason) => REASONS[reason] || [reason, false];
export const isUrgent = (reason) => describe(reason)[1];

const istStamp = (d = new Date()) =>
  d.toLocaleString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

async function ensureTab(sheets, id) {
  try {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] } });
  } catch (e) { if (!/already exists/i.test(e.message)) throw e; return; }
  await sheets.spreadsheets.values.update({ spreadsheetId: id, range: `${TAB}!A1:J1`, valueInputOption: "RAW", requestBody: { values: [HEADERS] } });
}

export function openCounts(rows) {
  const open = rows.slice(1).filter((r) => r[0] && !String(r[DONE_COL] ?? "").trim());
  return { total: open.length, urgent: open.filter((r) => r[6] === "URGENT").length };
}

export async function readOpen() {
  try {
    const { data } = await sheetsClient(true).spreadsheets.values.get({ spreadsheetId: process.env.LEADS_SHEET_ID, range: `${TAB}!A:J` });
    return openCounts(data.values || []);
  } catch { return { total: 0, urgent: 0 }; }
}

// Add a row, and ping the team for urgent ones. Never throws: handing over to a person must not break the reply.
export async function logNeedsTeam({ waId, name = "", channel = "WhatsApp", reason, lastMsg = "", reply = "", contact = "" }) {
  const [why, urgent] = describe(reason);
  const c = countryOf(waId);
  const place = [c.name, theirTime(waId)].filter(Boolean).join(", ");
  const row = [istStamp(), channel, name, contact || (waId ? `+${waId}` : ""), place, why, urgent ? "URGENT" : "NORMAL", String(lastMsg).slice(0, 200), String(reply).slice(0, 120), ""];
  if (!live() || !sheetReady()) return console.log("[DRY_RUN] needs-team", JSON.stringify(row));
  try {
    const sheets = sheetsClient();
    const id = process.env.LEADS_SHEET_ID;
    const append = () => sheets.spreadsheets.values.append({ spreadsheetId: id, range: `${TAB}!A:J`, valueInputOption: "RAW", requestBody: { values: [row] } });
    try { await append(); } catch (e) {
      if (!/Unable to parse range|not found/i.test(e.message)) throw e;
      await ensureTab(sheets, id);
      await append();
    }
  } catch (e) { console.error("needs-team log:", e.message); }

  // Instant alert: urgent only, at most one per person every 3 hours. Uses the same template as the morning digest
  // (counts + sheet link), so it needs no extra WhatsApp template approval.
  try {
    const to = (process.env.TEAM_ALERT_NUMBER || "").replace(/\D/g, "");
    const tpl = process.env.TEAM_ALERT_TEMPLATE || process.env.TEAM_DIGEST_TEMPLATE;
    if (urgent && to && tpl && waId && (await allow(`alert:${waId}`, 3 * 3600_000))) {
      const { total, urgent: u } = await readOpen();
      await sendTemplateMessage(to, tpl, {
        lead_count: String(Math.max(total, 1)), urgent_count: String(Math.max(u, 1)),
        sheet_link: `https://docs.google.com/spreadsheets/d/${process.env.LEADS_SHEET_ID}`,
      }, "team-alert");
    }
  } catch (e) { console.error("team alert:", e.message); }
}
