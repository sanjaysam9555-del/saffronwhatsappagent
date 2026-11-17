import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { advance, newState, resumeOnCallAnswer, teamSpokeSince, EITHER_CALL, resumeAfterAddition, ASKS_DETAILS, yearWords } from "../lib/qualify.mjs";
import { jobFollowReply } from "../lib/rules.mjs";
import { REASONS } from "../lib/needsteam.mjs";
import { withChat, setRescue, runRescue, noteWhy, assertContext, noteRead, claudeSaw, exemptFromGate, runTrace } from "../lib/readgate.mjs";

const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const IG = src("netlify/functions/ig-process-background.mjs"), WA = src("netlify/functions/wati-process-background.mjs");
const callQ = () => ({ stage: "call", asked: null, source: "Instagram", notes: "", channel: "instagram", confirmed: true, fields: { number: "+919999999999" } });

// ---- L52 (Anjana) ----
test("either call: 'either, depending on who is available' is an answer and the call times are offered, not a hand-over", () => {
  for (const t of ["Can we do either depending on who is available?", "either is fine", "whichever suits you", "No preference, both work"]) {
    assert.ok(EITHER_CALL.test(t), t);
    const r = advance(callQ(), t, {}, "Anjana", "", "", "");
    assert.equal(r.kind, "call-pref", t);
    assert.equal(r.q.callPref, "meet");
    assert.match(r.q.notes, /either a video call or a phone call/);
  }
  assert.equal(advance(callQ(), "Phone call sounds good.", {}, "A", "", "", "").q.callPref, "phone");
  assert.equal(EITHER_CALL.test("Can you call me tomorrow?"), false, "no single loose word decides");
  assert.equal(advance(callQ(), "What is the call about in detail?", {}, "A", "", "", "").kind !== "call-pref", true);
});
test("resume after our own hand-over: the answer to the open call question is read, unless a person has written since", () => {
  const hold = "Thank you for your message. A member of our team will get back to you shortly.";
  const c = { esc: true, escReason: "lead-question", q: callQ(), lastOutText: hold };
  const mine = [{ from: "customer", text: "Can we do either?" }, { from: "us", text: hold }];
  assert.equal(resumeOnCallAnswer(c, "Phone call sounds good.", mine), true);
  assert.equal(resumeOnCallAnswer(c, "either works", mine), true);
  assert.equal(resumeOnCallAnswer(c, "Phone call sounds good.", [...mine, { from: "us", text: "Hi Anjana, this is Swati, how about 4pm?" }]), false, "a person wrote: the agent stays out");
  assert.equal(resumeOnCallAnswer({ ...c, lastOutText: "" }, "Phone call sounds good.", mine), false, "cannot tell who wrote: not resumed");
  assert.equal(resumeOnCallAnswer(c, "Do you offer decor?", mine), false, "a new question is for a person");
  assert.equal(resumeOnCallAnswer({ ...c, escReason: "complaint" }, "phone", mine), false);
  assert.equal(resumeOnCallAnswer({ ...c, q: { ...callQ(), callBooked: { eventId: "e1" } } }, "phone", mine), false);
  assert.equal(teamSpokeSince([], hold), false);
  assert.match(IG, /resumeOnCallAnswer\(c, text, chat0\)/);
});

// ---- L53 (mr_and_mrs) ----
test("hi at the number question: a plain hi gets one gentle re-ask, never the 'No spam' speech or a jump to the next question", () => {
  let q = advance(newState({}, "Instagram", "instagram"), "I am getting married", { occasion: "Wedding" }, "Mr", "", "", "").q;
  assert.equal(q.asked, "date");
  q = advance(q, "December 2026", { date: "December 2026" }, "Mr", "", "", "").q;
  assert.equal(q.asked, "number");
  const r = advance(q, "hi", {}, "Mr", "", "", "");
  assert.equal(r.kind, "ask");
  assert.match(r.reply, /^Hello!/);
  assert.match(r.reply, /mobile number/);
  assert.doesNotMatch(r.reply, /No spam|Happy to continue|What date/i);
  assert.equal(r.q.asked, "number");
  assert.equal(r.q.fields.number, undefined, "not saved as Pending yet");
  const ok = advance(q, "ok", {}, "Mr", "", "", "");
  assert.match(ok.reply, /^Thank you!/);
  // the second time, the questions carry on without any speech
  const again = advance(r.q, "hi", {}, "Mr", "", "", "");
  assert.equal(again.q.asked, "location");
  assert.doesNotMatch(again.reply, /No spam|Happy to continue/i);
  // a real refusal and a real other answer are unchanged
  assert.match(advance(q, "I'm not comfortable sharing my number", {}, "Mr", "", "", "").reply, /No problem, we will continue right here/);
});

