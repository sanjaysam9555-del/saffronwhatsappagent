import test from "node:test";
import assert from "node:assert/strict";

process.env.VENDOR_SIGNUP_URL = "https://example.test/vendor-signup";
const m = await import("../lib/missed.mjs");
const { checkOutgoing } = await import("../lib/guard.mjs");

const H = 3600_000;
const START = Date.parse("2026-10-26T10:00:00Z"); // the call
const call = (over = {}) => ({ id: "evt1", start: START, waId: "919800000001", name: "Nikunj Shah", label: "Mon, 26 Oct, 3:30 pm", ...over });
const read = (msgs, c = call(), sends = []) => m.afterCall(msgs, c, sends);
const team = (t, text) => ({ from: "us", text, t });
const lead = (t, text) => ({ from: "customer", text, t });

test("missed call: what the team says that means the call was missed", () => {
  for (const yes of ["Hi Nikunj, we tried calling you but could not connect", "Tried to reach you, no answer", "Hi, we couldn't reach you on the call", "You did not pick up", "Sorry we missed you", "phone was switched off", "call nahi utha", "Unable to connect with you today", "tried reaching out twice"])
    assert.match(yes, m.MISSED_TEXT, yes);
  for (const no of ["Thank you for your time today", "Sharing the proposal we discussed", "Tried the Meet link? Here it is", "Please share your date", "Great speaking with you", "I will call you tomorrow"])
    assert.doesNotMatch(no, m.MISSED_TEXT, no);
});

test("missed call (Nikunj): the first message is the question, with no times and no flower", () => {
  const t = m.missedText(1, "Nikunj Shah");
  assert.match(t, /^Hi Nikunj!/);
  assert.match(t, /could not connect last time/);
  assert.match(t, /Would you like to connect at a different time\?/);
  assert.match(t, /We would love to take this conversation ahead/);
  assert.doesNotMatch(t, /🌼|\b\d{1,2}:\d{2}\b|\bam\b|\bpm\b|1\.|slot/i, "no times and no flower in the question");
  assert.equal((t.match(/\?/g) || []).length, 1);
  // the other two are short, the last has one flower at most, and none repeats another
  const all = [1, 2, 3].map((s) => m.missedText(s, "Nikunj"));
  assert.equal(new Set(all).size, 3);
  assert.ok(all.every((x) => (x.match(/🌼/g) || []).length <= 1));
  assert.match(m.missedText(1, ""), /^Hi! /);
  for (const s of [1, 2, 3]) assert.equal(checkOutgoing({ msg: m.missedText(s, "Nikunj"), lastIn: "", prev: {}, now: START }).action, "send", `guard lets step ${s} through`);
});

test("missed call: how the lead's answer is read", () => {
  for (const yes of ["Yes", "yes please", "Sure", "ok", "Haan", "Yes, tomorrow evening works", "tomorrow 5 pm", "can we do Friday?", "Please share some slots", "I would like that", "Let's reschedule"])
    assert.equal(m.missedReply(yes), "yes", yes);
  for (const no of ["No", "no thanks", "Not interested now", "nahi", "we have already finalised someone", "please don't call me", "Cancel it", "not now"])
    assert.equal(m.missedReply(no), "no", no);
  for (const other of ["Who is this?", "I was travelling, what was it about", "What is the call for", "Send me your portfolio", "", "Hmm"])
    assert.equal(m.missedReply(other), "other", other);
  assert.equal(m.missedReply("No, tomorrow is better"), "yes", "a time they name is a yes"); // BARE_NO does not win over a named time
});

