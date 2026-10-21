import { normalizePhone } from "../../lib/phone.mjs";
import { sendTemplateMessage } from "../../lib/wati.mjs";
import { sendInstagramText } from "../../lib/manychat.mjs";
import { sinceChange, getFlag, setFlag } from "../../lib/state.mjs";
import { saveContact } from "../../lib/contacts.mjs";
import { incr } from "../../lib/metrics.mjs";
import { sheetsClient, live } from "../../lib/sheet.mjs";
import { COL, assess, rowFields, summaryLine, joinList, firstName, igNudgeText, suggestNudge } from "../../lib/leadfields.mjs";
import { newState } from "../../lib/qualify.mjs";

// Runs every 5 minutes over the ManyChat-filled leads sheet. The flow asks: date, location, number, occasion, requirement.
// "Quiet time" = time since the row last changed (ManyChat fills it column by column).
//
//  COMPLETE                              -> WhatsApp: "we have your details, please confirm or add"  (within 30 min of finishing: any hour; later: 10:00-20:00)
//  INCOMPLETE, has number, quiet 12h+    -> WhatsApp: "a few more details before we can share a quote or designs" (10:00-20:00)
//  INCOMPLETE, no number, quiet 12h-23h  -> Instagram nudge via ManyChat asking the next missing question (10:00-20:00, or last chance at 20h)
//  INCOMPLETE, no number, quiet 23h+     -> "IG Nudges" tab for the team to send by hand (Meta's 24h automation window is over)
//  Lead typed a question                 -> "IG Nudges" tab (a person answers)
//  No number, quiet 3 days               -> COLD
// Row 1 headers needed: N "WA Follow-up", O "WA Follow-up At", P "Last Message", Q "ManyChat ID".
export const config = { schedule: "*/5 * * * *" };

const H = 3600_000;
const num = (k, d) => Number(process.env[k] || d);
export const CFG = {
  quietAfter: num("QUIET_AFTER_HOURS", 12) * H,    // before this, ManyChat has the lead to itself
  igWindow: num("IG_WINDOW_HOURS", 23) * H,        // Meta's 24h automation limit, with a margin
  igLastChance: num("IG_LAST_CHANCE_HOURS", 20) * H, // send the Instagram nudge even outside 10-20 so the window isn't lost
  coldAfter: num("COLD_AFTER_DAYS", 3) * 24 * H,
  instant: num("INSTANT_MINUTES", 30) * 60_000,    // a just-completed lead is messaged at any hour
  sendFrom: num("SEND_FROM_HOUR", 10),
  sendTo: num("SEND_TO_HOUR", 20),
};
const NUDGE_TAB = "IG Nudges"; // Name | Priority | Missing | Their last text | Suggested message | Sheet row | Added at | Done

// What to do with one row. Pure, so the confirmed timings are testable.
export function stage(a, quiet, inWindow, ctx = {}, cfg = CFG) {
  if (a.complete) return quiet <= cfg.instant || inWindow ? "SEND_SUMMARY" : "WAIT";
  if (quiet < cfg.quietAfter) return "WAIT";
  if (a.question) return "NUDGE_LIST"; // a person must answer it
  if (a.waId) return inWindow ? "SEND_FINISH" : "WAIT"; // they gave a number: take it to WhatsApp
  if (quiet < cfg.igWindow) {
    if (!ctx.hasMc) return "NUDGE_LIST";
    if (ctx.igNudged) return "WAIT"; // already nudged; give them time to reply
    return inWindow || quiet >= cfg.igLastChance ? "SEND_IG" : "WAIT";
  }
  return quiet >= cfg.coldAfter ? "COLD" : "NUDGE_LIST";
}

const istHour = () =>
  Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));