// ---- L54 (Vanshita) ----
test("job seeker writes again: a short thank-you and a row for the team, never silence; an event enquiry makes it a client chat again", () => {
  assert.match(jobFollowReply({ name: "Vanshita" }), /^Hello Vanshita!/);
  assert.match(jobFollowReply(), /passed your message on to our team/);
  assert.ok(REASONS["job-seeker-wrote-again"]);
  assert.doesNotMatch(IG, /return ok\("job seeker: a person reads the rest"\)/, "the silent exit is gone (Instagram)");
  assert.doesNotMatch(WA, /if \(c\.jobSeeker\) return ok\(\);/, "the silent exit is gone (WhatsApp)");
  for (const f of [IG, WA]) {
    assert.match(f, /jobFollowReply\(/);
    assert.match(f, /job-seeker-wrote-again/);
    assert.match(f, /act\.kind === "client" \|\| act\.kind === "price"/, "read first: an event enquiry is a client");
  }
});

// ---- L55 (Aditya) ----
test("reel with no words: always counted as a message, answered or put in front of the team, never lost", () => {
  assert.doesNotMatch(IG, /if \(!blankText\) noteInbound/, "a reel with no text is a message too");
  assert.match(IG, /\[shared a reel, post or photo\]/);
  assert.ok(REASONS["lead-shared-media"]);
  assert.match(IG, /reason: "lead-shared-media"/);
  assert.match(IG, /\["new", "asking", "confirm", "call", "slots", "email", "done"\]\.includes\(c\.q\.stage\)/, "a reel in a finished chat is thanked too");
});

// ---- L56 (Manisha / first-text drop-off) ----
test("first message safety net: a new lead whose first message ends with nothing sent gets the welcome, deliberate quiet does not", async () => {
  const sent = [];
  const run = async (why, sentBefore = 0) => withChat(async () => {
    setRescue(async () => { sent.push(why); });
    if (why) noteWhy(why);
    if (sentBefore) { exemptFromGate("x1"); assertContext("x1"); }
    return runRescue();
  });
  assert.equal(await run("ended at ig-process-background.mjs:400"), true);
  assert.equal(await run(""), true);
  assert.equal(await run("handed to the team: who-is-this"), false);
  assert.equal(await run("operator stayed quiet: spam"), false);
  assert.equal(await run("duplicate"), false);
  assert.equal(await run("later message will answer"), false);
  assert.equal(await run("ended at x", 1), false, "already answered: nothing more is sent");
  assert.equal(sent.length, 2);
  assert.match(IG, /setRescue\(async \(why\) =>/);
  assert.match(IG, /await runRescue\(\); await logNoReply\(\)/);
  assert.ok(REASONS["first-message-unanswered"]);
});

// ---- L57 (Kishancha) ----
import { checkFlowAnswer, SERVICE_FACTS } from "../lib/facts.mjs";
import { draftFlowAnswer } from "../lib/claude.mjs";
const withClaude = async (reply, fn) => {
  const f = globalThis.fetch, k = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test"; globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: [{ text: reply }] }) });
  try { return await fn(); } finally { globalThis.fetch = f; if (k === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = k; }
};
test("a simple question in the middle of the questions is answered from our facts and the open question is asked again, not handed to a person", async () => {
  assert.match(SERVICE_FACTS, /across India, including North India/);
  assert.equal(checkFlowAnswer("Yes, we do. We are based in Gurugram and plan weddings across Delhi NCR and North India, and destination weddings too."), true);
  for (const bad of ["HANDOVER", "Yes, from ₹3.5 lakh.", "We are available on 10 March.", "Our team will call you at 4pm.", "Do you want a quote?", "See https://saffronevents.in", "We guarantee the best price.", ""]) assert.equal(checkFlowAnswer(bad), false, bad);
  const hist = [{ from: "us", text: "Which city or destination are you considering?" }];
  const args = { text: "Do you host events across North India?", name: "Kishan", history: hist, fields: { occasion: "Wedding", date: "10 March 2027" }, pending: "Which city or destination are you considering?" };
  const yes = "Yes, we do. We are based in Gurugram and plan weddings and events across Delhi NCR and North India, as well as destination weddings.";
  assert.equal(await withClaude(yes, () => draftFlowAnswer(args)), yes);
  assert.equal(await withClaude("HANDOVER", () => draftFlowAnswer({ ...args, text: "Are you free on 10 March and what is the price?" })), "", "not in the facts: a person answers");
  assert.equal(await withClaude("Yes, from ₹3.5 lakh.", () => draftFlowAnswer(args)), "", "a figure Claude was not given is refused");
  assert.equal(await draftFlowAnswer(args), "", "no Claude: the old hand-over");
  for (const f of [IG, WA]) {
    assert.match(f, /draftFlowAnswer\(\{ text, name: who/);
    assert.match(f, /\$\{fa\}\\n\\n\$\{pendQ\}/, "the answer is followed by the question we were waiting for");
    assert.match(f, /\["asking", "call"\]\.includes\(leadQ\.stage\)/);
  }
});

// ---- L58 (Swati: the first message asked for the number before anything else) ----
import { orderOf, ORDER, pendingQuestion } from "../lib/qualify.mjs";
test("number second on Instagram: one easy question first (occasion, or the date when the occasion is known), then the number, then the rest", () => {
  // occasion not known: occasion, number, date
  let r = advance(newState({}, "Instagram", "instagram"), "Hi, we want help with our event", {}, "Riya", "", "", "");
  assert.equal(r.q.asked, "occasion");
  assert.doesNotMatch(r.reply, /mobile number/);
  r = advance(r.q, "wedding", { occasion: "Wedding" }, "Riya", "", "", "");
  assert.equal(r.q.asked, "number");
  assert.match(r.reply, /Founders can share the right details/);
  assert.doesNotMatch(r.reply, /required/i);
  r = advance(r.q, "+91 98765 43210", { number: "+919876543210" }, "Riya", "", "", "");
  assert.equal(r.q.asked, "date");
  // occasion known from the first message (Pooja: "Someone in my family is getting married"): date, number, location
  r = advance(newState({}, "Instagram", "instagram"), "Someone in my family is getting married", { occasion: "Wedding" }, "Pooja", "", "", "");
  assert.equal(r.q.asked, "date");
  assert.doesNotMatch(r.reply, /mobile number/);
  r = advance(r.q, "March 2027", { date: "March 2027" }, "Pooja", "", "", "");
  assert.equal(r.q.asked, "number");
  r = advance(r.q, "+919876543210", { number: "+919876543210" }, "Pooja", "", "", "");
  assert.equal(r.q.asked, "location");
  // everything said at once: the number is already there, so the questions carry on
  r = advance(newState({}, "Instagram", "instagram"), "Wedding in March 2027, call 9876543210", { occasion: "Wedding", date: "March 2027", number: "+919876543210" }, "Asha", "", "", "");
  assert.equal(r.q.asked, "location");
  // order helper: new chats carry the position, chats that began before keep the number first, WhatsApp is unchanged
  assert.deepEqual(orderOf({ channel: "instagram", numAfter: "occasion" }).slice(0, 3), ["occasion", "number", "date"]);
  assert.deepEqual(orderOf({ channel: "instagram", numAfter: "date" }).slice(0, 3), ["occasion", "date", "number"]);
  assert.equal(orderOf({ channel: "instagram" })[0], "number");
  assert.deepEqual(orderOf({ channel: "whatsapp" }), ORDER);
  assert.match(pendingQuestion({ asked: "number" }), /^May I have your mobile number, so our Founders can share the right details for the quote\/design\?/);
});

// ---- L59 (Monisha: "March 2027" then "2028*") ----
import { datePatch } from "../lib/qualify.mjs";
test("a year correction keeps the month she gave: 'March 2027' then '2028*' is March 2028, and a bare year asks only for the month", () => {
  const asking = () => ({ ...newState({}, "Instagram", "instagram"), stage: "asking", asked: "date", numAfter: "occasion", fields: { occasion: "Wedding" } });
  // both messages arrive together; Claude kept only the year, or kept the old date
  for (const ex of [{ date: "2028" }, { date: "March 2027" }]) {
    const r = advance(asking(), "March 2027\n2028*", ex, "Monisha", "", "", "");
    assert.equal(r.q.fields.date, "March 2028");
    assert.doesNotMatch(r.reply, /Roughly which month|approximate month/);
    assert.equal(r.q.asked, "number");
  }
  // the first answer was saved, then the correction arrives on its own
  let q = advance(asking(), "March 2027", { date: "March 2027" }, "Monisha", "", "", "").q;
  assert.equal(q.fields.date, "March 2027");
  q = advance(q, "2028*", { date: "2028" }, "Monisha", "", "", "").q;
  assert.equal(q.fields.date, "March 2028");
  // a bare year: only the month is asked for, and her next answer is joined to the year, never to a guessed one
  let r = advance(asking(), "2028", { date: "2028" }, "Monisha", "", "", "");
  assert.match(r.reply, /^Noted, 2028! Roughly which month/);
  assert.equal(r.q.fields.date, undefined);
  r = advance(r.q, "March", {}, "Monisha", "", "", "");
  assert.equal(r.q.fields.date, "March 2028");
  assert.equal(r.q.partialYear, undefined);
  // unchanged: a vague date without a year still gets the old gentle question, and a normal date is left as it is
  assert.match(advance(asking(), "next year", { date: "next year" }, "A", "", "", "").reply, /Even an approximate month works/);
  assert.equal(advance(asking(), "12 Feb 2027", { date: "12 Feb 2027" }, "A", "", "", "").q.fields.date, "12 Feb 2027");
  assert.equal(datePatch("hello", "March 2027"), "");
});

test("extra details after the summary still get the call offer: 'Fooding photography decoration each and every thing' is noted and we ask Google Meet or phone", () => {
  const filled = newState({ occasion: "Wedding", date: "June 2027", location: "Kolkata", guests: "400", requirement: "Planning and Decoration" });
  const sum = advance(filled, "hi", {});
  assert.equal(sum.kind, "summary");
  const add = advance(sum.q, "Fooding photography decoration each and every thing", {}, "Rahul", "", "Catering, photography and decoration all in one place, that sounds like a wonderful plan! \u{1F33C}");
  assert.equal(add.kind, "addition");
  assert.equal(add.q.stage, "call");
  assert.match(add.q.notes, /photography/);
  assert.match(add.reply, /Google Meet video call or a phone call\?/);
  assert.doesNotMatch(add.reply, /be in touch shortly/);
  // and the answer to that question is then read as a call answer
  const pick = advance(add.q, "Phone call sounds good.", {}, "Rahul");
  assert.equal(pick.kind, "call-pref");
});

test("Sonal: 'That sounds perfect.' after our soft hand-over on the summary resumes the chat, and the call is offered", () => {
  const filled = newState({ occasion: "Wedding", date: "Dec 2027", location: "Delhi NCR area", guests: "200", requirement: "Planning and Decoration" });
  const sum = advance(filled, "hi", {});
  const last = "Lovely, Sonal, a destination wedding is a wonderful option to keep open!\n\nOur planner will review everything and be in touch shortly.";
  const paused = { esc: true, escReason: "lead-added-details", q: sum.q, lastOutText: last };
  const ours = [{ from: "lead", text: "I mean Destination wedding" }, { from: "us", text: last }];
  assert.equal(resumeAfterAddition(paused, ours), true);
  // she then agrees: that is a confirmation, so the call question follows
  const r = advance(paused.q, "That sounds perfect.", {}, "Sonal");
  assert.equal(r.kind, "confirmed");
  assert.match(r.reply, /Google Meet video call or a phone call\?/);
  // never once a person wrote, a handover for another reason, or the call is booked
  assert.equal(resumeAfterAddition(paused, [...ours, { from: "us", text: "Hi Sonal, this is Swati" }]), false);
  assert.equal(resumeAfterAddition({ ...paused, escReason: "lead-question" }, ours), false);
  assert.equal(resumeAfterAddition({ ...paused, q: { ...sum.q, callBooked: { eventId: "e1" } } }, ours), false);
});

test("an ordered message is not blocked because Claude answered the pre-send check once in words or not at all: the check is tried a second time (Sonal)", async () => {
  const { contextCheck } = await import("../lib/presend.mjs");
  const keep = { key: process.env.ANTHROPIC_API_KEY, fetch: globalThis.fetch, err: console.error };
  console.error = () => {};
  try {
    process.env.ANTHROPIC_API_KEY = "test";
    let n = 0;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: ++n === 1 ? [{ type: "text", text: "Let me look at this chat." }] : [{ type: "tool_use", name: "send_it", input: { why: "fits" } }] }) });
    const r = await contextCheck({ channel: "Instagram", to: "sid-sonal", history: [{ from: "customer", text: "That sounds perfect." }], planned: "Here are a few times", ordered: true });
    assert.equal(r.send, true);
    assert.equal(n, 2, "tried twice");
    // two failures in a row still fail closed
    n = 0; globalThis.fetch = async () => { n++; return { ok: false, status: 529, text: async () => "overloaded" }; };
    const f = await contextCheck({ channel: "Instagram", to: "sid-sonal", history: [], planned: "x", ordered: true });
    assert.equal(f.send, false);
    assert.equal(n, 2);
  } finally { process.env.ANTHROPIC_API_KEY = keep.key; if (keep.key === undefined) delete process.env.ANTHROPIC_API_KEY; globalThis.fetch = keep.fetch; console.error = keep.err; }
});

test("Ash: 'Can you share the details here?' is answered by asking which details she wants, once, not by a hand-over", () => {
  for (const yes of ["Can you share the details here?", "share details", "Please send the details", "details?", "what are the details", "send me more info here"]) assert.match(yes, ASKS_DETAILS, yes);
  for (const no of ["Can you share the details of the venue in Goa?", "I will share the details here", "Wedding ceremony.", "What is the price?"]) assert.doesNotMatch(no, ASKS_DETAILS, no);
  let r = advance(newState(), "hi", {}, "Ash");
  r = advance(r.q, "Wedding ceremony.", { occasion: "Wedding" }, "Ash");
  const asked = r.q.asked;
  const a = advance(r.q, "Can you share the details here?", {}, "Ash");
  assert.equal(a.kind, "details-ask");
  assert.match(a.reply, /Which details would you like to know/);
  assert.doesNotMatch(a.reply, /team will get back/i);
  assert.equal(a.q.stage, "asking");
  assert.equal(a.q.asked, asked, "the question we were waiting for stays open");
  // asked once: the same request again goes to a person as before
  assert.equal(advance(a.q, "Can you share the details here?", {}, "Ash").kind, "escalate");
});

test("Nancy: a date given with a question mark ('Around mid december two thousand twenty six?') is an answer, saved as 2026, not a question for a person", () => {
  assert.equal(yearWords("Around mid december two thousand twenty six"), "Around mid december 2026");
  assert.equal(yearWords("twenty twenty seven"), "2027");
  let r = advance(newState(), "Someone in my family is getting married", { occasion: "Wedding" }, "Nancy");
  assert.equal(r.q.asked, "date");
  const a = advance(r.q, "Around mid december two thousand twenty six?", {}, "Nancy");
  assert.notEqual(a.kind, "escalate");
  assert.equal(a.q.fields.date, "Around mid december 2026");
  assert.equal(a.q.asked, "location", "the next question follows");
  assert.notEqual(advance(r.q, "Around mid december 2026?", { date: "mid December 2026" }, "Nancy").kind, "escalate");
  // real questions still go to a person
  assert.equal(advance(r.q, "Is 15 December fine?", {}, "Nancy").kind, "escalate");
  assert.equal(advance(r.q, "Mid december? or january?", {}, "Nancy").kind, "escalate");
  assert.equal(advance(r.q, "What dates do you have?", {}, "Nancy").kind, "escalate");
});

test("Ananya: 'Planning includes all aspects!?' after the call question is answered from the published inclusions, not handed over", async () => {
  const { isInclusionsQuestion, inclusionsAnswer } = await import("../lib/facts.mjs");
  for (const yes of ["Planning includes all aspects!?", "Does planning include catering?", "Does full planning cover everything?"]) assert.equal(isInclusionsQuestion(yes), true, yes);
  for (const no of ["What is the weather?", "Planning includes all aspects", "Phone call works better for me."]) assert.equal(isInclusionsQuestion(no), false, no);
  assert.match(inclusionsAnswer("Planning includes all aspects!?"), /saffroncollective\.in\/pricing/);
});

test("Rishav: a first message that is only a date ('Nov 2027') is kept as the date and not asked again", () => {
  const r = advance(newState(), "Nov 2027", {}, "Rishav", "Hello Rishav,");
  assert.equal(r.q.fields.date, "Nov 2027");
  assert.notEqual(r.q.asked, "date");
  assert.doesNotMatch(r.reply, /What date/);
  assert.equal(advance(newState(), "May I know the price?", {}, "X").q.fields.date, undefined);
  assert.equal(advance(newState(), "15 Dec", {}, "X").q.fields.date, "15 Dec 2026");
});