test("missed call: only the team's words or the owner make it a missed call; nobody saying anything gets one question to the team", () => {
  const at = START + H;
  // the team said so: wait ten hours after their message (a booked call is a hot lead), then send
  const said = read([team(START + 20 * 60_000, "Hi Nikunj, tried calling you but could not connect")]);
  assert.deepEqual(m.assess(call(), said, at).do, "wait");
  assert.equal(m.assess(call(), said, START + 20 * 60_000 + 10 * H - 1000).do, "wait");
  const due = m.assess(call(), said, START + 20 * 60_000 + 10 * H);
  assert.equal(due.do, "send");
  assert.equal(due.step, 1);
  // the owner said so: the first message goes as soon as the call time is over
  const none = read([]);
  assert.equal(m.assess(call({ missedFlag: START + 2 * H }), none, START + 2 * H + 1000).do, "send");
  assert.equal(m.assess(call({ missedFlag: START + 2 * H }), none, START + 30 * 60_000).do, "wait", "the call is not over yet");
  // nobody has said anything: ask the team once, never send
  assert.equal(m.assess(call(), none, START + 2 * H).do, "skip");
  assert.equal(m.assess(call(), none, START + 4 * H).do, "ask-team");
  assert.equal(m.assess(call({ teamAsked: START + 4 * H }), none, START + 8 * H).do, "skip");
  // the team wrote about something else after the call: the call happened, nothing to follow up
  assert.equal(m.assess(call(), read([team(START + 2 * H, "Sharing the proposal as discussed")]), START + 30 * H).do, "skip");
});

test("missed call: never when the lead wrote after the call, has no number, or the call is long past", () => {
  const wrote = read([lead(START + 2 * H, "Sorry, was in a meeting"), team(START + 3 * H, "tried calling you")]);
  assert.equal(m.assess(call(), wrote, START + 40 * H).do, "skip");
  assert.equal(m.assess(call({ waId: "" }), read([team(START + H, "no answer")]), START + 40 * H).do, "skip");
  assert.equal(m.assess(call({ missedFlag: START + H }), read([]), START + 6 * 24 * H).do, "skip");
  assert.equal(m.assess(call({ follow: { step: 1, at: START, state: "asked" } }), read([team(START + H, "no answer")]), START + 40 * H).do, "skip", "already following up");
});

test("missed call: the agent's own messages are not the team's", () => {
  const r = read([team(START + 2 * H, "Reminder: your call is today"), team(START + 3 * H, "We tried calling you")], call(), [START + 2 * H + 1000]);
  assert.equal(r.team.length, 1, "the reminder the agent sent is not the team");
  assert.equal(r.lastTeamAt, START + 3 * H);
  const onlyAgent = read([team(START + 2 * H, "tried calling you, no answer")], call(), [START + 2 * H + 5000]);
  assert.equal(onlyAgent.teamSaysMissed, false, "a message the agent itself sent never counts as the team saying it");
});

test("missed call: three messages at most, spaced, then cold, and a reply stops them", () => {
  const f = (step, at, state = "asked") => call({ follow: { step, at, state } });
  const T = START + 30 * H;
  assert.equal(m.nextStep(f(1, T), 0, T + 23 * H).do, "wait");
  assert.deepEqual(m.nextStep(f(1, T), 0, T + 24 * H), { do: "send", step: 2 });
  assert.equal(m.nextStep(f(2, T), 0, T + 47 * H).do, "wait");
  assert.deepEqual(m.nextStep(f(2, T), 0, T + 48 * H), { do: "send", step: 3 });
  assert.equal(m.nextStep(f(3, T), 0, T + 47 * H).do, "wait");
  assert.equal(m.nextStep(f(3, T), 0, T + 48 * H).do, "cold");
  // they answered after our message: nothing more is sent
  assert.equal(m.nextStep(f(1, T), T + H, T + 30 * H).do, "none");
  assert.equal(m.nextStep(f(1, T, "offered"), 0, T + 30 * H).do, "none");
  assert.equal(m.nextStep(f(1, T, "declined"), 0, T + 30 * H).do, "none");
  assert.equal(m.nextStep(call(), 0, T).do, "none");
});

