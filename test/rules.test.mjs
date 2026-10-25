import test from "node:test";
import assert from "node:assert/strict";
import { decide, MONEY, vendorStrong, CLIENT } from "../lib/rules.mjs";
import { normalizePhone, countryOf, theirTime, extractPhone } from "../lib/phone.mjs";
import { guidesFor, guideText, GUIDES } from "../lib/guides.mjs";
import { isMediaOnly, recordMedia } from "../lib/media.mjs";
import { cleanName, chunk } from "../netlify/functions/ig-process-background.mjs";
import { priceAnswer, isPriceQuestion, hardMoney, budgetLakhs } from "../lib/facts.mjs";
import { sameName, sameDate, sameCity, classify } from "../lib/match.mjs";
import { isUrgent, describe, openCounts, HEADERS } from "../lib/needsteam.mjs";
import { assess, missingFields, suggestNudge, igNudgeText, summaryLine, rowFields, confirmParams } from "../lib/leadfields.mjs";
import { newState, advance, serviceLine, doneContext, applyAfter } from "../lib/qualify.mjs";
import { checkReply, parseModelJson } from "../lib/claude.mjs";
import { stage, CFG } from "../netlify/functions/lead-followup.mjs";
import { isEligible } from "../netlify/functions/quiet-followup.mjs";
import { summarise } from "../netlify/functions/morning-digest.mjs";
import { buildSummary } from "../netlify/functions/daily-summary.mjs";
import { analyse } from "../lib/team.mjs";
import { testAllows, testMode } from "../lib/testmode.mjs";

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
test("direct WhatsApp lead: five questions (no number, no budget), summary, confirmation, then the Founders' call", () => {
  let r = advance(newState(), "hi", {}, "Priya Shah");
  assert.equal(r.kind, "ask");
  assert.match(r.reply, /wedding, a reception/);
  assert.doesNotMatch(r.reply, /number|budget/i);
  r = advance(r.q, "wedding", {});
  assert.match(r.reply, /What date/);
  r = advance(r.q, "12 December", {});
  assert.match(r.reply, /Which city/);
  r = advance(r.q, "Jaipur", {});
  assert.match(r.reply, /guests/);
  r = advance(r.q, "around 200", {});
  assert.match(r.reply, /full planning, decoration only, or both/);
  r = advance(r.q, "both", {}, "Priya Shah");
  assert.equal(r.kind, "summary");
  assert.match(r.reply, /Event date: 12 December/);
  assert.match(r.reply, /Guests: around 200/);
  assert.match(r.reply, /confirm if this is correct, or reply with anything you would like to add/);
  let c = advance(r.q, "yes correct");
  assert.equal(c.kind, "confirmed");
  assert.equal(c.q.stage, "call");
  assert.match(c.reply, /quick 20-minute call with our Founders/);
  assert.match(c.reply, /Google Meet video call or a phone call/);
  const v = advance(c.q, "video is fine");
  assert.equal(v.kind, "call-pref"); assert.equal(v.q.callPref, "meet"); assert.equal(v.q.stage, "done");
  const ph = advance(c.q, "phone please");
  assert.equal(ph.q.callPref, "phone"); assert.match(ph.reply, /call you on this number/);
  assert.equal(advance(c.q, "not now").kind, "call-declined");
  const u1 = advance(c.q, "hmm ok");
  assert.equal(u1.kind, "call-ask");
  assert.equal(advance(u1.q, "ok").q.callPref, "either");
});

