import { sheetsClient, sheetReady } from "../../lib/sheet.mjs";
import { getRecentMessages } from "../../lib/wati.mjs";
import { analyse } from "../../lib/team.mjs";
import { getContact } from "../../lib/contacts.mjs";
import { assess, COL } from "../../lib/leadfields.mjs";
import { classifyLead, AUDIT_HEADERS } from "../../lib/audit.mjs";

const TAB = "Lead Audit";
const fmt = (t) => (t ? new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

export default async (req) => {
  if (new URL(req.url).searchParams.get("key") !== process.env.WEBHOOK_SECRET) return;
  if (!sheetReady()) return console.log("Sheet not configured.");
  const sheets = sheetsClient(), id = process.env.LEADS_SHEET_ID;
  const main = process.env.LEADS_SHEET_TAB || "Sheet1";

  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${main}!A:Q` });
  const rows = data.values || [];
  let old = [];
  try { old = (await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${TAB}!A:L` })).data.values?.slice(1) || []; }
  catch { await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] } }).catch(() => {}); }
  const kept = new Map(old.map((r) => [String(r[2] || "").replace(/\D/g, ""), { approve: r[10] || "", result: r[11] || "" }]));

  const out = [], stats = {};
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (!row.some((c) => String(c ?? "").trim())) continue;
    const a = assess(row);
    let r;
    let an = null;
    if (a.waId) {
      const chat = await getRecentMessages(a.waId, 40);
      const c = await getContact(a.waId);
      if (chat) an = analyse(chat, c.agentSends || []);
      r = classifyLead(a, chat, an, c.followups || 0);
      await new Promise((r2) => setTimeout(r2, 150));
    } else {
      r = classifyLead(a, null, null);
    }
    out.push(build(i + 1, row, a, r, an, kept));
    stats[r.status] = (stats[r.status] || 0) + 1;
  }
  await sheets.spreadsheets.values.clear({ spreadsheetId: id, range: `${TAB}!A:L` });
  await sheets.spreadsheets.values.update({
    spreadsheetId: id, range: `${TAB}!A1`, valueInputOption: "RAW", requestBody: { values: [AUDIT_HEADERS, ...out] },
  });
  console.log("Lead audit done:", JSON.stringify(stats));
};

function build(sheetRow, row, a, r, an, kept) {
  const k = kept.get(a.waId || "") || { approve: "", result: "" };
  return [sheetRow, row[COL.name] || "", a.waId || "", row[COL.date] || "",
    a.complete ? "Complete" : "Missing: " + a.missing.map((m) => m.label).join(", "),
    r.status, fmt(an?.lastOutAt), fmt(an?.lastCustomerAt), r.quiet ?? "",
    `${r.action}: ${r.why}`, ["SKIP", "WAIT", "TEAM", "MANUAL"].includes(r.action) ? "" : k.approve, k.result];
}