test("missed call: sending hours, the 24-hour window and the approved templates", () => {
  assert.equal(m.inSendingHours(Date.parse("2026-10-27T03:29:00Z")), false); // 08:59 IST
  assert.equal(m.inSendingHours(Date.parse("2026-10-27T03:30:00Z")), true);  // 09:00 IST
  assert.equal(m.inSendingHours(Date.parse("2026-10-27T14:29:00Z")), true);  // 19:59 IST
  assert.equal(m.inSendingHours(Date.parse("2026-10-27T14:30:00Z")), false); // 20:00 IST
  const now = Date.now();
  assert.equal(m.windowOpen(now - 22 * H, now), true);
  assert.equal(m.windowOpen(now - 24 * H, now), false);
  assert.equal(m.windowOpen(0, now), false);
  const env = { CALL_MISSED_TEMPLATE: " missed_v1 ", CALL_MISSED_LAST_TEMPLATE: "last_v1" };
  assert.equal(m.stepTemplate(1, env), "missed_v1");
  assert.equal(m.stepTemplate(2, env), "", "an unset template is empty, never the word undefined");
  assert.equal(m.stepTemplate(3, env), "last_v1");
  assert.deepEqual(m.missedParams("Nikunj Shah"), { first_name: "Nikunj" });
  assert.deepEqual(m.missedParams(""), { first_name: "there" });
});

test("missed call: call records are kept long enough to follow up", () => {
  assert.ok(m.KEEP_CALL_MS >= 8 * 24 * H);
  assert.ok(m.GIVE_UP_AFTER_MS + 3 * 24 * H <= m.KEEP_CALL_MS, "the follow-up window fits inside the time records are kept");
});

test("missed call: the wiring exists (job, reminder cleanup, reply handling)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  assert.match(src("netlify/functions/call-reminder.mjs"), /KEEP_CALL_MS/);
  assert.match(src("netlify/functions/missed-calls.mjs"), /schedule: "\*\/30 \* \* \* \*"/);
  assert.match(src("netlify/functions/missed-calls.mjs"), /inSendingHours/);
  const wa = src("netlify/functions/wati-process-background.mjs");
  assert.match(wa, /missedReply\(text\)/);
  assert.match(wa, /startReschedule\(q0, text, consultDeps\)/, "a yes moves the same calendar event to a new time");
  assert.match(wa, /const missedOpen/);
  assert.match(wa, /Anything else \("who is this\?"/, "an unclear reply is answered like any finished chat, not sent to a person");
  assert.ok(m.TEAM_WAIT_MS <= 12 * H, "the wait after the team's message is at most twelve hours");
});

test("missed call (Meghna): a 'tried calling' text followed by the team speaking to the lead is not a missed call", () => {
  const tried = team(START + 20 * 60_000, "Hi Meghna, we tried calling you but could not connect");
  const later = [
    team(START + 3 * H, "Hi Meghna, sharing our drive link"),
    team(START + 3 * H + 60_000, "This contains all deliverables included in wedding planning, like we discussed on call."),
  ];
  // the agent's own 'tried calling' message is not the team
  assert.equal(read([tried]).teamSaysMissed, true, "on its own it is a missed call");
  const r = read([tried, ...later]);
  assert.equal(r.teamSaysMissed, false, "the team got through afterwards");
  // never the "new time for the call" question: one simple "did you get a chance to look", 36 hours after the team's last message, so she can go through what was shared
  assert.equal(m.assess(call(), r, START + 10 * H).do, "wait");
  assert.equal(m.assess(call(), r, START + 3 * H + 60_000 + 35 * H).do, "wait", "not inside 36 hours of the team's message");
  const a = m.assess(call(), r, START + 40 * H);
  assert.equal(a.do, "send");
  assert.equal(a.kind, "shared");
  assert.equal(a.step, 1);
  const txt = m.sharedText("Meghna Sethi");
  assert.match(txt, /^Hi Meghna! Did you get a chance to look at what we shared\?\n\nPlease let us know when we can connect next\.$/);
  assert.doesNotMatch(txt, /new time for the call|Founders|"yes"|🌼/);
  // a second 'could not connect' after the link is the last word again
  assert.equal(read([tried, ...later, team(START + 5 * H, "Tried calling again, no answer")]).teamSaysMissed, true);
  // the owner flagged it, then the team wrote to the lead: the simple follow-up, after 36 hours
  const flagged = START + 2 * H;
  assert.equal(m.assess(call({ missedFlag: flagged }), read([team(flagged + H, "Sharing the proposal as discussed")]), flagged + 36 * H).do, "wait");
  assert.equal(m.assess(call({ missedFlag: flagged }), read([team(flagged + H, "Sharing the proposal as discussed")]), flagged + 38 * H).kind, "shared");
  // the team spoke and nobody ever said the call was missed: the call happened, nothing is sent
  assert.equal(m.assess(call(), read([team(START + H, "Thank you for your time today, sharing the proposal")]), START + 40 * H).do, "skip");
  // the owner flagged it and nobody wrote since: send
  assert.equal(m.assess(call({ missedFlag: flagged }), read([team(flagged - H, "Tried calling")]), flagged + 1000).do, "send");
});