test("asking our fee gets the website answer, then the questions carry on; nothing is invented", () => {
  const first = advance(newState(), "how much do you charge?", {}, "Riya", "Welcome Riya", "", priceAnswer("how much do you charge?"));
  assert.match(first.reply, /flat fee, never a percentage/);
  assert.match(first.reply, /₹3\.5 lakh/);
  assert.doesNotMatch(first.reply, /https?:\/\//, "a first reply carries no links");
  assert.match(first.reply, /mobile number|\?\s*$/, "and asks one question");
  assert.equal(first.kind, "ask");
  const mid = advance({ ...first.q }, "what is the price?", {}, "Riya", "", "", priceAnswer("what is the price?"));
  assert.equal(mid.kind, "ask");
  assert.ok(!mid.q.fields[first.q.asked], "a price question is not an answer to the question");
  assert.equal(priceAnswer("decor price?").includes("₹"), false);
  assert.match(priceAnswer("do you do partial planning, cost?"), /₹2 lakh/);
  assert.equal(isPriceQuestion("what is your fee"), true);
  assert.equal(hardMoney("what is the price?"), false);
  assert.equal(hardMoney("my budget is 6 lakh"), false);
  assert.equal(hardMoney("can I get a discount"), true);
  assert.equal(hardMoney("how do I pay the advance"), true);
  assert.equal(budgetLakhs("budget 60-70k"), 0.7);
  assert.equal(budgetLakhs("around 50 lakh"), 50);
  assert.equal(budgetLakhs("1.5 cr"), 150);
});

test("numbers from any country get a country and their local time; Indian numbers are unaffected", () => {
  assert.equal(countryOf("447911123456").name, "UK");
  assert.equal(countryOf("61412345678").name, "Australia");
  assert.equal(countryOf("353871234567").name, "Ireland");
  assert.equal(countryOf("15483337252").name, "US/Canada");
  assert.equal(countryOf("919876543210").india, true);
  assert.match(theirTime("61412345678", new Date("2026-10-22T10:00:00Z")), /Thu/);
});

test("same person on Instagram and WhatsApp: number is certain, name needs date or city, name alone is only a hint", () => {
  assert.equal(sameName("Priya Sharma", "priya  sharma"), true);
  assert.equal(sameName("Priya", "Priya Sharma"), false); // one name part is never enough
  assert.equal(sameName("Priya Sharma", "Priya Verma"), false);
  assert.equal(sameDate("14 Feb 2027", "February 2027"), true);
  assert.equal(sameDate("14 Feb", "15 Feb"), false);
  assert.equal(sameCity("Jaipur", "jaipur, rajasthan"), true);
  const cand = { name: "Priya Sharma", fields: { date: "14 Feb 2027", location: "Jaipur" } };
  assert.equal(classify("Priya Sharma", { date: "February 2027" }, cand), "probable");
  assert.equal(classify("Priya Sharma", { location: "Goa", date: "March" }, cand), "weak");
  assert.equal(classify("Priya Verma", { date: "February 2027" }, cand), "none");
});

test("Needs Team: plain-words reasons, urgent ones flagged, open rows counted", () => {
  assert.equal(isUrgent("ready-for-call"), true);
  assert.equal(isUrgent("looks-like-vendor"), false);
  assert.match(describe("money-or-commitment")[0], /payment/);
  const rows = [HEADERS, ["22 Oct", "WhatsApp", "A", "+91", "", "x", "URGENT", "", "", ""], ["22 Oct", "WhatsApp", "B", "+91", "", "x", "NORMAL", "", "", "Done"], ["22 Oct", "WhatsApp", "C", "+91", "", "x", "NORMAL", "", "", ""]];
  assert.deepEqual(openCounts(rows), { total: 2, urgent: 1 });
});

test("a lead who asks a question mid-flow goes to a human; additions after the summary are recorded", () => {
  let r = advance(newState(), "hello", {});
  assert.equal(advance(r.q, "Can you tell me the location of this venue?", {}).kind, "escalate");
  const filled = newState({ date: "1 Jan", location: "Goa", occasion: "Wedding", guests: "100", requirement: "Both" });
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
  assert.match(r.reply, /guests/);
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

test("test mode only lets your own test numbers and ManyChat ids through", () => {
  delete process.env.TEST_ONLY_NUMBERS; delete process.env.TEST_ONLY_MC_IDS;
  assert.equal(testMode(), false);
  assert.equal(testAllows({ waId: "919811111111" }), true);
  process.env.TEST_ONLY_NUMBERS = "+91 98765 43210, 9555879555";
  process.env.TEST_ONLY_MC_IDS = "12345";
  assert.equal(testMode(), true);
  assert.equal(testAllows({ waId: "919876543210" }), true);
  assert.equal(testAllows({ waId: "919555879555" }), true);
  assert.equal(testAllows({ waId: "919811111111" }), false);
  assert.equal(testAllows({ waId: null, mcId: "12345" }), true);
  assert.equal(testAllows({ waId: null, mcId: "999" }), false);
  delete process.env.TEST_ONLY_NUMBERS; delete process.env.TEST_ONLY_MC_IDS;
});

test("vendors are told apart from clients: a role word alone is not enough", () => {
  for (const v of ["I am a photographer, how do I work with you?", "We are a wedding decorator team", "Looking for work as a makeup artist",
    "I'm a DJ, can I collaborate with you", "please add me to your vendor list"]) assert.equal(vendorStrong(v), true, v);
  for (const c of ["We need a photographer and decorator for our wedding", "Looking for a wedding photographer in Jaipur",
    "Planning + Decoration", "Only Decoration", "we are planning a wedding in March"]) assert.equal(vendorStrong(c), false, c);
  assert.equal(decide("I am a photographer, how do I work with you?").intent, "vendor_signup");
  assert.equal(decide("Looking for a wedding photographer").action, "escalate");
});

test("existing-client phrases go to a person", () => {
  for (const t of ["I have already booked with you", "this is regarding my wedding with you", "I paid the advance last week", "who is my planner?"]) assert.ok(CLIENT.test(t), t);
  for (const t of ["Hi, planning a wedding in Jaipur", "Need a planner for December"]) assert.ok(!CLIENT.test(t), t);
});

// ---- lead audit classification
import { classifyLead } from "../lib/audit.mjs";
{
  const DAYMS = 24 * 3600_000, now = Date.now();
  const done = { waId: "919999999999", complete: true, missing: [] };
  const part = { waId: "919999999999", complete: false, missing: [{ label: "event date" }] };
  const T = (cond, msg) => { if (!cond) { console.error("FAIL audit:", msg); process.exitCode = 1; } };
  T(classifyLead({ waId: "", missing: [], question: null }, null, null).status === "No valid number", "no number");
  T(classifyLead(done, [], null).action === "SEND_SUMMARY", "never contacted complete");
  T(classifyLead(part, [], null).action === "SEND_FINISH", "never contacted partial");
  T(classifyLead(done, [{ from: "customer", text: "stop", t: now }], { teamSpoke: false, lastOutAt: 0, lastCustomerAt: now }).action === "SKIP", "opt-out");
  T(classifyLead(done, [{ from: "customer", text: "hi", t: now }], { teamSpoke: true, lastOutAt: now - DAYMS, lastCustomerAt: now }).action === "TEAM", "lead wrote last");
  T(classifyLead(done, [{ from: "us", text: "x", t: now - 5 * DAYMS }], { teamSpoke: true, lastOutAt: now - 5 * DAYMS, lastCustomerAt: 0 }, 0, now).action === "QUIET_FOLLOWUP", "quiet");
  T(classifyLead(done, [{ from: "us", text: "x", t: now - DAYMS }], { teamSpoke: true, lastOutAt: now - DAYMS, lastCustomerAt: 0 }, 0, now).action === "WAIT", "recent");
  T(classifyLead(done, [{ from: "us", text: "x", t: now - 9 * DAYMS }], { teamSpoke: true, lastOutAt: now - 9 * DAYMS, lastCustomerAt: 0 }, 3, now).action === "WAIT", "used up");
}

// ---- tailored first reply
import { advance as adv2, newState as ns2 } from "../lib/qualify.mjs";
{
  const r = adv2(ns2(), "Hi! I'm getting married next year, can we discuss pricing?", {}, "Manya Bhutani", "Congratulations Manya, welcome to Saffron Collective 🌼 Our planner will walk you through everything.");
  if (!r.reply.startsWith("Congratulations Manya") || !/wedding, a reception/i.test(r.reply) || r.kind !== "ask") { console.error("FAIL opener", r.reply); process.exitCode = 1; }
  const r2 = adv2(ns2(), "hello", {}, "Manya");
  if (!/Welcome to Saffron Collective/.test(r2.reply)) { console.error("FAIL default opener"); process.exitCode = 1; }
}

// ---- tailored reactions during the questions
import { advance as adv3, newState as ns3 } from "../lib/qualify.mjs";
{
  let q = adv3(ns3(), "hello", {}, "Manya").q;
  const r = adv3(q, "Wedding in December 2027", { occasion: "Wedding", date: "December 2027" }, "Manya", "", "A December wedding, how lovely!");
  if (!r.reply.startsWith("A December wedding, how lovely!\n\nWhich city")) { console.error("FAIL ack ask", r.reply); process.exitCode = 1; }
  const f = { date: "Dec 2027", location: "Udaipur", occasion: "Wedding", guests: "150", requirement: "Both" };
  const s = adv3({ ...q, stage: "asking", asked: "requirement", fields: { ...f, requirement: undefined } }, "Both", { requirement: "Both" }, "Manya", "", "Planning and decoration together, perfect.");
  if (!s.reply.startsWith("Planning and decoration together, perfect. Here is what we have noted")) { console.error("FAIL ack summary", s.reply); process.exitCode = 1; }
  const c = adv3({ ...q, stage: "confirm", fields: f }, "yes", {}, "Manya", "", "Wonderful.");
  if (!c.reply.startsWith("Thank you for confirming!\n\nTo help you better")) { console.error("FAIL ack confirm", c.reply); process.exitCode = 1; }
}

test("Instagram flow: number asked first, any country accepted, deferral handled without pushing", () => {
  assert.deepEqual(extractPhone("my number is +44 7911 123456"), { status: "ok", number: "447911123456" });
  assert.deepEqual(extractPhone("+61 412 345 678"), { status: "ok", number: "61412345678" });
  assert.deepEqual(extractPhone("0091 98765 43210"), { status: "ok", number: "919876543210" });
  assert.deepEqual(extractPhone("98765 43210"), { status: "ok", number: "919876543210" });
  assert.equal(extractPhone("4155550123").status, "ambiguous"); // US-style, no country code
  assert.equal(extractPhone("12 Feb 2027").status, "none");
  assert.equal(extractPhone("around 150 guests").status, "none");

  let r = advance(newState({}, "Instagram", "instagram"), "hi, need wedding planning", {}, "Riya Shah", "Hello Riya!");
  assert.equal(r.kind, "ask");
  assert.match(r.reply, /mobile number/);
  assert.match(r.reply, /country code/);
  // gives a number: moves on to the occasion
  const given = advance(r.q, "+447911123456", { number: "+447911123456" }, "Riya");
  assert.equal(given.q.fields.number, "+447911123456");
  assert.match(given.reply, /wedding, a reception/);
  // incomplete number: asked once for the country code
  const amb = advance(r.q, "4155550123", { numberAmbiguous: true }, "Riya");
  assert.match(amb.reply, /country code/);
  assert.equal(amb.q.asked, "number");
  // first deferral: reassured once, then the next question; never stuck
  const d1 = advance(r.q, "I will share it later", {}, "Riya");
  assert.equal(d1.q.fields.number, "Pending");
  assert.match(d1.reply, /Happy to continue here/);
  assert.match(d1.reply, /wedding, a reception/);
  // refusal is respected
  const no = advance(r.q, "I don't want to share my number", {}, "Riya");
  assert.equal(no.q.fields.number, "Not shared");
  assert.match(no.reply, /continue right here/);
  // a number shared later is still picked up
  const late = advance(d1.q, "ok its +61412345678", { number: "+61412345678" }, "Riya");
  assert.equal(late.q.fields.number, "+61412345678");
  // free text is never stored as a number, and a pending number is not shown in the summary
  let s = { q: d1.q };
  for (const [t, ex] of [["wedding", { occasion: "Wedding" }], ["Feb 2027", { date: "Feb 2027" }], ["Jaipur", { location: "Jaipur" }], ["150", { guests: "150" }], ["both", { requirement: "both" }]]) s = advance(s.q, t, ex, "Riya");
  assert.equal(s.kind, "summary");
  assert.doesNotMatch(s.reply, /Mobile: Pending/);
  assert.match(s.reply, /share your mobile number here/); // one last gentle ask
  assert.equal(advance({ ...s.q, stage: "confirm" }, "yes").q.stage, "call");
});

test("Instagram helpers: odd profile names are dropped, long replies split on paragraphs", () => {
  assert.equal(cleanName("Priya Sharma"), "Priya Sharma");
  assert.equal(cleanName("🌸✨"), "");
  assert.equal(cleanName("user12345"), "");
  const long = Array.from({ length: 8 }, (_, i) => `Paragraph ${i} ` + "x".repeat(200)).join("\n\n");
  const parts = chunk(long);
  assert.ok(parts.length > 1 && parts.every((p) => p.length <= 900));
  assert.equal(parts.join("\n\n"), long);
});

test("a shared reel or photo is a reference, not a stop; only a burst of files pauses the chat", () => {
  for (const t of ["https://www.instagram.com/reel/Cxyz123/", "[attachment]", "[image]", "https://pin.it/abc"]) assert.equal(isMediaOnly(t), true, t);
  for (const t of ["we want this decor https://www.instagram.com/reel/abc/", "hello", "wedding in feb"]) assert.equal(isMediaOnly(t), false, t);
  let r = recordMedia([], 1_000_000);
  assert.equal(r.burst, false);
  r = recordMedia(r.times, 1_000_000 + 60_000);
  assert.equal(r.burst, false);
  r = recordMedia(r.times, 1_000_000 + 120_000);
  assert.equal(r.burst, true); // third file in 10 minutes
  assert.equal(recordMedia([1_000_000], 1_000_000 + 20 * 60_000).burst, false); // old ones age out
});

test("questions a website page answers get the page link; the AI never writes a link", () => {
  const url = (t) => guidesFor(t).map((g) => g.url.replace("https://saffroncollective.in", ""));
  assert.deepEqual(url("how much does a wedding cost in Delhi?"), ["/delhi-ncr-wedding-cost-guide"]);
  assert.deepEqual(url("when should we start booking vendors?"), ["/wedding-planning-timeline-guide"]);
  assert.deepEqual(url("what does a wedding planner actually do"), ["/what-does-a-wedding-planner-do-guide"]);
  assert.deepEqual(url("what should I ask the venue before booking"), ["/wedding-venue-questions-guide"]);
  assert.deepEqual(url("why do planner fees vary so much"), ["/wedding-hospitality-cost-guide"]);
  assert.deepEqual(url("is destination wedding cheaper than home city"), ["/destination-vs-home-city-wedding-cost-guide"]);
  assert.deepEqual(url("what is included in your package?"), ["/wedding-services"]);
  assert.deepEqual(url("can you share your portfolio"), ["/portfolio"]);
  assert.deepEqual(url("do you do decor?"), ["/services/wedding-decoration"]);
  assert.deepEqual(url("we are a Jaipur wedding in February, 200 guests"), []);
  assert.deepEqual(url("hi I need your services"), []);
  assert.match(guideText(guidesFor("how does it work")), /explained in detail here:\n\nOur Planning Process\nhttps:\/\/saffroncollective\.in\/planning-process/);
  for (const g of GUIDES) assert.match(g.url, /^https:\/\/saffroncollective\.in\/[a-z0-9\/-]+$/);
  assert.match(priceAnswer("how much do you charge"), /saffroncollective\.in\/pricing/);
});

test("mainRow builds an 18-column row and the sheet module has no undefined helpers", async () => {
  const { mainRow } = await import("../lib/sheet.mjs");
  const r = mainRow({ name: "A", mobile: "+919876543210", location: "Jaipur", date: "12 Feb 2027", occasion: "Wedding", requirement: "Planning", source: "Instagram", notes: "n", lastMsg: "hi", mcId: "123", priority: "HOT" });
  assert.equal(r.length, 18);
  assert.deepEqual([r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[10], r[15], r[16], r[17]], ["A", "+919876543210", "Jaipur", "12 Feb 2027", "Wedding", "Planning", "Instagram", "n", "hi", "123", "HOT"]);
});

test("a lead who was already greeted is not welcomed a second time", () => {
  const q = { ...newState({}, "Instagram", "instagram"), greeted: true };
  const r = advance(q, "I am planning a wedding", {}, "Swati", "", "", "");
  assert.doesNotMatch(r.reply, /Hello|Welcome to Saffron/);
  assert.match(r.reply, /mobile number/);
  const r2 = advance(newState({}, "Instagram", "instagram"), "I am planning a wedding", {}, "Swati", "", "", "");
  assert.match(r2.reply, /Hello Swati,/);
});

// ---- Founders' call booking ----
const NOW = Date.parse("2026-10-22T12:00:00Z"); // Thu 22 Oct, 5:30 pm IST
const IST = (iso) => Date.parse(`${iso}+05:30`);

test("call slots follow the schedule: hours, 4h notice, buffer, 4 a day", async () => {
  const { freeSlots, fmtIST, pickOffers } = await import("../lib/calendar.mjs");
  const free = freeSlots({ now: NOW });
  assert.equal(fmtIST(free[0]), "Fri, 23 Oct, 11:30 am"); // nothing left on Thursday (4h notice, hours end 7:30 pm)
  assert.ok(free.every((s) => { const d = new Date(s + 5.5 * 3600_000); const m = d.getUTCHours() * 60 + d.getUTCMinutes(); return m % 30 === 0 && m >= 660; }));
  // a busy event 11:30-12:00 blocks that slot and the 30-minute buffer after it
  const busy = [{ start: IST("2026-10-23T11:30:00"), end: IST("2026-10-23T12:00:00") }];
  assert.equal(fmtIST(freeSlots({ now: NOW, busy })[0]), "Fri, 23 Oct, 12:30 pm");
  // four consultations already on Friday: Friday is skipped
  assert.equal(fmtIST(freeSlots({ now: NOW, perDay: { "2026-10-23": 4 } })[0]), "Sat, 24 Oct, 11:00 am");
  // Sunday has an evening window
  assert.ok(free.some((s) => fmtIST(s) === "Sun, 25 Oct, 7:30 pm"));
  const offers = pickOffers(free);
  assert.equal(offers.length, 3);
  assert.equal(new Set(offers.map((s) => fmtIST(s).slice(0, 8))).size, 3); // three different days
});

test("choosing a time: number, ordinal, day or clock time; unknown times go to the team", async () => {
  const { chooseSlot } = await import("../lib/consult.mjs");
  const slots = [IST("2026-10-23T12:00:00"), IST("2026-10-24T16:30:00"), IST("2026-10-26T12:30:00")];
  assert.equal(chooseSlot("2", slots), 1);
  assert.equal(chooseSlot("option 3", slots), 2);
  assert.equal(chooseSlot("the first one please", slots), 0);
  assert.equal(chooseSlot("Saturday 4:30 pm", slots), 1);
  assert.equal(chooseSlot("monday", slots), 2);
  assert.equal(chooseSlot("12:30 pm", slots), 2);
  assert.equal(chooseSlot("2 pm", slots), "none"); // a time we did not offer, not option 2
  assert.equal(chooseSlot("none of these work", slots), "none");
  assert.equal(chooseSlot("Thursday 5pm", slots), "none");
  assert.equal(chooseSlot("hmm let me think", slots), null);
});

test("call booking chat: offer, choose, email, book, confirm", async () => {
  const { startConsult, consultTurn } = await import("../lib/consult.mjs");
  const slots = [IST("2026-10-23T12:00:00"), IST("2026-10-24T16:30:00"), IST("2026-10-26T12:30:00")];
  const booked = [];
  const deps = { offer: async () => slots, book: async (a) => { booked.push(a); return { ok: true, meetLink: "https://meet.google.com/abc", start: a.start }; } };
  const base = { ...newState({}, "Instagram", "instagram"), stage: "done", callPref: "meet", fields: { number: "+919876543210", occasion: "Wedding" } };
  const s = await startConsult(base, deps);
  assert.equal(s.q.stage, "slots");
  assert.match(s.reply, /1\. Fri, 23 Oct, 12:00 pm/);
  assert.match(s.reply, /3\. Mon, 26 Oct, 12:30 pm/);
  assert.doesNotMatch(s.reply, /for you/); // Indian number: no second time zone
  const c = await consultTurn(s.q, "2", deps); // their number is known: only the email is asked, once
  assert.equal(c.q.stage, "email");
  assert.match(c.reply, /Sat, 24 Oct, 4:30 pm IST/);
  assert.match(c.reply, /Could you share your email address\?/);
  assert.doesNotMatch(c.reply, /mobile number/);
  const none = await consultTurn({ ...s.q, fields: { occasion: "Wedding" } }, "2", deps); // nothing to reach them on: email or number
  assert.match(none.reply, /email address or mobile number/);
  assert.match(none.reply, /\n\nNote: Please include the country code if it is outside India\.$/);
  const e = await consultTurn(c.q, "sure, it is riya.k@example.com", deps);
  assert.equal(e.kind, "call-booked");
  assert.equal(booked.length, 1);
  assert.equal(booked[0].email, "riya.k@example.com");
  assert.equal(booked[0].start, slots[1]);
  assert.match(e.reply, /All set!.*Sat, 24 Oct, 4:30 pm IST/s);
  assert.match(e.reply, /riya\.k@example\.com/);
  assert.equal(e.q.stage, "done");
});

test("call booking chat: abroad shows their time; taken slot re-offers; errors and odd replies go to the team", async () => {
  const { startConsult, consultTurn } = await import("../lib/consult.mjs");
  const slots = [IST("2026-10-23T12:00:00"), IST("2026-10-24T16:30:00"), IST("2026-10-26T12:30:00")];
  const uk = { ...newState({}, "Instagram", "instagram"), stage: "done", callPref: "phone", fields: { number: "+447911123456" } };
  const ok1 = { offer: async () => slots, book: async () => ({ ok: true, meetLink: "x", start: 0 }) };
  const s = await startConsult(uk, ok1);
  assert.match(s.reply, /\(Fri \d{1,2}:\d\d [ap]m for you\)/);
  // someone took the slot meanwhile
  const taken = { offer: async () => slots, book: async () => ({ ok: false, taken: true }) };
  const c = await consultTurn(s.q, "1", taken);
  const t = await consultTurn(c.q, "a@b.co", taken);
  assert.equal(t.q.stage, "slots");
  assert.match(t.reply, /just taken/);
  // calendar error: hand to the team
  const boom = { offer: async () => slots, book: async () => { throw new Error("unauthorized_client"); } };
  const f = await consultTurn(c.q, "a@b.co", boom);
  assert.equal(f.escalate, "call-booking-failed");
  // they hold a number but do not share an email: asked once, then booked anyway (never insisted on)
  const n1 = await consultTurn(c.q, "hmm", ok1);
  assert.equal(n1.kind, "call-booked");
  // a video call with nothing to reach them on: asked, asked again once, then a person sends the invite
  const meet = { ...uk, callPref: "meet", fields: {} };
  const m1 = await consultTurn((await startConsult(meet, ok1)).q, "1", ok1);
  assert.equal(m1.kind, "email-ask");
  const m2 = await consultTurn(m1.q, "hmm", ok1);
  assert.equal(m2.kind, "email-ask");
  assert.equal((await consultTurn(m2.q, "later", ok1)).escalate, "call-needs-invite");
  // refuses to share an email and has no number: booked anyway, link shown in the chat
  const r = await consultTurn(m1.q, "I don't want to share my email", ok1);
  assert.equal(r.kind, "call-booked");
  assert.match(r.reply, /Google Meet link/);
  // a phone-call lead with no number is asked for one
  const noNum = { ...uk, fields: {} };
  assert.match((await consultTurn((await startConsult(noNum, ok1)).q, "1", ok1)).reply, /number to call you on/);
});

test("a lead who wants another day is offered times from that day, not sent to the team", async () => {
  const { consultTurn } = await import("../lib/consult.mjs");
  const { freeSlots, pickFor, pickOffers, fmtIST, parseRequest, weekdayIn } = await import("../lib/calendar.mjs");
  assert.equal(weekdayIn("my wedding is in May"), undefined); // "wedding" is not Wednesday
  assert.equal(weekdayIn("how about Thursday"), 4);
  const r = parseRequest("28th Oct at 5pm", NOW);
  assert.equal(r.exactMs, IST("2026-10-28T17:00:00"));
  assert.equal(parseRequest("tomorrow evening", NOW).dayMs, IST("2026-10-23T00:00:00"));
  assert.equal(parseRequest("hmm not sure", NOW), null);

  const perDay = { "2026-10-27": 4 }; // Tuesday 27 Oct is full
  const deps = {
    now: () => NOW,
    offer: async (req) => (req ? pickFor(freeSlots({ now: NOW, perDay, from: req.dayMs }), req) : pickOffers(freeSlots({ now: NOW, perDay }))),
    book: async (a) => ({ ok: true, meetLink: "https://meet.google.com/x", start: a.start }),
  };
  const first = [IST("2026-10-23T12:00:00"), IST("2026-10-24T16:30:00"), IST("2026-10-26T12:30:00")];
  const q = { ...newState({}, "Instagram", "instagram"), stage: "slots", slots: first, callPref: "meet", fields: { number: "+919876543210" } };

  // an exact time that is free: confirmed straight away, then the email
  const ex = await consultTurn({ ...q, fields: {} }, "can we do Wednesday 6pm?", deps);
  assert.equal(ex.q.stage, "email");
  assert.equal(ex.q.chosen, IST("2026-10-28T18:00:00"));
  assert.match(ex.reply, /Wed, 28 Oct, 6:00 pm IST/);
  // a part of a day: three times that day, closest to the part of the day
  const ev = await consultTurn(q, "Wednesday evening would be better", deps);
  assert.equal(ev.kind, "slots-offered");
  assert.equal(ev.q.slots.length, 3);
  assert.ok(ev.q.slots.every((s) => fmtIST(s).startsWith("Wed, 28 Oct")));
  // choosing one of them continues as usual
  assert.equal((await consultTurn(ev.q, "2", deps)).q.stage, "email");
  // a day that is full: says so and offers the next available days
  const full = await consultTurn(q, "next Tuesday please", deps);
  assert.match(full.reply, /do not have an opening on that day/);
  assert.ok(full.q.slots.every((s) => !fmtIST(s).startsWith("Tue, 27 Oct")));
  // no day named ("none of these work"): shows the next options, after those already offered
  const more = await consultTurn(q, "none of these work", deps);
  assert.equal(more.kind, "slots-offered");
  assert.match(more.reply, /few more options/);
  assert.ok(more.q.slots.every((s) => s > first.at(-1)));
  // nothing usable and nothing to continue from: asks for a day and time
  const ask = await consultTurn({ ...q, slots: [] }, "hmm none", deps);
  assert.equal(ask.kind, "slots-ask");
  assert.match(ask.reply, /Which day and time/);
  // only after several rounds does a person step in
  let cur = q;
  for (let i = 0; i < 3; i++) cur = (await consultTurn(cur, "none of these", deps)).q;
  assert.equal((await consultTurn(cur, "none of these", deps)).escalate, "call-time-request");
});

test("the opening answers what the lead asked for, and the number ask explains why", () => {
  const q = newState({}, "Instagram", "instagram");
  const r = advance(q, "Hi can you help with decor for my wedding?", {}, "Sanjay Jain");
  assert.equal(r.kind, "ask");
  assert.equal(r.reply,
    "Hello Sanjay,\n\nWelcome to Saffron Collective! 🌼\n\nWe would love to help you with the decor.\n\n" +
    "May I have your mobile number, so we can confirm a few details for the quote/design?\n\nNote: Please include the country code if it is outside India.");
});

test("serviceLine reads decor, planning, both, or nothing", () => {
  assert.equal(serviceLine("looking for wedding decoration in Jaipur"), "We would love to help you with the decor.");
  assert.equal(serviceLine("need a wedding planner"), "We would love to help you with the planning.");
  assert.equal(serviceLine("full planning and decor please"), "We would love to help you with the planning and decor.");
  assert.equal(serviceLine("Hi"), "");
  assert.equal(serviceLine("what are your charges?"), "");
});

test("a greeted lead who also says what they want gets the line without a second welcome", () => {
  const q = { ...newState({}, "Instagram", "instagram"), greeted: true };
  const r = advance(q, "can you help with decor?", {}, "S Jay");
  assert.ok(r.reply.startsWith("We would love to help you with the decor."));
  assert.ok(!/Welcome to Saffron/.test(r.reply));
});

test("a first message asking to talk is offered times straight away, with no questions and no price list", async () => {
  const { wantsCall, fastTrack, consultTurn } = await import("../lib/consult.mjs");
  assert.ok(wantsCall("Hi! I'm getting married next year and would love to explore wedding planning services. Can we connect to discuss the details and pricing?"));
  assert.ok(wantsCall("can you call me tomorrow"));
  assert.ok(!wantsCall("what are your charges for decor?"));
  assert.ok(!wantsCall("Hi can you help with decor for my wedding?"));
  const slots = [IST("2026-10-23T12:00:00"), IST("2026-10-24T16:30:00"), IST("2026-10-26T12:30:00")];
  const booked = [];
  const deps = { offer: async () => slots, book: async (a) => { booked.push(a); return { ok: true, meetLink: "https://meet.google.com/abc", start: a.start }; } };
  const q0 = newState({}, "Instagram", "instagram");
  const ft = await fastTrack(q0, { name: "Manya Bhutani", svc: serviceLine("wedding planning services"), deps });
  assert.equal(ft.q.stage, "slots");
  assert.ok(ft.reply.startsWith("Hello Manya,\n\nWelcome to Saffron Collective! 🌼\n\nWe would love to help you with the planning.\n\nHere are a few available slots."));
  assert.match(ft.reply, /1\. Fri, 23 Oct, 12:00 pm/);
  assert.doesNotMatch(ft.reply, /₹|flat fee|quick questions|mobile number/);
  // they pick a time; we ask for the email AND the mobile number we never asked for
  const c = await consultTurn(ft.q, "2", deps);
  assert.match(c.reply, /email address or mobile number/);
  const e = await consultTurn(c.q, "riya@example.com and 9876543210", deps);
  assert.equal(e.kind, "call-booked");
  assert.equal(booked[0].phone, "+919876543210");
  // nothing to offer: the caller falls back to the normal questions
  assert.equal(await fastTrack(q0, { name: "A", deps: { offer: async () => [] } }), null);
  // already greeted: no second welcome
  const g = await fastTrack({ ...q0, greeted: true }, { name: "A", svc: "", deps });
  assert.ok(g.reply.startsWith("Here are a few available slots."));
});

test("after the chat is finished, what they share is saved and Claude answers in context", async () => {
  const q = { ...newState({ occasion: "Wedding" }, "Instagram", "instagram"), stage: "done", callPref: "meet",
    callBooked: { start: 1, email: "a@b.co", label: "Mon, 26 Oct, 3:30 pm IST" }, notes: "Call booked: Mon, 26 Oct, 3:30 pm IST (Meet)" };
  const ctx = doneContext(q);
  assert.match(ctx, /booked for Mon, 26 Oct, 3:30 pm IST/);
  assert.match(ctx, /Occasion: Wedding/);
  const n = applyAfter(q, "my number is 9555879555", { number: "+919555879555" });
  assert.equal(n.fields.number, "+919555879555");
  const wa = applyAfter({ ...q, channel: "whatsapp", fields: { number: "+911111111111" } }, "call this number", { number: "+919555879555" });
  assert.equal(wa.fields.number, "+911111111111"); // WhatsApp keeps the number they wrote from
  assert.match(wa.notes, /Another number: \+919555879555/);
  const d = applyAfter(q, "we moved it to March, Udaipur", { fields: { date: "March", location: "Udaipur" } });
  assert.equal(d.fields.date, "March");
  assert.match(d.notes, /Event date updated: March/);

  const { draftAfter } = await import("../lib/claude.mjs");
  const realFetch = globalThis.fetch, key = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test";
  const say = (obj) => { globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: [{ text: JSON.stringify(obj) }] }) }); };
  try {
    say({ handover: "none", reply: "Thank you for sharing your number. We have updated it in our records and will use it to reach you if needed. 🌼", fields: {}, news: false });
    const ok = await draftAfter({ text: "9555879555", name: "S", context: ctx, shared: { number: "+919555879555" } });
    assert.equal(ok.handover, "none"); assert.match(ok.reply, /updated it in our records/);
    say({ handover: "none", reply: "Our fee starts at ₹3.5 lakh.", fields: {}, news: false });
    assert.equal(await draftAfter({ text: "fees?", context: ctx }), null); // money is never written by Claude
    say({ handover: "change", reply: "", fields: {}, news: false });
    assert.equal((await draftAfter({ text: "can we move the call?", context: ctx })).handover, "change");
    say({ handover: "none", reply: "Lovely, we have added this for our Founders. 🌼", fields: { date: "March", location: "Udaipur", guests: null }, news: false });
    const up = await draftAfter({ text: "we moved it to March in Udaipur", context: ctx });
    assert.deepEqual(up.fields, { date: "March", location: "Udaipur" }); assert.equal(up.news, true);
    globalThis.fetch = async () => ({ ok: false });
    assert.equal(await draftAfter({ text: "hi", context: ctx }), null); // cannot do it safely: the caller hands over
  } finally { globalThis.fetch = realFetch; if (key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = key; }
});

