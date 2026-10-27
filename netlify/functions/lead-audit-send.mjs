import { sendTemplateMessage } from "../../lib/wati.mjs";
import { readChat } from "../../lib/team.mjs";
import { testAllows } from "../../lib/testmode.mjs";
import { getContact, saveContact } from "../../lib/contacts.mjs";
import { incr } from "../../lib/metrics.mjs";
import { sheetsClient, sheetReady, live } from "../../lib/sheet.mjs";
import { assess, rowFields, confirmParams, joinList, COL, summaryChoice, waStateAfterSummary } from "../../lib/leadfields.mjs";
import { getIg } from "../../lib/igstate.mjs";
import { newState } from "../../lib/qualify.mjs";

export const config = { schedule: "*/30 * * * *" };
const TAB = "Lead Audit";
const istHour = () => Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));

export default async () => {
  const h = istHour();
  if (h < Number(process.env.SEND_FROM_HOUR || 10) || h >= Number(process.env.SEND_TO_HOUR || 20)) return console.log("Outside sending hours.");
  if (!sheetReady() || !live()) return console.log("Not live or sheet not set.");
  const sheets = sheetsClient(), id = process.env.LEADS_SHEET_ID, main = process.env.LEADS_SHEET_TAB || "Sheet1";
  let audit;
  try { audit = (await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${TAB}!A:L` })).data.values?.slice(1) || []; }
  catch { return console.log("No Lead Audit tab."); }
  const quiet = (process.env.QUIET_TEMPLATES || "").split(",").map((s) => s.trim()).filter(Boolean);
  const max = Number(process.env.MAX_PER_RUN || 10);
  let sent = 0;
  for (let i = 0; i < audit.length && sent < max; i++) {
    const r = audit[i], sheetRow = Number(r[0]), waId = String(r[2] || "").replace(/\D/g, "");
    if (String(r[10] || "").trim().toUpperCase() !== "Y" || r[11] || !waId) continue;
    const action = String(r[9] || "").split(":")[0];
    const mark = (t) => sheets.spreadsheets.values.update({ spreadsheetId: id, range: `${TAB}!L${i + 2}`, valueInputOption: "RAW", requestBody: { values: [[t]] } });
    if (!testAllows({ waId })) continue;
    try {
      const c = await getContact(waId);
      if (c.dnc || c.kind === "vendor") { await mark("Skipped: opted out or vendor"); continue; }
      const chat = await readChat(waId, c, 40);
      if (!chat) continue;
      if (action !== "SEND_SUMMARY" && action !== "SEND_FINISH" && chat.lastCustomerAt > chat.lastOutAt) { await mark("Skipped: lead wrote since audit"); continue; }
      if (chat.teamSpoke && (action === "SEND_SUMMARY" || action === "SEND_FINISH") && Date.now() - chat.lastTeamAt < 24 * 3600_000) { await mark("Skipped: team spoke recently"); continue; }
      const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${main}!A${sheetRow}:Q${sheetRow}` });
      const row = data.values?.[0] || [];
      const a = assess(row);
      if (a.waId !== waId) { await mark("Skipped: row changed"); continue; }
      await saveContact(waId, { agentSent: Date.now() });
      if (action === "SEND_SUMMARY") {
        const f = rowFields(row);
        let igQ = null;
        try { igQ = row[COL.mcId] ? (await getIg(row[COL.mcId])).q || null : null; } catch { /* unknown: the usual template */ }
        const pick = summaryChoice(igQ);
        await sendTemplateMessage(waId, pick.template, confirmParams(row[COL.name], f), "lead-audit");
        await saveContact(waId, { q: waStateAfterSummary(newState, f, igQ, pick.confirmed), name: row[COL.name] });
      } else if (action === "SEND_FINISH") {
        const f = rowFields(row);
        const need = joinList(a.missing.filter((m) => m.key !== "number").map((m) => m.label));
        await sendTemplateMessage(waId, process.env.FINISH_TEMPLATE_NAME, { ...confirmParams(row[COL.name], f), missing_details: need || "a few details" }, "lead-audit");
      } else if (action === "QUIET_FOLLOWUP") {
        const n = c.followups || 0;
        if (quiet.length < 3 || n >= 3) { await mark("Skipped: no template"); continue; }
        await sendTemplateMessage(waId, quiet[n], { first_name: String(row[COL.name] || "there").trim().split(" ")[0] || "there" }, "lead-audit");
        await saveContact(waId, { followups: n + 1, humanSpoke: true });
      } else { await mark("Skipped: no action"); continue; }
      await saveContact(waId, { lastOut: Date.now(), agentSent: Date.now() });
      await mark("Sent " + new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }));
      await incr("audit_sent");
      sent++;
    } catch (e) { console.error(`audit send row ${sheetRow}:`, e.message); await mark("Failed: " + e.message.slice(0, 80)).catch(() => {}); }
  }
  console.log(`Lead audit sends: ${sent}`);
};
