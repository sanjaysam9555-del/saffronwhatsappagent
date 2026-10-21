import test from "node:test";
import assert from "node:assert/strict";
import { decide, MONEY } from "../lib/rules.mjs";
import { normalizePhone } from "../lib/phone.mjs";
import { assess, missingFields, suggestNudge, igNudgeText, summaryLine, rowFields, confirmParams } from "../lib/leadfields.mjs";
import { newState, advance } from "../lib/qualify.mjs";
import { checkReply, parseModelJson } from "../lib/claude.mjs";
import { stage, CFG } from "../netlify/functions/lead-followup.mjs";
import { isEligible } from "../netlify/functions/quiet-followup.mjs";
import { summarise } from "../netlify/functions/morning-digest.mjs";
import { buildSummary } from "../netlify/functions/daily-summary.mjs";
import { analyse } from "../lib/team.mjs";

process.env.VENDOR_SIGNUP_URL = "https://saffron.planningstudio.in/vendor-onboarding";
const H = 3600_000, M = 60_000, DAY = 24 * H;

// ---------- WhatsApp rules ----------
test("vendor asking for work gets the sign-up link", () => {
  const d = decide("How do I register as a vendor with you?");
  assert.equal(d.action, "reply");
  assert.match(d.text, /vendor-onboarding/);
});

test("money always goes to a human; a bare 'date' is normal conversation", () => {
  assert.ok(MONEY.test("what is your commission"));
  assert.ok(MONEY.test("price kya rahega"));
  assert.ok(!MONEY.test("the date is 12 December"));
  assert.equal(decide("I want to join, what rate will you pay?").action, "escalate");
});

test("opt-out wins over everything", () => {
  assert.equal(decide("please stop messaging me").action, "optout");
  assert.equal(decide("not interested, what is the price").action, "optout");
});

// ---------- phone + lead fields ----------
test("phone normalisation on real-world messy cells", () => {
  assert.equal(normalizePhone("8377856860"), "918377856860");
  assert.equal(normalizePhone("8287469294, please whatsapp me with details."), "918287469294");
  assert.equal(normalizePhone("Oh i live in Canada but thats my number \\+15483337252"), "15483337252");
  assert.equal(normalizePhone("971558814056"), null);
  assert.equal(normalizePhone("31 Jan"), null);
  assert.equal(normalizePhone("9772036159 (WhatsApp Only) Dr Rajat"), "919772036159");
});

test("a lead is complete only when all five answers are there; 'still deciding' counts as an answer", () => {
  //            name     mobile        location  date             occasion   requirement
  const full = ["Rahul", "9923459988", "Jaipur", "9 March", "Wedding", "Planning + Decoration"];
  assert.equal(assess(full).complete, true);
  assert.equal(assess(["A", "9923459988", "None", "Still deciding", "Wedding", "Planning"]).complete, true);
  const dateOnly = ["Siddharth", "", "", "26 Nov", "", ""];
  assert.deepEqual(missingFields(dateOnly).map((f) => f.key), ["location", "number", "occasion", "requirement"]);
  assert.equal(assess(dateOnly).complete, false);
});

test("leads who typed a question instead of a number are flagged for a human", () => {
  const room = assess(["Deipali", "How many rooms are there in the resort", "", "End of march", "Wedding", ""]);
  assert.ok(room.question);
  assert.equal(room.complete, false);
  const price = assess(["Suraj", "yaha hi ap bata dijiye price kya rahega", "jaipur", "yes", "Wedding + Reception", "Planning + Decoration"]);
  assert.equal(price.priority, "URGENT");
  assert.match(suggestNudge(["Suraj"], price), /ANSWER THEIR QUESTION/);
  assert.equal(assess(["Dnesh", "May 23 2027", "", "", "", ""]).question, null);
  assert.equal(assess(["A", "31 Jan", "", "", "", ""]).question, null);
  assert.equal(assess(["mahek", "8287469294, please whatsapp me with details.", "", "Nov", "Wedding", ""]).question, null);
});

test("Instagram nudge asks only the next missing question, in ManyChat's order", () => {
  const row = ["Priya", "", "", "26 Nov", "", ""];
  assert.match(igNudgeText(row, assess(row)), /^Hi Priya! Just checking in 🌼 Which city or destination/);
  const row2 = ["Priya", "", "Jaipur", "26 Nov", "", ""];
  assert.match(igNudgeText(row2, assess(row2)), /WhatsApp number/);
});

test("summary line has no line breaks (template safe)", () => {
  const s = summaryLine(rowFields(["R", "99", "Jaipur", "9 March", "Wedding", "Planning + Decoration"]));
  assert.equal(s, "Occasion: Wedding | Date: 9 March | Location: Jaipur | Looking for: Planning + Decoration");
  assert.ok(!s.includes("\n"));
});