test("missed call (Meghna step 2): after the team shared things, the chain sends one simple follow-up instead of asking for a new call time", async () => {
  const T = START + H, f = (step, extra = {}) => ({ ...call(), follow: { step, at: T, state: "asked", via: "chat", ...extra } });
  const ours = [team(T, "Hi Meghna! We tried to reach you for our call but could not connect last time.")];
  // nothing from the team since our note: step 2 is due after a day
  assert.deepEqual(m.nextStep(f(1), 0, T + 24 * H, read(ours, call(), [T])), { do: "send", step: 2 });
  // the team shared a link / spoke to her after our note (even if our note was deleted from the chat): not the "new time" question
  const spoke = [...ours, team(T + 3 * H, "Sharing our drive link, like we discussed on call")];
  const r = read(spoke, call(), [T]);
  assert.equal(m.nextStep(f(1), 0, T + 24 * H, r).do, "wait", "36 hours after the team's last message, not before");
  assert.equal(m.nextStep(f(1), 0, T + 38 * H, r).do, "wait", "still inside the 36 hours");
  assert.deepEqual(m.nextStep(f(1), 0, T + 40 * H, r), { do: "send", step: 2, kind: "shared" });
  assert.deepEqual(m.nextStep(f(2), 0, T + 52 * H, r), { do: "send", step: 3, kind: "shared" });
  assert.equal(m.nextStep(f(3), 0, T + 52 * H, r).do, "none", "after the last note the team has it");
  // the simple follow-up is the end of the chain: nothing more is sent, then cold
  assert.equal(m.nextStep(f(2, { kind: "shared" }), 0, T + 47 * H, r).do, "wait");
  assert.equal(m.nextStep(f(2, { kind: "shared" }), 0, T + 49 * H, r).do, "cold");
  // a 'tried calling' text from the team is not 'in touch'
  assert.equal(m.nextStep(f(1), 0, T + 24 * H, read([team(T + H, "Tried calling again, no answer")])).do, "send");
  // her own template: its own approved template, never the "new time" ones
  assert.equal(m.stepTemplate(2, { CALL_MISSED_FOLLOWUP_TEMPLATE: "f_v1", CALL_MISSED_SHARED_TEMPLATE: " shared_v1 " }, "shared"), "shared_v1");
  assert.equal(m.stepTemplate(2, { CALL_MISSED_FOLLOWUP_TEMPLATE: "f_v1" }, "shared"), "");
  const { readFileSync } = await import("node:fs");
  const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  assert.match(src("netlify/functions/missed-calls.mjs"), /nextStep\(call, read\.lastCustomerAt, now, read\)/, "the job hands the chat reading to every step");
  assert.match(src("netlify/functions/missed-calls.mjs"), /one simple follow-up asking if they had a chance to look/, "Claude is told why the message is sent");
});

test("the approved-template text for the 'did you get a chance to look' note matches what the agent would send (missed_shared_v1)", async () => {
  const { readFileSync } = await import("node:fs");
  const all = JSON.parse(readFileSync(new URL("../wati-templates.json", import.meta.url), "utf8"));
  const t = all.find((x) => x.ElementName === "missed_shared_v1");
  assert.ok(t, "the template definition is in wati-templates.json");
  assert.deepEqual(t.TemplateParamMapping.map((p) => p.ParamName), ["first_name"]);
  assert.equal(t.Body.replace("{{first_name}}", "Meghna"), m.sharedText("Meghna Sethi"));
});