test("the improvement loop: taught answers are matched by Claude but written only by you", async () => {
  const { answerFromPlaybook, normalize, recordQuestion, logExchange } = await import("../lib/playbook.mjs");
  assert.equal(normalize("Do you do   DESTINATION weddings?!"), "do you do destination weddings");
  const pairs = [{ q: "Do you plan destination weddings abroad?", a: "Yes, we plan destination weddings in India and abroad. 🌼" }, { q: "Do you provide photographers?", a: "We work with trusted photographers and can recommend a few." }];
  const realFetch = globalThis.fetch, key = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test";
  const say = (obj) => { globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: [{ text: JSON.stringify(obj) }] }) }); };
  try {
    say({ match: 0 });
    assert.equal(await answerFromPlaybook("can you do a wedding in Bali?", pairs), pairs[0].a); // your words, word for word
    say({ match: null });
    assert.equal(await answerFromPlaybook("what is the weather in Udaipur?", pairs), null);
    say({ match: 7 });
    assert.equal(await answerFromPlaybook("anything", pairs), null); // out of range: ignored
    assert.equal(await answerFromPlaybook("anything", []), null); // nothing taught yet
    globalThis.fetch = async () => ({ ok: false });
    assert.equal(await answerFromPlaybook("anything", pairs), null);
    // not live: the sheet is never touched and nothing throws
    await recordQuestion({ channel: "Instagram", text: "do you do mehendi artists?" });
    await logExchange({ channel: "Instagram", contact: "@x", lead: "hi", agent: "hello" });
  } finally { globalThis.fetch = realFetch; if (key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = key; }
});