// ---------- WhatsApp question flow ----------
test("direct WhatsApp lead: four questions, summary, confirmation", () => {
  let r = advance(newState(), "hi", {}, "Priya Shah");
  assert.equal(r.kind, "ask");
  assert.match(r.reply, /What date/);
  r = advance(r.q, "12 December", {});
  assert.match(r.reply, /Which city/);
  r = advance(r.q, "Jaipur", {});
  assert.match(r.reply, /wedding, a reception/);
  r = advance(r.q, "wedding", {});
  assert.match(r.reply, /planning, decoration/);
  r = advance(r.q, "both", {}, "Priya Shah");
  assert.equal(r.kind, "summary");
  assert.match(r.reply, /Event date: 12 December/);
  assert.match(r.reply, /confirm if this is correct, or reply with anything you would like to add/);
  const c = advance(r.q, "yes correct");
  assert.equal(c.kind, "confirmed");
  assert.equal(c.q.stage, "done");
});

test("a lead who asks a question mid-flow goes to a human; additions after the summary are recorded", () => {
  let r = advance(newState(), "hello", {});
  assert.equal(advance(r.q, "Can you tell me the location of this venue?", {}).kind, "escalate");
  const filled = newState({ date: "1 Jan", location: "Goa", occasion: "Wedding", requirement: "Both" });
  r = advance(filled, "hi", {});
  assert.equal(r.kind, "summary");
  const add = advance(r.q, "also please add a sangeet on 2 Jan");
  assert.equal(add.kind, "addition");
  assert.match(add.q.notes, /sangeet/);
});

test("extraction fills several answers at once and skips the questions already answered", () => {
  let r = advance(newState(), "hi", {});
  r = advance(r.q, "Jaipur wedding in February", { date: "February", location: "Jaipur", occasion: "wedding" });
  assert.equal(r.kind, "ask");
  assert.match(r.reply, /planning, decoration/);
});

test("an Instagram lead continuing on WhatsApp is asked only what's missing", () => {
  const known = newState({ date: "26 Nov", location: "Jaipur" }, "Instagram");
  const r = advance(known, "hi", {});
  assert.match(r.reply, /wedding, a reception/);
  assert.equal(r.q.source, "Instagram");
});

// ---------- timings you confirmed ----------
test("lead stages: 12h quiet, instant send within 30 min, Instagram step-in inside Meta's window, 3-day cold", () => {
  const complete = { complete: true, waId: "919999999999", missing: [], question: null };
  const hasNumber = { complete: false, waId: "919999999999", missing: [{ key: "date" }], question: null };
  const noNumber = { complete: false, waId: null, missing: [{ key: "number" }], question: null };
  const asked = { ...hasNumber, question: "price kya rahega" };
  const mc = { hasMc: true, igNudged: false };

  assert.equal(CFG.instant, 30 * M);
  assert.equal(stage(complete, 10 * M, false), "SEND_SUMMARY");   // just finished at 1 AM: send now
  assert.equal(stage(complete, 2 * H, false), "WAIT");            // older: wait for 10:00
  assert.equal(stage(complete, 2 * H, true), "SEND_SUMMARY");

  assert.equal(stage(hasNumber, 11 * H, true), "WAIT");           // under 12h: ManyChat's turn
  assert.equal(stage(hasNumber, 13 * H, true), "SEND_FINISH");    // has number: move to WhatsApp
  assert.equal(stage(hasNumber, 13 * H, false), "WAIT");          // not outside 10-20
  assert.equal(stage(asked, 13 * H, true), "NUDGE_LIST");         // a person answers questions

  assert.equal(stage(noNumber, 11 * H, true, mc), "WAIT");
  assert.equal(stage(noNumber, 13 * H, true, mc), "SEND_IG");     // Instagram step-in, inside 24h
  assert.equal(stage(noNumber, 13 * H, false, mc), "WAIT");       // wait for 10:00...
  assert.equal(stage(noNumber, 21 * H, false, mc), "SEND_IG");    // ...unless the 24h window is about to close
  assert.equal(stage(noNumber, 14 * H, true, { hasMc: true, igNudged: true }), "WAIT");
  assert.equal(stage(noNumber, 13 * H, true, { hasMc: false }), "NUDGE_LIST"); // no ManyChat id: team
  assert.equal(stage(noNumber, 24 * H, true, { hasMc: true, igNudged: true }), "NUDGE_LIST"); // window over: team by hand
  assert.equal(stage(noNumber, 3 * DAY, true, mc), "COLD");
});

