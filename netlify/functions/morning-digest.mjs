import { google } from "googleapis";
import { sendTemplateMessage } from "../../lib/wati.mjs";

// 09:30 IST daily: one WhatsApp to the team lead with how many stuck Instagram leads need a human.
// Counts rows on the "IG Nudges" tab whose Done column (H) is empty.
export const config = { schedule: "0 4 * * *" };

export function summarise(rows) {
  const open = rows.slice(1).filter((r) => r[0] && !String(r[7] ?? "").trim());
  return { total: open.length, urgent: open.filter((r) => r[1] === "URGENT").length };
}

export default async () => {
  const to = (process.env.TEAM_ALERT_NUMBER || "").replace(/\D/g, "");
  if (!to || !process.env.TEAM_DIGEST_TEMPLATE) return console.log("TEAM_ALERT_NUMBER / TEAM_DIGEST_TEMPLATE not set.");

  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.LEADS_SHEET_ID, range: "IG Nudges!A:H",
  });
  const { total, urgent } = summarise(data.values || []);
  if (!total) return console.log("Nothing waiting; no digest sent.");

  await sendTemplateMessage(
    to, process.env.TEAM_DIGEST_TEMPLATE,
    [String(total), String(urgent), `https://docs.google.com/spreadsheets/d/${process.env.LEADS_SHEET_ID}`],
    "team-digest",
  );
};
