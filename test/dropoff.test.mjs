import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { advance, newState, resumeOnCallAnswer, teamSpokeSince, EITHER_CALL } from "../lib/qualify.mjs";
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
  let q = advance(newState({}, "Instagram", "instagram"), "I am getting married", {}, "Mr", "", "", "").q;
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
  assert.equal(again.q.asked, "occasion");
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