test("quiet follow-up: every 2 days, 3 times, never when held, skipped, vendor, opted out, or waiting on the team", () => {
  const now = Date.now();
  const base = { humanSpoke: true, lastOut: now - 3 * DAY, lastIn: now - 4 * DAY, followups: 0 };
  assert.equal(isEligible(base, now), true);
  assert.equal(isEligible({ ...base, lastOut: now - 1 * DAY }, now), false);
  assert.equal(isEligible({ ...base, followups: 3 }, now), false);
  for (const flag of ["dnc", "esc", "hold", "skip"]) assert.equal(isEligible({ ...base, [flag]: true }, now), false, flag);
  assert.equal(isEligible({ ...base, kind: "vendor" }, now), false);
  assert.equal(isEligible({ ...base, lastIn: now - 1 * DAY }, now), false);
  assert.equal(isEligible({ ...base, humanSpoke: false }, now), false);
});

// ---------- team digest, owner summary, Claude guard ----------
test("morning digest counts only open rows", () => {
  const rows = [["Name", "Priority"], ["A", "URGENT", "", "", "", 5, "t", ""], ["B", "NORMAL", "", "", "", 6, "t", ""], ["C", "URGENT", "", "", "", 7, "t", "done"]];
  assert.deepEqual(summarise(rows), { total: 2, urgent: 1 });
});

test("daily summary text covers each part of the agent's work", () => {
  const t = buildSummary({ new_leads: 7, summaries_sent: 3, ig_nudges_sent: 2, wa_finish_sent: 1, wa_leads_started: 4,
    wa_leads_completed: 2, vendor_links_sent: 5, quiet_followups_sent: 6, escalations: 3 }, { awaiting: 2, nudges: 4, urgent: 1 });
  for (const s of ["New leads from Instagram sheet: 7", "2 sent", "Vendor sign-up links sent: 5", "Quiet follow-ups sent: 6", "WAITING ON YOU: 2 chats need a reply, 4 Instagram nudges"]) {
    assert.ok(t.includes(s), s);
  }
});

test("Claude output guard blocks money, bad categories and foreign links", () => {
  assert.equal(checkReply("greeting", "Hello! How can we help?").ok, true);
  assert.equal(checkReply("escalate", "x").ok, false);
  assert.equal(checkReply("ack", "Our package starts at ₹5 lakh").ok, false);
  assert.equal(checkReply("general_info", "We do weddings, 50k per plate").ok, false);
  assert.equal(checkReply("signup_help", "Join: https://evil.example/x").ok, false);
  assert.equal(checkReply("signup_help", "Join: https://saffron.planningstudio.in/vendor-onboarding").ok, true);
  assert.deepEqual(parseModelJson('Sure {"category":"thanks","reply":"Welcome!"}'), { category: "thanks", reply: "Welcome!" });
  assert.equal(parseModelJson("no json"), null);
});

// ---------- team detection from Wati's stored chat (Business-App messages never reach the webhook) ----------
test("a message typed in the Business App means the team has spoken; the agent's own sends do not", () => {
  const T = Date.parse("2026-10-21T11:08:00Z");
  const chat = [
    { from: "customer", text: "Hi, Planning a wedding", t: T },
    { from: "us", text: "Hi, thanks for reaching out.", t: T + 2 * M },
    { from: "customer", text: "Hi", t: T + 8 * M },
  ];
  const a = analyse(chat, []);
  assert.equal(a.teamSpoke, true);
  assert.equal(a.lastTeamAt, T + 2 * M);
  assert.equal(a.lastCustomerAt, T + 8 * M);
  // the same reply, but the agent recorded sending at that moment
  const b = analyse(chat, [T + 2 * M + 4000]);
  assert.equal(b.teamSpoke, false);
  assert.equal(b.lastOutAt, T + 2 * M);
  // an agent send long ago does not hide a later team message
  assert.equal(analyse(chat, [T - 3 * H]).teamSpoke, true);
  assert.equal(analyse([], []).teamSpoke, false);
});

test("confirmation template gets one clean value per line, never empty", () => {
  const f = rowFields(["Rahul Sharma", "9923459988", "Jaipur", "9 March", "Wedding", "Planning +\nDecoration"]);
  assert.deepEqual(confirmParams("Rahul Sharma", f), { first_name: "Rahul", full_name: "Rahul Sharma", event: "Wedding", event_date: "9 March", location: "Jaipur", service: "Planning + Decoration" });
  assert.deepEqual(confirmParams("", { date: "", location: "", occasion: "", requirement: "" }), { first_name: "there", full_name: "Not provided", event: "Not provided", event_date: "Not provided", location: "Not provided", service: "Not provided" });
});
