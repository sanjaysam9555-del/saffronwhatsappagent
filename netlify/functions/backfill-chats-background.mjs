import { getContactsPage, getRecentMessages } from "../../lib/wati.mjs";
import { getContact, saveContact } from "../../lib/contacts.mjs";
import { SIGNUP, OPTOUT } from "../../lib/rules.mjs";
import { sheetsClient, sheetReady, live } from "../../lib/sheet.mjs";

// One-off. Reads your existing Wati chats from the last N days (default 90) and builds the contact memory the quiet
// follow-up needs, WITHOUT messaging anyone:
//   - who we last spoke to, who spoke last, whether the person replied
//   - vendors and opt-outs are recognised and excluded
//   - everyone found is put on HOLD and listed on the "Chat Review" tab; only rows you mark Y are followed up
//   - chats where the last message is from the lead and we never answered are flagged for the team instead
// Run:  https://<site>.netlify.app/.netlify/functions/backfill-chats-background?key=<WEBHOOK_SECRET>&days=90
// (Netlify background function: returns immediately, runs up to 15 minutes. Results are in the function log and the tab.)
const DAY = 24 * 3600_000;
const VENDORISH = /\b(vendor|collab(orat\w*)?|work with (you|us)|photograph\w*|decorator|makeup|mua|caterer|dj|band|florist|empanel\w*)\b/i;

export default async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== process.env.WEBHOOK_SECRET) return;
  const days = Number(url.searchParams.get("days") || 90);
  const cutoff = Date.now() - days * DAY;
  const review = [];
  const stats = { seen: 0, held: 0, awaitingTeam: 0, vendors: 0, optOuts: 0, skippedLive: 0 };

  const t0 = Date.now(), BUDGET_MS = 12 * 60_000; // Netlify background functions stop at 15 minutes
  const startPage = Number(url.searchParams.get("page") || 1);
  for (let page = startPage; page <= 200; page++) {
    if (Date.now() - t0 > BUDGET_MS) { console.log(`Time budget reached. Run again with &page=${page} to continue.`); break; }
    const contacts = await getContactsPage(page, 100);
    if (!contacts.length) break;
    for (const c of contacts) {
      if (c.updated && c.updated < cutoff) continue;
      const msgs = ((await getRecentMessages(c.waId, 30)) || []).filter((m) => m.t >= cutoff);
      if (!msgs.length) continue;
      stats.seen++;
      const existing = await getContact(c.waId);
      if ((existing.lastIn || existing.lastOut) && !existing.backfilled) { stats.skippedLive++; continue; } // live data wins

      const inbound = msgs.filter((m) => m.from === "customer");
      const outbound = msgs.filter((m) => m.from === "us");
      const lastIn = Math.max(0, ...inbound.map((m) => m.t));
      const lastOut = Math.max(0, ...outbound.map((m) => m.t));
      const last = msgs.at(-1);
      const vendor = inbound.some((m) => SIGNUP.test(m.text) || VENDORISH.test(m.text));
      const optOut = inbound.some((m) => OPTOUT.test(m.text));

      const patch = {
        name: c.name || existing.name, backfilled: true, humanSpoke: outbound.length > 0,
        lastIn: lastIn || undefined, lastOut: lastOut || undefined,
        kind: vendor ? "vendor" : existing.kind, dnc: optOut || existing.dnc,
        hold: existing.hold ?? true,
      };
      if (lastIn > lastOut) { // they wrote last and nobody answered: a person should look, not a follow-up
        Object.assign(patch, { esc: true, escText: last.text.slice(0, 160), escAt: lastIn });
        stats.awaitingTeam++;
      }
      await saveContact(c.waId, patch);
      if (vendor) stats.vendors++; if (optOut) stats.optOuts++;
      if (!vendor && !optOut && outbound.length && lastIn <= lastOut) {
        stats.held++;
        review.push([c.waId, c.name || "", last.from === "us" ? "us" : "lead", last.text.slice(0, 120),
          Math.floor((Date.now() - last.t) / DAY), outbound.length, ""]);
      }
      await new Promise((r) => setTimeout(r, 150)); // be gentle with Wati's rate limits
    }
  }

  if (live() && sheetReady() && review.length) {
    await sheetsClient().spreadsheets.values.append({
      spreadsheetId: process.env.LEADS_SHEET_ID, range: "Chat Review!A:G", valueInputOption: "RAW", requestBody: { values: review },
    });
  }
  console.log(`Backfill (${days} days) ${live() ? "" : "[DRY_RUN: tab not written] "}done:`, JSON.stringify(stats));
};
