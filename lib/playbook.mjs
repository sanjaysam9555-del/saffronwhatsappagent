import { sheetsClient, sheetReady, live } from "./sheet.mjs";
import { parseModelJson } from "./claude.mjs";

// The improvement loop, shared by Instagram and WhatsApp.
//  1. "Agent Answers" tab: every question the agent could not answer is listed once (with how many times it was asked).
//     You type the right reply in "Your answer"; from then on the agent uses it, in your words, on both channels.
//  2. "Agent Log" tab: every exchange (what the lead said, what the agent replied), so the weekly review has something to learn from.
// Nothing here is ever learned without you: the agent only repeats answers you typed.
export const ANSWERS_TAB = "Agent Answers";
export const ANSWERS_HEADERS = ["First asked (IST)", "Channel", "Lead's question", "Your answer", "Times asked", "Status", "Suggested answer", "Use suggestion? (type Y)"];
export const LOG_TAB = "Agent Log";
export const LOG_HEADERS = ["Time (IST)", "Channel", "Contact", "Lead said", "Agent replied"];

const istStamp = (d = new Date()) =>
  d.toLocaleString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
export const normalize = (t) => String(t || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
const cell = (v) => String(v ?? "").slice(0, 1000);

async function ensureTab(sheets, id, title, headers) {
  try {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: [{ addSheet: { properties: { title } } }] } });
  } catch (e) { if (!/already exists/i.test(e.message)) throw e; return; }
  await sheets.spreadsheets.values.update({ spreadsheetId: id, range: `${title}!A1`, valueInputOption: "RAW", requestBody: { values: [headers] } });
}

// A question the agent could not answer. Listed once; asking it again only raises the count. Never throws.
export async function recordQuestion({ channel, text }) {
  const q = String(text || "").trim().slice(0, 300);
  if (!q) return;
  if (!live() || !sheetReady()) return console.log(`[DRY_RUN] recordQuestion ${channel}: ${q.slice(0, 80)}`);
  try {
    const sheets = sheetsClient();
    const id = process.env.LEADS_SHEET_ID;
    await ensureTab(sheets, id, ANSWERS_TAB, ANSWERS_HEADERS);
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${ANSWERS_TAB}!A:H` });
    const rows = data.values || [];
    const key = normalize(q);
    const at = rows.findIndex((r, i) => i > 0 && normalize(r[2]) === key);
    if (at > 0) {
      const n = (Number(rows[at][4]) || 1) + 1;
      await sheets.spreadsheets.values.update({ spreadsheetId: id, range: `${ANSWERS_TAB}!E${at + 1}`, valueInputOption: "RAW", requestBody: { values: [[n]] } });
      return;
    }
    await sheets.spreadsheets.values.append({ spreadsheetId: id, range: `${ANSWERS_TAB}!A:H`, valueInputOption: "RAW", requestBody: { values: [[istStamp(), channel, q, "", 1, "Waiting for your answer", "", ""]] } });
  } catch (e) { console.error("recordQuestion:", e.message); }
}

// Rows the agent may use: your own answer, or the suggested answer once you typed Y next to it. Never a suggestion you did not approve.
export function usableAnswers(values) {
  return values.slice(1)
    .filter((r) => !/^ignore/i.test(String(r[5] || "")))
    .map((r) => {
      const own = String(r[3] || "").trim();
      const ok = /^\s*(y|yes)\s*$/i.test(String(r[7] || ""));
      return { q: String(r[2] || "").trim(), a: own || (ok ? String(r[6] || "").trim() : "") };
    })
    .filter((r) => r.a && r.q);
}

// The answers you have typed (non-empty "Your answer", not marked Ignore). Cached for two minutes.
let cache = { at: 0, rows: [] };
export async function loadAnswers() {
  if (Date.now() - cache.at < 120_000) return cache.rows;
  if (!sheetReady()) return [];
  try {
    const { data } = await sheetsClient(true).spreadsheets.values.get({ spreadsheetId: process.env.LEADS_SHEET_ID, range: `${ANSWERS_TAB}!A:H` });
    const rows = usableAnswers(data.values || []);
    cache = { at: Date.now(), rows };
    return rows;
  } catch (e) {
    if (!/Unable to parse range|Requested entity was not found/i.test(e.message)) console.error("loadAnswers:", e.message);
    cache = { at: Date.now(), rows: [] };
    return [];
  }
}

// Does the lead's message ask the same thing as a question you have answered? Returns your answer, word for word, or null.
// Claude only chooses which one fits; it never writes the answer.
export async function answerFromPlaybook(text, pairs = null) {
  const list = pairs || (await loadAnswers());
  if (!list.length || !process.env.ANTHROPIC_API_KEY) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.CLAUDE_MODEL || "claude-sonnet-5-5", max_tokens: 60,
        system: "You match a lead's message to questions a wedding planner has already answered. Pick the one entry whose answer fully and directly answers what the lead asked. " +
          "If none clearly does, or the lead asks several things and an entry covers only part, or the message is about their own booking, price quote, discount or availability, answer null. Never guess. " +
          "Output ONLY JSON: {\"match\": <number or null>}.",
        messages: [{ role: "user", content: `Answered questions:\n${list.map((p, i) => `${i}. ${p.q}`).join("\n")}\n\nLead's message: ${text}` }],
      }),
    });
    if (!res.ok) return null;
    const m = parseModelJson((await res.json()).content?.[0]?.text)?.match;
    return Number.isInteger(m) && m >= 0 && m < list.length ? list[m].a : null;
  } catch { return null; }
}

// One line per exchange. Never throws.
export async function logExchange({ channel, contact, lead, agent }) {
  if (!live() || !sheetReady()) return;
  try {
    const sheets = sheetsClient();
    const id = process.env.LEADS_SHEET_ID;
    await ensureTabOnce(sheets, id);
    await sheets.spreadsheets.values.append({ spreadsheetId: id, range: `${LOG_TAB}!A:E`, valueInputOption: "RAW", requestBody: { values: [[istStamp(), channel, cell(contact), cell(lead), cell(agent)]] } });
  } catch (e) { console.error("logExchange:", e.message); }
}
let logReady = false;
async function ensureTabOnce(sheets, id) {
  if (logReady) return;
  await ensureTab(sheets, id, LOG_TAB, LOG_HEADERS);
  logReady = true;
}
