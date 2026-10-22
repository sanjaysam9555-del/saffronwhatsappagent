import { sheetsClient, sheetReady, live } from "../../lib/sheet.mjs";
import { sendTemplateMessage } from "../../lib/wati.mjs";
import { getDay } from "../../lib/metrics.mjs";
import { draftSuggestion } from "../../lib/claude.mjs";
import { GUIDES, PRICING_PAGE } from "../../lib/guides.mjs";
import { ANSWERS_TAB, LOG_TAB } from "../../lib/playbook.mjs";
import { WEEKLY_TAB, WEEKLY_HEADERS, sumMetrics, unhappyChats, weeklyNumbers, weeklyRow, weeklyParams, weekLabel } from "../../lib/weekly.mjs";

// Monday 09:30 IST. Writes a row on the "Weekly Review" tab, drafts suggested answers for the questions the agent could not answer
// (in the "Agent Answers" tab, columns G and H: type Y next to a suggestion to let the agent use it), and sends you a short WhatsApp.
// The agent never uses a suggestion you have not approved.
export const config = { schedule: "0 4 * * 1" };

const istDay = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(t));

async function tab(sheets, id, title, range) {
  try { return (await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${title}!${range}` })).data.values || []; } catch { return []; }
}
async function ensureTab(sheets, id, title, headers) {
  try { await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: [{ addSheet: { properties: { title } } }] } }); }
  catch (e) { if (!/already exists/i.test(e.message)) throw e; return; }
  await sheets.spreadsheets.values.update({ spreadsheetId: id, range: `${title}!A1`, valueInputOption: "RAW", requestBody: { values: [headers] } });
}

export default async () => {
  if (!sheetReady()) return console.log("Sheet not configured: no weekly review.");
  const now = Date.now();
  const id = process.env.LEADS_SHEET_ID;
  const sheets = sheetsClient();

  const days = [];
  for (let i = 1; i <= 7; i++) days.push(await getDay(istDay(now - i * 86_400_000)));
  const totals = sumMetrics(days);

  const logRows = (await tab(sheets, id, LOG_TAB, "A:E")).slice(1).slice(-3000);
  const unhappy = unhappyChats(logRows, now);

  // Suggested answers for questions still waiting on the owner (at most 8 a week, so it stays quick to read).
  let answers = await tab(sheets, id, ANSWERS_TAB, "A:H");
  let suggested = 0;
  const waiting = answers.slice(1).filter((r) => String(r[2] || "").trim() && !String(r[3] || "").trim() && !/^ignore/i.test(String(r[5] || ""))).length;
  if (answers.length) {
    await sheets.spreadsheets.values.update({ spreadsheetId: id, range: `${ANSWERS_TAB}!G1:H1`, valueInputOption: "RAW", requestBody: { values: [["Suggested answer", "Use suggestion? (type Y)"]] } });
    const pages = [...GUIDES.map((g) => ({ title: g.title, url: g.url })), { title: "Pricing", url: PRICING_PAGE }];
    for (let i = 1; i < answers.length && suggested < 8; i++) {
      const r = answers[i];
      if (!String(r[2] || "").trim() || String(r[3] || "").trim() || String(r[6] || "").trim() || /^ignore/i.test(String(r[5] || ""))) continue;
      const s = await draftSuggestion({ question: String(r[2]), pages });
      if (!s) continue;
      const text = s.answer || `NEEDS YOU: ${s.why}`;
      if (live()) await sheets.spreadsheets.values.update({ spreadsheetId: id, range: `${ANSWERS_TAB}!G${i + 1}`, valueInputOption: "RAW", requestBody: { values: [[text]] } });
      if (s.answer) suggested++;
    }
  }

  const w = weeklyNumbers(totals, { waiting, suggested, unhappy: unhappy.length });
  const label = weekLabel(now);
  console.log("Weekly review", label, JSON.stringify(w));
  if (!live()) return console.log("[DRY_RUN] weekly review not written or sent.", JSON.stringify(unhappy));

  await ensureTab(sheets, id, WEEKLY_TAB, WEEKLY_HEADERS);
  await sheets.spreadsheets.values.append({ spreadsheetId: id, range: `${WEEKLY_TAB}!A:I`, valueInputOption: "RAW", requestBody: { values: [weeklyRow(label, w, unhappy)] } });

  const to = (process.env.OWNER_NUMBER || "").replace(/\D/g, "");
  const tpl = (process.env.WEEKLY_REVIEW_TEMPLATE || "").trim();
  if (to && tpl) await sendTemplateMessage(to, tpl, weeklyParams(label, w, `https://docs.google.com/spreadsheets/d/${id}`), "weekly-review");
  else console.log("OWNER_NUMBER / WEEKLY_REVIEW_TEMPLATE not set: review saved to the sheet only.");
};