export default async () => {
  const fromRow = Number(process.env.FOLLOWUP_FROM_ROW);
  if (!fromRow) return console.log("FOLLOWUP_FROM_ROW not set; nothing to do.");
  const h = istHour();
  const inWindow = h >= CFG.sendFrom && h < CFG.sendTo;
  const isLive = live();

  const sheets = sheetsClient();
  const id = process.env.LEADS_SHEET_ID;
  const tab = process.env.LEADS_SHEET_TAB || "Sheet1";
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${tab}!A:Q` });
  const rows = data.values || [];
  const max = Number(process.env.MAX_PER_RUN || 10);
  const updates = [], nudges = [];
  let sent = 0;

  for (let i = fromRow; i < rows.length; i++) { // sheet row = i + 1
    const row = rows[i];
    if (!row || !row[COL.name] || row[COL.status]) continue;
    const sheetRow = i + 1;
    const key = row[COL.psId] || `r${sheetRow}`;
    const a = assess(row);
    const hash = [...row.slice(0, 12), row[COL.lastMsg]].join("|"); // ignores our own status columns
    const { quiet, created } = await sinceChange(`lead:${key}`, hash);
    if (created) await incr("new_leads");

    const mcId = row[COL.mcId];
    const hasMc = Boolean(mcId && process.env.MANYCHAT_API_TOKEN);
    const igNudged = hasMc ? await getFlag(`ig-nudged:${key}`) : false;
    const action = stage(a, quiet, inWindow, { hasMc, igNudged });

    const mark = (s, extra = new Date().toISOString()) =>
      updates.push({ range: `${tab}!N${sheetRow}:O${sheetRow}`, values: [[s, extra]] });
    const toNudgeList = () => {
      nudges.push([row[COL.name], a.priority, a.missing.map((m) => m.label).join(", ") || "-", a.question || "", suggestNudge(row, a), sheetRow, new Date().toISOString(), ""]);
      mark("NUDGE_LISTED");
    };
    const wa = async (template, params, status, metric, afterSend) => {
      if (sent >= max) return;
      try {
        await sendTemplateMessage(a.waId, template, params, "lead-followup");
        sent++;
        mark(status);
        if (isLive) { await incr(metric); await afterSend?.(); }
      } catch (e) { console.error(`row ${sheetRow}:`, e.message); mark("FAILED", e.message.slice(0, 100)); }
    };

    if (action === "SEND_SUMMARY") {
      const f = rowFields(row);
      await wa(process.env.LEAD_TEMPLATE_NAME, [firstName(row[COL.name]), summaryLine(f) || "your enquiry"], "SENT", "summaries_sent",
        // their next WhatsApp reply is handled as confirmation or additions
        () => saveContact(a.waId, { q: { ...newState(f, "Instagram"), stage: "confirm" }, name: row[COL.name] }));
    } else if (action === "SEND_FINISH") {
      const f = rowFields(row);
      const need = joinList(a.missing.filter((m) => m.key !== "number").map((m) => m.label));
      await wa(process.env.FINISH_TEMPLATE_NAME, [firstName(row[COL.name]), summaryLine(f) || "your enquiry", need || "a few details"], "FINISH_SENT", "wa_finish_sent");
    } else if (action === "SEND_IG") {
      try {
        await sendInstagramText(mcId, igNudgeText(row, a));
        if (isLive) { await setFlag(`ig-nudged:${key}`); await incr("ig_nudges_sent"); }
      } catch (e) {
        console.error(`row ${sheetRow} Instagram nudge failed:`, e.message);
        if (isLive) await incr("ig_nudges_failed");
        toNudgeList(); // fall back to the team
      }
    } else if (action === "COLD") {
      mark("COLD");
      if (isLive) await incr("cold_leads");
    } else if (action === "NUDGE_LIST") {
      toNudgeList();
      if (isLive) await incr("nudge_listed");
    }
  }

  if (!isLive) {
    // Test mode: never write marks, or rows would be skipped once DRY_RUN is turned off.
    return console.log(`[DRY_RUN] would mark ${updates.length} rows, add ${nudges.length} nudges`, JSON.stringify(nudges));
  }
  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: id, requestBody: { valueInputOption: "RAW", data: updates } });
  }
  if (nudges.length) {
    await sheets.spreadsheets.values.append({ spreadsheetId: id, range: `${NUDGE_TAB}!A:H`, valueInputOption: "RAW", requestBody: { values: nudges } });
  }
  console.log(`Run done: ${sent} WhatsApp sent, ${nudges.length} added to ${NUDGE_TAB}.`);
};
