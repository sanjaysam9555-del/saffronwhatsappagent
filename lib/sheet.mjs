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
const WA_TAB = "WhatsApp Leads"; // Name | Mobile | Location | Event Date | Occasion | Requirement | Source | Stage | Notes | Confirmed | Updated At
const letter = (i) => String.fromCharCode(65 + i);

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
      if (extra.notes) data.push({ range: `${mainTab()}!K${found.rowNumber}`, values: [[[found.row[10], extra.notes].filter(Boolean).join(" / ")]] });
      if (data.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: id, requestBody: { valueInputOption: "RAW", data } });
      return;
    }
    const rec = [name || "", waId, f.location || "", f.date || "", f.occasion || "", f.requirement || "",
      q.source || "WhatsApp", q.stage, q.notes || "", extra.confirmed ? "YES" : "", new Date().toISOString()];
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${WA_TAB}!A:B` });
    const idx = (data.values || []).findIndex((r, i) => i > 0 && sameNumber(normalizePhone(r[1]), waId));
    if (idx > 0) {
      await sheets.spreadsheets.values.update({ spreadsheetId: id, range: `${WA_TAB}!A${idx + 1}:K${idx + 1}`, valueInputOption: "RAW", requestBody: { values: [rec] } });
    } else {
      await sheets.spreadsheets.values.append({ spreadsheetId: id, range: `${WA_TAB}!A:K`, valueInputOption: "RAW", requestBody: { values: [rec] } });
    }
  } catch (e) { console.error("saveLead:", e.message); }
}
