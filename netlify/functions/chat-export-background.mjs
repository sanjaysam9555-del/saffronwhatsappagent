import { getContactsPage, getRecentMessages } from "../../lib/wati.mjs";
import { sheetsClient, sheetReady } from "../../lib/sheet.mjs";

// Read-only. Copies your recent WhatsApp conversations into a "Chat Export" tab so they can be reviewed. Sends nothing.
// Only chats where both you and the person spoke are copied. Chats are numbered; no names or phone numbers are stored,
// and phone numbers and emails typed inside messages are masked.
// Run: https://<site>.netlify.app/.netlify/functions/chat-export-background?key=<WEBHOOK_SECRET>&days=120&max=300
// If it stops early, the log says which &page= and &start= to continue with.
const DAY = 24 * 3600_000;
export const mask = (t) => String(t).replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]").replace(/\+?\d[\d\s-]{7,}\d/g, "[number]").replace(/\s+/g, " ").trim().slice(0, 500);
const ist = (t) => new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

export default async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== process.env.WEBHOOK_SECRET) return;
  if (!sheetReady()) return console.log("Sheet not configured.");
  const days = Number(url.searchParams.get("days") || 120), max = Number(url.searchParams.get("max") || 300);
  const startPage = Number(url.searchParams.get("page") || 1);
  let chatNo = Number(url.searchParams.get("start") || 0);
  const cutoff = Date.now() - days * DAY;
  const sheets = sheetsClient(), id = process.env.LEADS_SHEET_ID, TAB = "Chat Export";
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] } }).catch(() => {});
  if (startPage === 1) {
    await sheets.spreadsheets.values.clear({ spreadsheetId: id, range: `${TAB}!A:E` });
    await sheets.spreadsheets.values.update({ spreadsheetId: id, range: `${TAB}!A1`, valueInputOption: "RAW", requestBody: { values: [["Chat", "Time (IST)", "From", "Message", "Type"]] } });
  }
  let rows = [], page = startPage, copied = 0;
  const flush = async () => {
    if (!rows.length) return;
    await sheets.spreadsheets.values.append({ spreadsheetId: id, range: `${TAB}!A:E`, valueInputOption: "RAW", requestBody: { values: rows } });
    rows = [];
  };
  const t0 = Date.now(), BUDGET_MS = 12 * 60_000;
  for (; page <= 300 && copied < max; page++) {
    if (Date.now() - t0 > BUDGET_MS) break;
    const contacts = await getContactsPage(page, 100);
    if (!contacts.length) { page = -1; break; }
    for (const c of contacts) {
      if (copied >= max) break;
      if (c.updated && c.updated < cutoff) continue;
      const msgs = ((await getRecentMessages(c.waId, 60)) || []).filter((m) => m.t >= cutoff);
      if (!msgs.some((m) => m.from === "customer") || !msgs.some((m) => m.from === "us")) continue;
      chatNo++; copied++;
      for (const m of msgs) rows.push([chatNo, ist(m.t), m.from === "us" ? "Saffron" : "Lead", mask(m.text), /^\[.*\]$/.test(m.text) ? "media" : "text"]);
      if (rows.length > 300) await flush();
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  await flush();
  console.log(page === -1 ? `Export complete: ${copied} chats copied.` : `Stopped after ${copied} chats. To continue: &page=${page}&start=${chatNo}`);
};