test("one line that answers several questions is read in full, and nothing already said is asked again", async () => {
  const { localFields } = await import("../lib/claude.mjs");
  const { newState, advance } = await import("../lib/qualify.mjs");
  assert.deepEqual(localFields("Wedding in november next year", "occasion"), { date: "november next year", occasion: "Wedding" });
  assert.deepEqual(localFields("Wedding\nIn november next year", "occasion"), { date: "november next year", occasion: "Wedding" });
  assert.deepEqual(localFields("may i know the price", "date"), {});
  assert.equal(localFields("12-13 Feb 2027, 200 guests", "date").date, "12-13 Feb 2027");
  assert.equal(localFields("around 150", "guests").guests, "150");
  // Claude's reading unavailable: the plain-code reading still stops the date being asked again
  const q = { ...newState({ number: "Not shared" }, "Instagram", "instagram"), stage: "asking", asked: "occasion", greeted: true };
  const r = advance(q, "Wedding in november next year", localFields("Wedding in november next year", "occasion"));
  assert.equal(r.q.fields.occasion, "Wedding"); assert.match(r.q.fields.date, /^November 20\d\d$/);
  assert.match(r.reply, /city or destination/); assert.doesNotMatch(r.reply, /What date/);
  // a date given where the occasion was asked is not stored as the occasion
  const r2 = advance(q, "In March", { date: "March" });
  assert.match(r2.q.fields.date, /^March 20\d\d$/); assert.equal(r2.q.fields.occasion, undefined);
  assert.match(r2.reply, /wedding, a reception/);
});

