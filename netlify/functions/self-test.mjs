import { withChat } from "../../lib/readgate.mjs";
import { runChecks, summary, failures, pureChecks } from "../../lib/selftest.mjs";
import { calendarEnabled, offerSlots } from "../../lib/calendar.mjs";
import { getContactsPage } from "../../lib/wati.mjs";
import { sheetsClient, sheetReady } from "../../lib/sheet.mjs";
import { logNeedsTeam } from "../../lib/needsteam.mjs";

// 09:00 IST daily. Sends nothing to any lead and calls no paid model: it checks the booking path and its settings, and tells the team (an urgent
// Needs Team row and the usual team alert) only when something fails. See lib/selftest.mjs and docs/LESSONS.md L51.
export const config = { schedule: "30 3 * * *" };

const need = (names) => ({ warn: `${names.join(" / ")}` });
export default () => withChat(async () => {
  const checks = [
    ...pureChecks(),
    { name: "calendar read", run: async () => {
      if (!calendarEnabled()) throw new Error("CALENDAR_OWNER or GOOGLE_SERVICE_ACCOUNT_JSON is not set, so the agent cannot book");
      const slots = await offerSlots();
      if (!slots.length) throw new Error("the live calendar returned no free times to offer");
    } },
    { name: "Wati reachable", run: async () => { const p = await getContactsPage(1, 1); if (!p.length) throw new Error("Wati returned no contacts (token, or Wati is down)"); } },
    { name: "leads sheet readable", run: async () => {
      if (!sheetReady()) throw new Error("the leads sheet is not configured");
      await sheetsClient(true).spreadsheets.values.get({ spreadsheetId: process.env.LEADS_SHEET_ID, range: "Needs Team!A1:A1" });
    } },
    { name: "Claude key present", run: async () => { if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set"); } },
    { name: "settings", run: async () => {
      const missing = [];
      if (!process.env.TEAM_ALERT_NUMBER) missing.push("TEAM_ALERT_NUMBER");
      if (!process.env.TEAM_ALERT_TEMPLATE && !process.env.TEAM_DIGEST_TEMPLATE) missing.push("TEAM_ALERT_TEMPLATE or TEAM_DIGEST_TEMPLATE");
      if (!process.env.CALL_TEMPLATE_NAME) missing.push("CALL_TEMPLATE_NAME");
      if (!process.env.REOPEN_TEMPLATE_NAME && !String(process.env.QUIET_TEMPLATES || "").trim()) missing.push("REOPEN_TEMPLATE_NAME or QUIET_TEMPLATES");
      return missing.length ? need(missing) : undefined;
    } },
  ];
  const results = await runChecks(checks);
  console.log(`SELF-TEST: ${summary(results)}`);
  const bad = failures(results);
  if (bad.length) await logNeedsTeam({ waId: "", contact: "self-test", name: "Agent self-test", channel: "System", reason: "self-test-failed", lastMsg: summary(results) });
});
