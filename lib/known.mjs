import { sheetsClient, sheetReady } from "./sheet.mjs";
import { normalizePhone, sameNumber } from "./phone.mjs";

// "Known Contacts" tab in the leads sheet:  Phone | Type | Name
// Type is one of: vendor, client, team, ignore.  The agent never runs the new-client questions for these numbers.
export async function knownType(waId) {
  if (!sheetReady()) return null;
  try {
    const { data } = await sheetsClient(true).spreadsheets.values.get({
      spreadsheetId: process.env.LEADS_SHEET_ID, range: "Known Contacts!A:C",
    });
    for (const r of (data.values || []).slice(1)) {
      const p = normalizePhone(r[0]);
      if (p && sameNumber(p, waId)) return { type: String(r[1] || "").trim().toLowerCase(), name: r[2] || "" };
    }
  } catch { /* tab missing or unreadable: treat as unknown */ }
  return null;
}