test("the lead's message can be read from ManyChat when the request carries only the subscriber id", async () => {
  const { getInstagramLastText } = await import("../lib/manychat.mjs");
  const realFetch = globalThis.fetch, dry = process.env.DRY_RUN, tok = process.env.MANYCHAT_API_TOKEN;
  try {
    process.env.DRY_RUN = "true";
    assert.equal(await getInstagramLastText("123"), ""); // not live: nothing is called
    process.env.DRY_RUN = "false"; process.env.MANYCHAT_API_TOKEN = "t";
    let url = "";
    globalThis.fetch = async (u) => { url = u; return { ok: true, json: async () => ({ status: "success", data: { last_input_text: "Wedding\nIn november next year " } }) }; };
    assert.equal(await getInstagramLastText("123"), "Wedding\nIn november next year");
    assert.match(url, /subscriber\/getInfo\?subscriber_id=123/);
    globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({}) });
    assert.equal(await getInstagramLastText("123"), "");
    globalThis.fetch = async () => { throw new Error("down"); };
    assert.equal(await getInstagramLastText("123"), "");
  } finally {
    globalThis.fetch = realFetch;
    if (dry === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = dry;
    if (tok === undefined) delete process.env.MANYCHAT_API_TOKEN; else process.env.MANYCHAT_API_TOKEN = tok;
  }
});

test("the WhatsApp call confirmation: details, call time, and one page to read picked from what they need", async () => {
  const { callBookedParams, serviceWords } = await import("../lib/leadfields.mjs");
  const { readingFor } = await import("../lib/guides.mjs");
  assert.equal(serviceWords("Both"), "Planning and Decoration");
  assert.equal(serviceWords("Only Decoration"), "Decoration");
  assert.equal(serviceWords("Planning"), "Planning");
  assert.equal(serviceWords("Pending"), "");
  assert.match(readingFor({ requirement: "Both" }).url, /\/planning-process$/);
  assert.match(readingFor({ requirement: "Planning" }).url, /\/planning-process$/);
  assert.match(readingFor({ requirement: "Only Decoration" }).url, /\/services\/wedding-decoration$/);
  assert.match(readingFor({}).url, /\/planning-process$/);
  const p = callBookedParams("Priya Shah", { occasion: "Wedding", date: "November next year", location: "Chandigarh or Jaipur", guests: "150-200", requirement: "Both" }, "Mon, 26 Oct, 4:30 pm IST", readingFor({ requirement: "Both" }));
  assert.equal(p.first_name, "Priya"); assert.equal(p.service, "Planning and Decoration"); assert.equal(p.call_time, "Mon, 26 Oct, 4:30 pm IST");
  for (const v of Object.values(p)) assert.doesNotMatch(v, /\n/); // template variables cannot hold line breaks
  assert.equal(callBookedParams("", {}, "x", null).guests, "Not provided"); // blanks never reach the template empty
});

test("the booking confirmation says Founders once", async () => {
  const { consultTurn } = await import("../lib/consult.mjs");
  const slot = Date.UTC(2026, 9, 26, 11, 0);
  const deps = { offer: async () => [slot], book: async () => ({ ok: true, meetLink: "" }), now: () => slot - 86400000 };
  const q = { stage: "email", chosen: slot, callPref: "phone", fields: { number: "+919899287314" }, tries: 0 };
  const r = await consultTurn(q, "me@example.com", deps);
  assert.equal(r.kind, "call-booked");
  assert.equal((r.reply.match(/Founders/g) || []).length, 1);
  assert.match(r.reply, /They will call you on \+919899287314/);
});

test("follow-ups: whoever asked last (agent or your team), once in the chat; agent chats also get one template the next day", async () => {
  const { nudgeKind } = await import("../lib/nudge.mjs");
  const { nudgeAsk } = await import("../lib/qualify.mjs");
  const { draftNudge, draftFollowUp } = await import("../lib/claude.mjs");
  const H = 3600_000, now = Date.parse("2026-10-24T05:30:00Z"); // 11:00 IST
  const base = { q: { stage: "asking", asked: "location", fields: {} }, lastIn: now - 5 * H, lastOut: now - 5 * H + 1000 };
  assert.equal(nudgeKind(base, now, 11), "SESSION");
  assert.equal(nudgeKind({ ...base, lastOut: now - 1 * H, lastIn: now - 1 * H - 1000 }, now, 11), null); // too soon after our question
  assert.equal(nudgeKind(base, now, 7), null); // outside sending hours
  assert.equal(nudgeKind(base, now, 21), null);
  assert.equal(nudgeKind({ ...base, lastIn: now - 6 * H, lastOut: now - 7 * H }, now, 11), null); // the lead spoke last
  for (const flag of [{ dnc: true }, { hold: true }, { skip: true }, { kind: "vendor" }]) assert.equal(nudgeKind({ ...base, ...flag }, now, 11), null);
  assert.equal(nudgeKind({ ...base, esc: true }, now, 11), null); // waiting for your team to answer them
  assert.equal(nudgeKind({ ...base, q: { stage: "done" } }, now, 11), null); // booked or finished, no team chat
  assert.equal(nudgeKind({ ...base, q: { stage: "paused" } }, now, 11), null);
  assert.equal(nudgeKind({ ...base, q: undefined }, now, 11), null);
  assert.equal(nudgeKind({ ...base, lastIn: now - 25 * H, lastOut: now - 25 * H + 1 }, now, 11), null); // the 24h window is closed: no free-form message
  assert.equal(nudgeKind({ ...base, lastIn: Date.parse("2026-10-22T10:00:00Z"), lastOut: Date.parse("2026-10-22T10:00:01Z") }, Date.parse("2026-10-22T14:00:00Z"), 11), null); // from before this existed
  // chats your team has been in: they are followed up too, a little later, once; the quiet follow-ups carry on after that
  const team = { humanSpoke: true, lastIn: now - 8 * H, lastOut: now - 7 * H };
  assert.equal(nudgeKind(team, now, 11), "SESSION");
  assert.equal(nudgeKind({ ...team, lastOut: now - 4 * H }, now, 11), null); // team chats wait 6 hours
  assert.equal(nudgeKind({ ...team, esc: true }, now, 11), "SESSION"); // the team has answered since they were handed over
  assert.equal(nudgeKind({ ...team, nudges: 1, nudgedAt: now - 20 * H, lastIn: now - 26 * H }, now, 11), null); // no template for team chats
  // the second nudge in agent chats: a template, the day after, once
  const sent = { ...base, nudges: 1, nudgedAt: now - 20 * H, lastIn: now - 26 * H, lastOut: now - 20 * H };
  assert.equal(nudgeKind(sent, now, 11), "TEMPLATE");
  assert.equal(nudgeKind({ ...sent, nudgedAt: now - 5 * H }, now, 11), null);
  assert.equal(nudgeKind({ ...sent, lastIn: now - 6 * 24 * H }, now, 11), null); // too old
  assert.equal(nudgeKind({ ...sent, nudges: 2 }, now, 11), null); // then it stops
  assert.equal(nudgeKind({ ...sent, lastIn: now - 10 * H }, now, 11), null); // window still open: no template yet
  assert.match(nudgeAsk({ stage: "asking", asked: "location" }), /city or destination/);
  assert.match(nudgeAsk({ stage: "confirm" }), /yes/);
  assert.equal(nudgeAsk({ stage: "done" }), "");
  const realFetch = globalThis.fetch, key = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test";
  const say = (obj) => { globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: [{ text: typeof obj === "string" ? obj : JSON.stringify(obj) }] }) }); };
  const chat = [{ from: "us", text: "Could you share the guest count and the preferred venue?" }];
  try {
    // written from the real chat; Claude decides whether we are waiting on them
    say({ waiting: true, reply: "Whenever you are ready, we would love to hear your rough guest count and venue thoughts. 🌼" });
    assert.deepEqual(await draftFollowUp({ name: "Priya", history: chat }), { send: true, reply: "Whenever you are ready, we would love to hear your rough guest count and venue thoughts. 🌼" });
    say({ waiting: false, reply: "" });
    assert.deepEqual(await draftFollowUp({ name: "Priya", history: chat }), { send: false });
    for (const bad of ["Are you free tomorrow? Or today?", "We can offer a discount if you reply today", "Our package is ₹5 lakh", "See https://example.com", "Line one\nLine two", "x".repeat(400)]) {
      say({ waiting: true, reply: bad }); assert.equal(await draftFollowUp({ name: "x", history: chat }), null);
    }
    say("not json"); assert.equal(await draftFollowUp({ name: "x", history: chat }), null);
    assert.equal(await draftFollowUp({ name: "x", history: [] }), null); // nothing to read
    globalThis.fetch = async () => ({ ok: false }); assert.equal(await draftFollowUp({ name: "x", history: chat }), null);
    // the plain fallback line for agent chats
    say("Your November wedding in Jaipur sounds lovely, we would love to continue whenever you are ready. 🌼");
    assert.match(await draftNudge({ name: "Priya", fields: { date: "November" } }), /Jaipur/);
    say("Are you still interested?"); assert.equal(await draftNudge({ name: "x" }), null);
  } finally { globalThis.fetch = realFetch; if (key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = key; }
});

