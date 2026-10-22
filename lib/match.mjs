import { sheetsClient, sheetReady } from "./sheet.mjs";
import { COL, rowFields } from "./leadfields.mjs";

// Is a WhatsApp chat the same person as an Instagram lead? Number match is handled elsewhere (certain).
// Name alone is only a hint; name AND (date or city) is "probable" and the person is asked to confirm; nothing here merges on its own.
const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
export const nameTokens = (s) => norm(s).split(" ").filter((t) => t.length > 1);

// Same first and last name (order and extra words don't matter). Needs two name parts on both sides.
export function sameName(a, b) {
  const x = nameTokens(a), y = nameTokens(b);
  if (x.length < 2 || y.length < 2) return false;
  return x[0] === y[0] && x.at(-1) === y.at(-1);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function dateParts(s) {
  const t = String(s || "").toLowerCase();
  const month = MONTHS.findIndex((m) => new RegExp(`\\b${m}`).test(t));
  const day = (t.match(/\b(\d{1,2})(st|nd|rd|th)?\b/) || [])[1];
  const year = (t.match(/\b(20\d\d)\b/) || [])[1];
  return { month, day: day && Number(day) <= 31 ? Number(day) : null, year };
}
// Same month (and same day if both gave one, same year if both gave one).
export function sameDate(a, b) {
  const x = dateParts(a), y = dateParts(b);
  if (x.month < 0 || y.month < 0 || x.month !== y.month) return false;
  if (x.day && y.day && x.day !== y.day) return false;
  if (x.year && y.year && x.year !== y.year) return false;
  return true;
}
export const sameCity = (a, b) => {
  const x = norm(a), y = norm(b);
  return Boolean(x && y && (x === y || x.includes(y) || y.includes(x)));
};

// cand = { name, fields: {date, location, ...} } from the Instagram sheet.
export function classify(name, fields, cand) {
  if (!cand || !sameName(name, cand.name)) return "none";
  if (sameDate(fields.date, cand.fields?.date) || sameCity(fields.location, cand.fields?.location)) return "probable";
  return "weak";
}

export async function findNameCandidate(name) {
  if (!sheetReady() || nameTokens(name).length < 2) return null;
  try {
    const { data } = await sheetsClient(true).spreadsheets.values.get({
      spreadsheetId: process.env.LEADS_SHEET_ID, range: `${process.env.LEADS_SHEET_TAB || "Sheet1"}!A:Q`,
    });
    const rows = data.values || [];
    for (let i = 1; i < rows.length; i++) {
      if (sameName(name, rows[i]?.[COL.name])) return { rowNumber: i + 1, name: rows[i][COL.name], fields: rowFields(rows[i]) };
    }
  } catch (e) { console.warn("findNameCandidate:", e.message); }
  return null;
}
