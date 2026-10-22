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
import { newState, advance } from "../lib/qualify.mjs";
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
  assert.match(first.reply, /quick questions/);
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
  if (!/Thank you for reaching out to Saffron Collective/.test(r2.reply)) { console.error("FAIL default opener"); process.exitCode = 1; }
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