test("summaries are tidy: service wording, a year on the date, one gentle question for a vague date", async () => {
  const { normalizeRequirement, normalizeDate, isVagueDate, showService, newState, advance } = await import("../lib/qualify.mjs");
  assert.equal(normalizeRequirement("Both"), "Planning + Decoration");
  assert.equal(normalizeRequirement("only decor"), "Only Decoration");
  assert.equal(normalizeRequirement("planning"), "Planning");
  assert.equal(normalizeRequirement("still deciding"), "still deciding");
  assert.equal(showService("Planning + Decoration"), "Planning and Decoration");
  const oct22 = Date.parse("2026-10-22T08:00:00Z");
  assert.equal(normalizeDate("november next year", oct22), "November 2027");
  assert.equal(normalizeDate("12-13 feb", oct22), "12-13 feb 2027".replace("feb", "feb"));
  assert.equal(normalizeDate("December", oct22), "December 2026");
  assert.equal(normalizeDate("March", oct22), "March 2027");
  assert.equal(normalizeDate("12 Feb 2027", oct22), "12 Feb 2027");
  assert.equal(isVagueDate("next year"), true);
  assert.equal(isVagueDate("winter"), true);
  assert.equal(isVagueDate("November next year"), false);
  assert.equal(isVagueDate("not sure yet"), false);
  assert.equal(isVagueDate("12 Feb 2027"), false);
  // vague date: asked once more, then accepted
  const q = { ...newState({ number: "Not shared" }, "Instagram", "instagram"), stage: "asking", asked: "date", greeted: true, fields: { occasion: "Wedding" } };
  const a = advance(q, "next year", { date: "next year" });
  assert.equal(a.q.asked, "date"); assert.match(a.reply, /approximate month/);
  const b = advance(a.q, "winter", { date: "winter" });
  assert.equal(b.q.fields.date, "Winter");
  assert.doesNotMatch(b.reply, /approximate month/);
});

test("slot stage: 'is it IST?' is answered, 'any other day' shows more, a named day is really searched", async () => {
  const { startConsult, consultTurn } = await import("../lib/consult.mjs");
  const base = Date.parse("2026-10-22T05:00:00Z");
  const day = (n, h) => Date.parse(`2026-10-${n}T00:00:00+05:30`) + h * 3600_000;
  const asked = [];
  const deps = { now: () => base, offer: async (req) => { asked.push(req); return req?.dayMs ? [day(28, 11.5), day(28, 16), day(28, 18)] : [day(23, 12), day(24, 12), day(25, 12)]; }, book: async () => ({ ok: true, meetLink: "x" }) };
  const s = await startConsult({ stage: "asking", fields: {}, callPref: "meet" }, deps);
  const tzr = await consultTurn(s.q, "Is it IST?", deps);
  assert.equal(tzr.kind, "slots-info"); assert.match(tzr.reply, /Indian Standard Time/); assert.equal(tzr.q.stage, "slots"); assert.equal(tzr.escalate, undefined);
  const w = await consultTurn(s.q, "anything on Wednesday?", deps);
  assert.equal(w.kind, "slots-offered"); assert.ok(asked.some((r) => r?.dayMs), "the requested day is passed to the calendar");
  assert.doesNotMatch(w.reply, /fully booked/);
  const o = await consultTurn(s.q, "any other day?", deps);
  assert.equal(o.kind, "slots-offered"); assert.match(o.reply, /few more options/);
});

test("Hindi / Hinglish leads get the fixed questions in their language, and it sticks", async () => {
  const { detectLang } = await import("../lib/lang.mjs");
  const { newState, advance, nudgeAsk } = await import("../lib/qualify.mjs");
  assert.equal(detectLang("Hume shaadi ki planning chahiye"), "hi");
  assert.equal(detectLang("मुझे डेकोर चाहिए"), "hi");
  assert.equal(detectLang("Hi, we are planning a wedding in Udaipur"), "en");
  assert.equal(detectLang("Delhi", "hi"), "hi");               // a short answer never flips it back
  assert.equal(detectLang("Yes we would like to plan the wedding in Goa", "hi"), "en"); // a whole English sentence does
  const q = newState({}, "WhatsApp", "whatsapp");
  const a = advance(q, "Mujhe shaadi ki planning chahiye, aap batao kya karna hoga", { requirement: "Planning" }, "Riya");
  assert.equal(a.q.lang, "hi");
  assert.match(a.reply, /Namaste Riya/);
  assert.match(a.reply, /sawaal/);
  assert.match(a.reply, /shaadi ke liye hai, reception/);
  const b = advance(a.q, "Shaadi", { occasion: "Wedding" }, "Riya");
  assert.equal(b.q.lang, "hi");
  assert.match(b.reply, /Aap apna event kis date/);
  assert.match(nudgeAsk(b.q), /Aap apna event kis date/);
  // the summary is in Hinglish too
  const f = { ...b.q, stage: "asking", asked: "requirement", fields: { occasion: "Wedding", date: "March 2027", location: "Udaipur", guests: "200" } };
  const c = advance(f, "dono", { requirement: "Both" }, "Riya");
  assert.equal(c.kind, "summary");
  assert.match(c.reply, /Humne yeh details note ki hain/);
  assert.match(c.reply, /Aapko chahiye: Planning aur Decoration/);
  // English leads are untouched
  const e = advance(newState({}, "WhatsApp", "whatsapp"), "Hello, planning a wedding", {}, "Riya");
  assert.equal(e.q.lang, "en"); assert.match(e.reply, /Welcome to Saffron Collective/);
});

test("Hindi call times and booking confirmation", async () => {
  const { startConsult, consultTurn } = await import("../lib/consult.mjs");
  const base = Date.parse("2026-10-22T05:00:00Z");
  const day = (n, h) => Date.parse(`2026-10-${n}T00:00:00+05:30`) + h * 3600_000;
  const deps = { now: () => base, offer: async () => [day(23, 12), day(24, 12), day(25, 12)], book: async () => ({ ok: true, meetLink: "https://meet.google.com/x" }) };
  const s = await startConsult({ stage: "asking", fields: { number: "+919876543210" }, callPref: "meet", lang: "hi" }, deps);
  assert.match(s.reply, /Bahut badhiya/); assert.match(s.reply, /Jo time suit kare/);
  const tz = await consultTurn(s.q, "kya ye IST hai?", deps);
  assert.equal(tz.kind, "slots-info"); assert.match(tz.reply, /Indian Standard Time/);
  const c = await consultTurn(s.q, "2", deps);
  assert.match(c.reply, /email address/); assert.match(c.reply, /Bahut badhiya/);
  const b = await consultTurn(c.q, "riya@example.com", deps);
  assert.equal(b.kind, "call-booked"); assert.match(b.reply, /Sab set hai/); assert.match(b.reply, /calendar invite/);
});

test("hot-lead flag", async () => {
  const { leadPriority, monthsAway } = await import("../lib/priority.mjs");
  const now = Date.parse("2026-10-22T08:00:00Z");
  assert.equal(monthsAway("November next year", now), 13);
  assert.equal(monthsAway("March 2027", now), 5);
  assert.equal(monthsAway("sometime", now), null);
  const full = { occasion: "Wedding", date: "March 2027", location: "Udaipur", guests: "200", requirement: "Planning + Decoration" };
  assert.equal(leadPriority({ fields: full }, now), "HOT");                                  // everything in, within 9 months
  assert.equal(leadPriority({ fields: { ...full, date: "November 2027" } }, now), "WARM");   // everything in, but far away
  assert.equal(leadPriority({ fields: { ...full, date: "November 2027" }, callPref: "meet" }, now), "HOT"); // wants a call
  assert.equal(leadPriority({ fields: { ...full, date: "November 2027", guests: "350" } }, now), "HOT");    // very large
  assert.equal(leadPriority({ fields: { occasion: "Wedding" } }, now), "");
  assert.equal(leadPriority({ fields: { occasion: "Wedding", location: "Goa", date: "Dec 2026" } }, now), "WARM");
  assert.equal(leadPriority({ stage: "slots", fields: {} }, now), "HOT");
});

