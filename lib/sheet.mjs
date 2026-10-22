import { google } from "googleapis";
import { normalizePhone, sameNumber } from "./phone.mjs";
import { COL } from "./leadfields.mjs";

export const live = () => process.env.DRY_RUN === "false";
export const sheetReady = () => Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.LEADS_SHEET_ID);

export function sheetsClient(readonly = false) {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
    scopes: [`https://www.googleapis.com/auth/spreadsheets${readonly ? ".readonly" : ""}`],
  });
  return google.sheets({ version: "v4", auth });
}

const mainTab = () => process.env.LEADS_SHEET_TAB || "Sheet1";
const WA_TAB = "WhatsApp Leads"; // Name | Mobile | Location | Event Date | Occasion | Requirement | Source | Stage | Notes | Confirmed | Updated At | Guests | Country | Call
const letter = (i) => String.fromCharCode(65 + i);

// One row for the main leads tab, columns A..Q (Name, Mobile, Location, Event Date, Occasion, Requirement, Source, ... Notes (K) ... Last Message (P), ManyChat ID (Q)).
export function mainRow(r) {
  const row = Array(17).fill("");
  row[COL.name] = r.name || "";
  row[COL.mobile] = r.mobile || "";
  row[COL.location] = r.location || "";
  row[COL.date] = r.date || "";
  row[COL.occasion] = r.occasion || "";
  row[COL.requirement] = r.requirement || "";
  row[COL.source] = r.source || "";
  row[10] = r.notes || "";
  row[COL.lastMsg] = r.lastMsg || "";
  row[COL.mcId] = r.mcId || "";
  return row;
}

// Find a lead in the Instagram sheet by WhatsApp number.
export async function findLead(waId) {
  if (!sheetReady()) return null;
  try {
    const { data } = await sheetsClient(true).spreadsheets.values.get({
      spreadsheetId: process.env.LEADS_SHEET_ID, range: `${mainTab()}!A:Q`,
    });
    const rows = data.values || [];
    for (let i = 1; i < rows.length; i++) {
      if (sameNumber(normalizePhone(rows[i]?.[COL.mobile]), waId)) return { rowNumber: i + 1, row: rows[i] };
    }
  } catch (e) { console.warn("findLead:", e.message); }
  return null;
}

// Save what the lead told us on WhatsApp.
//  - Known Instagram lead: fill only blank cells in their existing row.
//  - New WhatsApp lead: keep in a separate "WhatsApp Leads" tab, so the Planning Studio sync on the main sheet is untouched.
export async function saveLead(waId, name, q, extra = {}) {
  const f = q.fields || {};
  if (!live() || !sheetReady()) return console.log(`[DRY_RUN] saveLead ${waId}`, JSON.stringify({ f, stage: q.stage, ...extra }));
  const sheets = sheetsClient();
  const id = process.env.LEADS_SHEET_ID;
  try {
    const found = await findLead(waId);
    if (found) {
      const map = { date: COL.date, location: COL.location, occasion: COL.occasion, requirement: COL.requirement };
      const data = Object.entries(map)
        .filter(([k, col]) => f[k] && !String(found.row[col] ?? "").trim())
        .map(([k, col]) => ({ range: `${mainTab()}!${letter(col)}${found.rowNumber}`, values: [[f[k]]] }));
      const note = [extra.notes, q.stage === "confirm" && f.guests ? `Guests: ${f.guests}` : "", q.callPref ? `Call: ${q.callPref}` : ""].filter(Boolean).join(" / ");
      if (note) data.push({ range: `${mainTab()}!K${found.rowNumber}`, values: [[[found.row[10], note].filter(Boolean).join(" / ")]] });
      if (data.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: id, requestBody: { valueInputOption: "RAW", data } });
      return;
    }
    // A brand-new WhatsApp lead goes into the main Planning Studio sheet, like Instagram leads (source "WhatsApp"),
    // so it reaches Planning Studio and the CRM. Later answers fill the blank cells of this same row (found by number above).
    const note = [extra.country && extra.country !== "India" ? `Country: ${extra.country}` : "", extra.notes].filter(Boolean).join(" / ");
    await sheets.spreadsheets.values.append({
      spreadsheetId: id, range: `${mainTab()}!A:Q`, valueInputOption: "RAW",
      requestBody: { values: [mainRow({ name, mobile: `+${waId}`, ...f, source: "WhatsApp", notes: note })] },
    });
  } catch (e) { console.error("saveLead:", e.message); }
}

// Instagram lead (ManyChat subscriber): create the row on first answers, then keep it up to date. Found by ManyChat ID (col Q).
// Unlike WhatsApp (fill blanks only), the lead's latest answer wins, because on Instagram the agent is the only one writing.
export async function upsertInstagramLead(sid, name, q, extra = {}) {
  const f = q.fields || {};
  const num = /^\d{8,15}$/.test(String(f.number || "").replace(/\D/g, "")) && !/^(pending|not shared)$/i.test(f.number) ? `+${String(f.number).replace(/\D/g, "")}` : "";
  const notes = [extra.notes, f.guests ? `Guests: ${f.guests}` : "", q.callPref ? `Call: ${q.callPref}` : "", f.number === "Not shared" ? "Number not shared" : ""].filter(Boolean).join(" / ");
  if (!live() || !sheetReady()) return console.log(`[DRY_RUN] upsertInstagramLead ${sid}`, JSON.stringify({ f, notes }));
  try {
    const sheets = sheetsClient();
    const id = process.env.LEADS_SHEET_ID;
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${mainTab()}!A:Q` });
    const rows = data.values || [];
    let rowNumber = 0;
    for (let i = 1; i < rows.length; i++) if (String(rows[i]?.[COL.mcId] ?? "") === String(sid)) { rowNumber = i + 1; break; }
    if (!rowNumber) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: id, range: `${mainTab()}!A:Q`, valueInputOption: "RAW",
        requestBody: { values: [mainRow({ name, mobile: num, ...f, source: "Instagram", notes, lastMsg: extra.lastMsg, mcId: String(sid) })] },
      });
      return;
    }
    const cur = rows[rowNumber - 1];
    const set = (col, v) => (v ? { range: `${mainTab()}!${letter(col)}${rowNumber}`, values: [[v]] } : null);
    const mergedNotes = [cur[10], notes].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" / ").slice(0, 400);
    const updates = [set(COL.mobile, num), set(COL.location, f.location), set(COL.date, f.date), set(COL.occasion, f.occasion),
      set(COL.requirement, f.requirement), set(10, mergedNotes === cur[10] ? "" : mergedNotes), set(COL.lastMsg, extra.lastMsg),
      extra.done ? set(COL.status, "IG_AGENT") : null].filter(Boolean);
    if (updates.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: id, requestBody: { valueInputOption: "RAW", data: updates } });
  } catch (e) { console.error("upsertInstagramLead:", e.message); }
}