test("call reminders: the day before in the morning, and about an hour before", async () => {
  const { dueReminders, reminderParams, callRecord } = await import("../lib/calls.mjs");
  const IST = (s) => Date.parse(`${s}+05:30`);
  const call = (over = {}) => ({ id: "c1", waId: "919876543210", name: "Riya Kapoor", label: "Fri, 23 Oct, 4:30 pm IST", join: "Google Meet link: https://meet.google.com/abc", start: IST("2026-10-23T16:30:00"), bookedAt: IST("2026-10-20T12:00:00"), sent: {}, ...over });
  assert.deepEqual(dueReminders([call()], IST("2026-10-22T10:30:00")).map((d) => d.kind), ["day"]);   // day before, 10:30
  assert.deepEqual(dueReminders([call()], IST("2026-10-22T08:00:00")), []);                           // too early
  assert.deepEqual(dueReminders([call()], IST("2026-10-22T14:00:00")), []);                           // window missed: no late "tomorrow" reminder
  assert.deepEqual(dueReminders([call({ sent: { day: 1 } })], IST("2026-10-22T10:30:00")), []);      // already sent
  assert.deepEqual(dueReminders([call()], IST("2026-10-23T15:30:00")).map((d) => d.kind), ["hour"]); // an hour before
  assert.deepEqual(dueReminders([call()], IST("2026-10-23T14:00:00")), []);                           // too early for the hour reminder
  assert.deepEqual(dueReminders([call()], IST("2026-10-23T17:00:00")), []);                           // already started
  assert.deepEqual(dueReminders([call({ waId: "" })], IST("2026-10-23T15:30:00")), []);               // nobody to remind
  assert.deepEqual(dueReminders([call({ bookedAt: IST("2026-10-22T09:00:00") })], IST("2026-10-22T10:30:00")), []); // booked an hour ago: no reminder straight after booking
  assert.deepEqual(reminderParams(call()), { first_name: "Riya", call_time: "Fri, 23 Oct, 4:30 pm IST", join_info: "Google Meet link: https://meet.google.com/abc" });
  const r = callRecord({ id: "e1", start: 1, label: "x", name: "Riya", number: "+91 98765 43210", pref: "phone", meetLink: "https://meet.google.com/abc" });
  assert.equal(r.waId, "919876543210"); assert.match(r.join, /call you on this number/);
  assert.equal(callRecord({ id: "e2", start: 1, label: "x", number: "Not shared" }).waId, "");
});

test("a lead with a booked call can move it, keep it, or ask to cancel", async () => {
  const { consultTurn, startReschedule, wantsReschedule, wantsCancel } = await import("../lib/consult.mjs");
  assert.equal(wantsReschedule("Can we reschedule the call?"), true);
  assert.equal(wantsReschedule("Sorry, I can't make it at that time"), true);
  assert.equal(wantsReschedule("Thank you, see you then"), false);
  assert.equal(wantsCancel("Please cancel the call"), true);
  const base = Date.parse("2026-10-22T05:00:00Z");
  const day = (n, h) => Date.parse(`2026-10-${n}T00:00:00+05:30`) + h * 3600_000;
  const moves = [];
  const deps = { now: () => base, offer: async () => [day(26, 12), day(27, 12), day(28, 12)], move: async (a) => { moves.push(a); return { ok: true, start: a.start }; }, book: async () => { throw new Error("must not create a second event"); } };
  const booked = { stage: "done", fields: { number: "+919876543210" }, callPref: "meet", callBooked: { start: day(23, 16.5), label: "Fri, 23 Oct, 4:30 pm IST", eventId: "ev1", meetLink: "m" }, notes: "" };
  assert.equal(await startReschedule({ ...booked, callBooked: { ...booked.callBooked, eventId: "" } }, "reschedule", deps), null); // an older booking has no event id: a person handles it
  const rs = await startReschedule(booked, "can we reschedule?", deps);
  assert.equal(rs.kind, "reschedule-offered"); assert.equal(rs.q.stage, "slots"); assert.match(rs.reply, /other times for your call/);
  const mv = await consultTurn(rs.q, "2", deps);
  assert.equal(mv.kind, "call-moved"); assert.equal(moves[0].eventId, "ev1"); assert.equal(moves[0].start, day(27, 12));
  assert.match(mv.reply, /moved to Tue, 27 Oct, 12:00 pm IST/);
  assert.equal(mv.q.stage, "done"); assert.equal(mv.q.callBooked.eventId, "ev1"); assert.equal(mv.q.callBooked.start, day(27, 12)); assert.equal(mv.q.reschedule, undefined);
  assert.match(mv.q.notes, /Call moved to/);
  // changed their mind: the booking stays
  const keep = await consultTurn(rs.q, "no, keep it as it is", deps);
  assert.equal(keep.kind, "reschedule-dropped"); assert.match(keep.reply, /stays as planned for Fri, 23 Oct/); assert.equal(keep.q.callBooked.eventId, "ev1");
  // the new time was just taken: other times are offered, nothing is moved
  const taken = await consultTurn(rs.q, "1", { ...deps, move: async () => ({ ok: false, taken: true }) });
  assert.equal(taken.kind, "slots-offered"); assert.match(taken.reply, /just taken/);
  // the calendar fails: a person finishes it
  const boom = await consultTurn(rs.q, "1", { ...deps, move: async () => { throw new Error("calendar down"); } });
  assert.equal(boom.escalate, "call-time-request");
});

test("team alert says who, why and what they wrote, on one line each", async () => {
  const { alertParams, describe, isUrgent } = await import("../lib/needsteam.mjs");
  const p = alertParams({ name: "Riya", channel: "Instagram", why: "Asked a question during the questions", lastMsg: "Do you do\nUdaipur  weddings?", sheetLink: "https://docs.google.com/spreadsheets/d/x" });
  assert.deepEqual(p, { lead: "Riya (Instagram)", reason: "Asked a question during the questions", message: "Do you do Udaipur weddings?", sheet_link: "https://docs.google.com/spreadsheets/d/x" });
  assert.equal(alertParams({ channel: "WhatsApp", waId: "919876543210" }).lead, "+919876543210 (WhatsApp)");
  assert.equal(alertParams({}).message, "-");
  assert.equal(isUrgent("agent-error"), true); assert.equal(isUrgent("call-cancel-request"), true); assert.equal(isUrgent("reminder-failed"), false);
  assert.ok(describe("agent-error")[0].length > 10);
});

test("replay: every scripted chat in test/scenarios behaves as written", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { replay, check } = await import("../lib/replay.mjs");
  const dir = new URL("./scenarios/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  assert.ok(files.length >= 4);
  for (const f of files) {
    const sc = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
    const problems = check(sc, await replay(sc));
    assert.deepEqual(problems, [], `${f}: ${problems.join("\n")}`);
  }
});

test("weekly review: numbers, unhappy chats, and only approved suggestions are used", async () => {
  const { sumMetrics, weeklyNumbers, weeklyParams, unhappyChats, parseStamp, weekLabel } = await import("../lib/weekly.mjs");
  const { usableAnswers } = await import("../lib/playbook.mjs");
  const now = Date.parse("2026-10-26T04:00:00Z");
  const t = sumMetrics([{ new_leads: 3, calls_booked: 1, escalations: 2 }, { new_leads: 2, ig_escalations: 1, calls_booked: 1, ig_leads_completed: 2 }]);
  const w = weeklyNumbers(t, { waiting: 2, suggested: 3 });
  assert.deepEqual([w.leads, w.booked, w.handed, w.completed], [5, 2, 3, 2]);
  const p = weeklyParams("19 Oct to 25 Oct", w, "https://x");
  assert.equal(p.to_approve, "5"); assert.ok(Object.values(p).every((v) => v && !/\n/.test(v)));
  assert.equal(weekLabel(now), "19 Oct to 25 Oct");
  assert.ok(Math.abs(parseStamp("22 Oct, 14:03", now) - Date.parse("2026-10-22T14:03:00+05:30")) < 1000);
  const rows = [
    ["22 Oct, 14:03", "Instagram", "@a", "I already told you the date", "What date?"],
    ["22 Oct, 14:05", "Instagram", "@b", "Wedding in Goa", "Thanks"],
    ["01 Jun, 10:00", "Instagram", "@c", "I just said that", "..."],
    ["23 Oct, 09:00", "WhatsApp", "+91", "are you a bot?", "..."],
  ];
  assert.deepEqual(unhappyChats(rows, now).map((u) => u.contact), ["@a", "+91"]);
  // a suggestion is used only after the owner types Y; her own answer always wins
  const vals = [["h"], ["t", "IG", "Do you do Goa?", "", 1, "Waiting", "Yes, we do destination weddings.", ""], ["t", "IG", "Do you do Jaipur?", "", 1, "Waiting", "Yes, Jaipur too.", "Y"], ["t", "IG", "Q3?", "Mine", 1, "Waiting", "Sugg", "Y"], ["t", "IG", "Q4?", "", 1, "Ignore", "S", "Y"]];
  assert.deepEqual(usableAnswers(vals), [{ q: "Do you do Jaipur?", a: "Yes, Jaipur too." }, { q: "Q3?", a: "Mine" }]);
});

test("greetName uses a first name only when the profile name looks like a person", async () => {
  const { greetName } = await import("../lib/leadfields.mjs");
  assert.equal(greetName("Riya Sharma"), "Riya");
  assert.equal(greetName("priya"), "Priya");
  assert.equal(greetName("ANANYA K"), "Ananya");
  assert.equal(greetName("✨ Neha ✨"), "Neha");
  for (const bad of ["", "S", "S Jay", "Planning Studio India", "dreamweddings.events", "rahul_1987", "@riya", "Sharma Photography", "xyzcompanyhandle", "Royal Decor Pvt Ltd"]) assert.equal(greetName(bad), "", bad);
});

test("the opening says plain Hello when the profile name is a business", () => {
  const q = newState({}, "Instagram", "instagram");
  const r = advance(q, "Hi can you help with decor for my wedding?", {}, "Royal Decor Studio");
  assert.ok(r.reply.startsWith("Hello,\n\nWelcome to Saffron Collective!"));
});

test("ManyChat requests with line breaks or quotes in the message are still read", async () => {
  const { parseManychatEvent } = await import("../lib/manychat.mjs");
  const clean = parseManychatEvent('{"subscriber_id":"1","name":"Riya","ig_username":"riya","text":"hello"}');
  assert.equal(clean.text, "hello");
  const broken = parseManychatEvent('{\n "subscriber_id": "123",\n "name": "Riya Sharma",\n "ig_username": "riya",\n "text": "Hi\nWedding in Jaipur\n\"Dec\" 2027"\n}');
  assert.equal(broken.subscriber_id, "123");
  assert.equal(broken.name, "Riya Sharma");
  assert.equal(broken.text, 'Hi\nWedding in Jaipur\n"Dec" 2027');
  const full = parseManychatEvent(JSON.stringify({ id: "9", first_name: "A", name: "Asha Rao", ig_username: "asha", last_input_text: "line1\nline2" }));
  assert.equal(full.subscriber_id, "9");
  assert.equal(full.text, "line1\nline2");
  assert.equal(parseManychatEvent("nonsense"), null);
});

test("full contact data with a line break in last_input_text is still read", async () => {
  const { parseManychatEvent } = await import("../lib/manychat.mjs");
  const raw = '{"key":"user:1","id":"1549599050","page_id":"9","first_name":"Swati","name":"Swati Sharma","last_input_text":"Maybe\nJaipur","optin_phone":false,"phone":null,"ig_username":"swati","custom_fields":{"city":"x"}}';
  assert.throws(() => JSON.parse(raw));
  const e = parseManychatEvent(raw);
  assert.equal(e.subscriber_id, "1549599050");
  assert.equal(e.text, "Maybe\nJaipur");
  assert.equal(e.name, "Swati Sharma");
  assert.equal(e.ig_username, "swati");
});

test("a title in the profile name is skipped when greeting", async () => {
  const { greetName } = await import("../lib/leadfields.mjs");
  assert.equal(greetName("Dr. Shivani Bhardwaj"), "Shivani");
  assert.equal(greetName("Dr Rahul"), "Rahul");
  assert.equal(greetName("Mrs. Anita Rao"), "Anita");
  assert.equal(greetName("Dr."), "");
});

test("a first message asking about decor price gets a short reply: one answer, one question, no links", () => {
  const msg = "Hi, I'd like to enquire about your charges for engagement décor at a property. Could you please share your pricing details?";
  const r = advance(newState({}, "Instagram", "instagram"), msg, {}, "Dr. Shivani Bhardwaj", "", "", priceAnswer(msg) + "\n\n" + guideText(guidesFor(msg)));
  assert.ok(r.reply.startsWith("Hello Shivani,"));
  assert.doesNotMatch(r.reply, /https?:\/\//);
  assert.doesNotMatch(r.reply, /few quick questions|This is required/);
  assert.match(r.reply, /Founders will walk you through it on a quick call/);
  assert.match(r.reply, /mobile number/);
  assert.ok(r.reply.length < 460, `reply is ${r.reply.length} characters`);
});

test("a vendor who introduces themselves gets a greeting and the sign-up link, using the name and business they gave", async () => {
  process.env.VENDOR_SIGNUP_URL = "https://example.test/vendor-signup";
  process.env.ANTHROPIC_API_KEY = "test";
  const { vendorWelcome } = await import("../lib/rules.mjs");
  const { classifySenderDetail } = await import("../lib/claude.mjs");
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: [{ text: '{"who":"vendor","name":"Tanmay","business":"Q Luxury Rentals (QLR)"}' }] }) });
  try {
    const found = await classifySenderDetail({ text: "I'm Tanmay from Q Luxury Rentals (QLR). We specialise in premium furniture rentals. Sharing our catalogue.", name: "" });
    assert.equal(found.who, "vendor");
    assert.equal(found.name, "Tanmay");
    const msg = vendorWelcome(found);
    assert.match(msg, /^Hello Tanmay!/);
    assert.match(msg, /Thank you for introducing Q Luxury Rentals QLR to us/);
    assert.match(msg, /https:\/\/example\.test\/vendor-signup/);
    assert.ok(!/team will get back to you/.test(msg));
    assert.match(vendorWelcome({}), /^Thank you for your interest in working with Saffron Collective!/);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: [{ text: '{"who":"client","name":"Asha","business":"X"}' }] }) });
    assert.deepEqual(await classifySenderDetail({ text: "need decor", name: "" }), { who: "client", name: "", business: "" });
  } finally { globalThis.fetch = realFetch; delete process.env.ANTHROPIC_API_KEY; }
});

test("the vendor message has the exact line breaks: link on its own line, closing sentences on separate lines", async () => {
  process.env.VENDOR_SIGNUP_URL = "https://saffron.planningstudio.in/vendor-onboarding";
  const { decide, vendorWelcome, vendorReminder } = await import("../lib/rules.mjs");
  const want = "Thank you for your interest in working with Saffron Collective! 🌼\n\nPlease create your vendor profile here:\nhttps://saffron.planningstudio.in/vendor-onboarding\n\nIt takes a few minutes.\nOnce you are registered, our team will review your profile and be in touch.";
  assert.equal(decide("I'm a photographer and videographer. Would love to work with you.").text, want);
  assert.equal(vendorWelcome({}), want);
  assert.ok(vendorWelcome({ name: "Pulkit" }).startsWith("Hello Pulkit!\n\n" + want));
  const r = vendorReminder();
  assert.match(r, /complete your onboarding using the vendor profile link shared above/);
  assert.ok(!/https?:\/\//.test(r)); // the reminder points up the chat, it does not paste the link again
});

test("the first reply from Claude is short: greeting, welcome plus one line, one more line, then the number question with its Note", async () => {
  process.env.ANTHROPIC_API_KEY = "test";
  const { draftOpening } = await import("../lib/claude.mjs");
  const { advance, newState } = await import("../lib/qualify.mjs");
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: [{ text: "Congratulations on the upcoming wedding in your family, what wonderful news.\n\nWe'd be delighted to help bring the celebrations to life." }] }) });
  try {
    const opener = await draftOpening({ text: "Someone in my family is getting married", name: "Puja Jais", greeted: false });
    assert.equal(opener, "Hello Puja,\n\nWelcome to Saffron Collective! 🌼\nCongratulations on the upcoming wedding in your family, what wonderful news.\n\nWe'd be delighted to help bring the celebrations to life.");
    const r = advance(newState({}, "Instagram", "instagram"), "Someone in my family is getting married", {}, "Puja Jais", opener);
    assert.equal(r.reply, opener + "\n\nMay I have your mobile number, so we can confirm a few details for the quote/design?\n\nNote: Please include the country code if it is outside India.");
    assert.ok(r.reply.length < 340, `first reply is ${r.reply.length} characters`);
    // a long or malformed draft is thrown away and the plain short welcome is used instead
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: [{ text: "x ".repeat(100) }] }) });
    assert.equal(await draftOpening({ text: "hi there", name: "Puja", greeted: false }), null);
    // already welcomed: just the two lines
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: [{ text: "How lovely.\n\nWe'd be delighted to help." }] }) });
    assert.equal(await draftOpening({ text: "wedding", name: "Puja", greeted: true }), "How lovely.\n\nWe'd be delighted to help.");
  } finally { globalThis.fetch = realFetch; delete process.env.ANTHROPIC_API_KEY; }
});

test("the email is asked once; if they do not share it the call is booked anyway from their number, never insisted on", async () => {
  const { consultTurn } = await import("../lib/consult.mjs");
  const slots = [IST("2026-10-23T12:00:00"), IST("2026-10-24T16:30:00"), IST("2026-10-26T12:30:00")];
  const booked = [];
  const deps = { offer: async () => slots, book: async (a) => { booked.push(a); return { ok: true, meetLink: "https://meet.google.com/abc", eventId: "ev1", start: a.start }; } };
  const st = (callPref, fields) => ({ ...newState({}, "Instagram", "instagram"), stage: "slots", slots, callPref, fields });
  // 1. Darshika: phone call, number known. The email is asked once...
  const ask = await consultTurn(st("phone", { number: "+919876543210" }), "1", deps);
  assert.equal(ask.kind, "email-ask");
  assert.match(ask.reply, /Could you share your email address\? It is only to send you the calendar invite\./);
  // ...she says "Sorry": booked anyway, with no attendee, and told they will be called
  const phone = await consultTurn(ask.q, "Sorry", deps);
  assert.equal(phone.kind, "call-booked");
  assert.equal(booked.at(-1).email, "");
  assert.equal(phone.escalate, undefined);
  assert.match(phone.reply, /They will call you on \+919876543210/);
  assert.doesNotMatch(phone.reply, /Meet link|calendar invite/i);
  // 2. Video call, number known, no email: the Meet link is shared in the chat, and WhatsApp when the confirmation is set up
  const ask2 = await consultTurn(st("meet", { number: "+919876543210" }), "2", deps);
  assert.equal(ask2.kind, "email-ask");
  process.env.CALL_TEMPLATE_NAME = "call_booked";
  try {
    const meet = await consultTurn(ask2.q, "no thanks", deps);
    assert.equal(meet.kind, "call-booked");
    assert.match(meet.reply, /Google Meet link:\nhttps:\/\/meet\.google\.com\/abc/);
    assert.match(meet.reply, /share the call details with you on WhatsApp \(\+919876543210\)/);
  } finally { delete process.env.CALL_TEMPLATE_NAME; }
  // 3. An email given straight away books a video call with the invite; no number is pushed
  const pick = await consultTurn(st("meet", { number: "Pending" }), "3", deps);
  assert.equal(pick.kind, "email-ask");
  assert.match(pick.reply, /email address or mobile number/);
  const mail = await consultTurn(pick.q, "my email is a.b@example.com", deps);
  assert.equal(mail.kind, "call-booked");
  assert.equal(booked.at(-1).email, "a.b@example.com");
  assert.match(mail.reply, /calendar invite to a\.b@example\.com/);
  // ...and a number instead of an email is enough too
  assert.equal((await consultTurn(pick.q, "+91 98111 22233", deps)).kind, "call-booked");
  // 4. A phone call with no number: the number is asked for; an email alone books it but a person is told to get the number
  const need = await consultTurn(st("phone", { number: "Pending" }), "1", deps);
  assert.match(need.reply, /best number to call you on/);
  const got = await consultTurn(need.q, "9811122233", deps);
  assert.equal(got.kind, "call-booked");
  assert.match(got.reply, /They will call you on \+919811122233/);
  const emailOnly = await consultTurn(need.q, "a.b@example.com", deps);
  assert.equal(emailOnly.kind, "call-booked");
  assert.equal(emailOnly.escalate, "call-needs-number");
});
