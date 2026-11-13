import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { silentChats, silentText, stampMs, plainWhy } from "../lib/noreply.mjs";
import { teamChatReason, asksForCall } from "../lib/callflag.mjs";
import { REASONS, isUrgent } from "../lib/needsteam.mjs";
import { bookFor } from "../lib/ownerbook.mjs";
import { runChecks, summary, failures, pureChecks } from "../lib/selftest.mjs";
import { answerLast } from "../lib/answerlast.mjs";

const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const NOW = Date.parse("2026-11-14T01:00:00+05:30"); // Sat 14 Nov, 1 am IST

// ---- L47 ----
test("silent chats: the daily summary lists who wrote in and got no reply, and why, in plain words", () => {
  const rows = [
    ["Time", "Channel", "Contact", "Lead said", "Agent replied"],
    ["13 Nov, 18:49", "WhatsApp", "+919595882608", "Hi", "(no reply: handed to the team: team-already-in-chat · build 8aafd39)"],
    ["13 Nov, 19:00", "WhatsApp", "+91111", "x", "(no reply: duplicate · build 8aafd39)"],       // the machinery working: not a person left waiting
    ["10 Nov, 10:00", "WhatsApp", "+91222", "old", "(no reply: error: boom)"],                   // older than a day
    ["14 Nov, 00:10", "WhatsApp", "+91333", "Hello", "(no reply: ended at wati-process-background.mjs:267 · build 8aafd39)"],
    ["14 Nov, 00:11", "WhatsApp", "+91333", "Anyone?", "(no reply: ended at wati-process-background.mjs:267)"],
    ["13 Nov, 20:00", "WhatsApp", "+91444", "ok", "Thanks, noted"],                              // a real reply: not silent
  ];
  const list = silentChats(rows, NOW);
  assert.deepEqual(list.map((s) => s.contact), ["+91333", "+919595882608"], "newest first, one entry per person, nothing technical or old");
  assert.equal(list[0].n, 2);
  assert.match(silentText(list), /\+919595882608: "Hi" → your team is already in the chat/);
  assert.match(silentText(list), /\+91333 \(2 messages\)/);
  assert.equal(silentText([]), "");
  assert.equal(plainWhy("handed to the team: lead-wants-call-in-team-chat"), "asked for a call in a chat your team is in");
  assert.ok(stampMs("13 Nov, 18:49", NOW) > 0 && stampMs("nonsense", NOW) === 0);
  assert.match(src("netlify/functions/daily-summary.mjs"), /silentChats\(data\.values \|\| \[\], now\)/);
});

// ---- L48 ----
test("team call flag: a lead who asks for a call in a team-owned chat is flagged urgent, anything else stays an ordinary hand-over", () => {
  for (const t of ["Can we keep a call on Tuesday ?", "Please connect over call today.", "can we schedule a meeting"]) {
    assert.equal(teamChatReason(t, {}), "lead-wants-call-in-team-chat", t);
  }
  for (const t of ["Okay", "Theek hai", "3pm?", "Cabs will need to be arranged from outside"]) assert.equal(teamChatReason(t, {}), "team-already-in-chat", t);
  assert.equal(teamChatReason("Can we have a call?", { kind: "vendor" }), "team-already-in-chat", "a vendor is not a lead");
  assert.equal(asksForCall("I have a few things to discuss"), false, "no single loose word decides");
  assert.ok(REASONS["lead-wants-call-in-team-chat"] && isUrgent("lead-wants-call-in-team-chat"), "urgent, so the team alert goes out");
  assert.equal(isUrgent("team-already-in-chat"), false);
  const h = src("netlify/functions/wati-process-background.mjs");
  assert.match(h, /teamChatReason\(text, c\)/);
  assert.match(h, /toHuman\(chat \? teamChatReason\(text, c\) : "history-unavailable", false\)/, "still no message to the lead (ack false)");
});

// ---- L49 ----
const mkBook = (over = {}) => {
  const log = { booked: [], kept: [], sent: [], marked: [] };
  const deps = {
    now: () => NOW, waId: "919867495379", name: "Poorvi",
    stillFree: async () => true, offer: async () => [NOW + 30 * 3600_000],
    book: async (a) => { log.booked.push(a); return { ok: true, meetLink: "https://meet.google.com/abc", eventId: "evt1" }; },
    keep: async (c) => log.kept.push(c), windowClosed: async () => false,
    send: async (t) => log.sent.push(t), mark: async (p) => log.marked.push(p), ...over,
  };
  return { deps, log };
};
test("book command: books the stated time, remembers the call for reminders, and tells the lead through the gate", async () => {
  const { deps, log } = mkBook();
  const r = await bookFor({ when: "Tuesday 4 pm" }, deps);
  assert.equal(r.ok, true);
  assert.equal(log.booked.length, 1);
  assert.equal(new Date(log.booked[0].start + 5.5 * 3600_000).getUTCDay(), 2, "a Tuesday");
  assert.equal(log.booked[0].pref, "meet");
  assert.equal(log.kept[0].id, "evt1"); assert.equal(log.kept[0].number, "919867495379");
  assert.match(log.sent[0], /Your call with our Founders is booked for .*Tue.*4:00 pm IST/s);
  assert.match(log.sent[0], /meet\.google\.com\/abc/);
  assert.equal(log.marked[0].callBooked.eventId, "evt1");
});
test("book command: refuses without a clear day and time, books nothing when the time is not free, and never messages a closed window", async () => {
  let m = mkBook();
  assert.equal((await bookFor({ when: "sometime next week" }, m.deps)).ok, false);
  assert.equal((await bookFor({ when: "Tuesday" }, m.deps)).ok, false, "a day with no time is not a booking");
  assert.equal(m.log.booked.length, 0);
  m = mkBook({ stillFree: async () => false });
  const r = await bookFor({ when: "Tuesday 4 pm" }, m.deps);
  assert.equal(r.ok, false); assert.match(r.why, /not free/); assert.match(r.why, /Free times near it/);
  assert.equal(m.log.booked.length, 0);
  m = mkBook({ windowClosed: async () => true });
  const c = await bookFor({ when: "Tuesday 4 pm" }, m.deps);
  assert.equal(c.ok, true); assert.equal(m.log.sent.length, 0); assert.match(c.told, /24-hour/);
  m = mkBook();
  await bookFor({ when: "Tuesday 4 pm", tell: false }, m.deps);
  assert.equal(m.log.sent.length, 0, "no_message is respected");
  m = mkBook({ book: async () => ({ ok: false, taken: true }) });
  assert.equal((await bookFor({ when: "Tuesday 4 pm" }, m.deps)).ok, false);
  assert.equal(m.log.kept.length, 0, "a call that was not booked is not remembered");
});
test("book command: is an owner tool and goes through the same calendar and the gated send", () => {
  const o = src("lib/operator.mjs"), d = src("lib/operatordeps.mjs");
  assert.match(o, /toolDef\("book_call"/);
  assert.match(o, /c\.name === "book_call"/);
  assert.match(d, /bookFor: async \(who, input\)/);
  assert.match(d, /send: \(text\) => ownerDeps\.send\(who\.waId, text\)/, "the message goes through contextCheck");
  assert.match(d, /bookConsult/);
});

// ---- L50 ----
const CLOSED = (extra = {}) => {
  const T = Date.parse("2026-11-07T05:43:04Z");
  const log = { flags: [], posts: [], reopened: [] };
  return {
    log,
    deps: {
      now: () => T + 40 * 3600_000, readMsgs: async () => [{ from: "us", text: "Hi Khushi!\n\nWelcome to Saffron Collective. \u{1F33C}\n\nHow can we help you?", t: T }, { from: "customer", text: "Need decor", t: T + 39000 }],
      getContact: async () => ({ name: "Khushi" }), setFlags: async (id, p) => log.flags.push([id, p]), allow: async () => true,
      post: async (e) => log.posts.push(e), reopen: async (id, c) => { log.reopened.push([id, c.name]); return { ok: true }; }, ...extra,
    },
  };
};
test("reopen: a closed 24-hour window is reopened with the approved check-in template, not refused, and no stale message is replayed", async () => {
  const { deps, log } = CLOSED();
  const r = await answerLast("918171900001", deps);
  assert.equal(r.ok, true); assert.equal(r.reopened, true);
  assert.deepEqual(log.reopened, [["918171900001", "Khushi"]]);
  assert.deepEqual(log.flags, [["918171900001", { esc: false, humanSpoke: false }]]);
  assert.equal(log.posts.length, 0, "the old message is not replayed into a closed window; their reply to the check-in is answered in context");
});
test("reopen: without a template, or with one sent in the last two days, nothing is sent", async () => {
  let c = CLOSED({ reopen: undefined });
  assert.match((await answerLast("918171900001", c.deps)).why, /template message is needed/);
  c = CLOSED({ allow: async () => false });
  const r = await answerLast("918171900001", c.deps);
  assert.equal(r.ok, false); assert.match(r.why, /last two days/);
  assert.equal(c.log.reopened.length, 0);
  c = CLOSED({ reopen: async () => ({ ok: false, why: "I did not send it: the chat was not read" }) });
  assert.match((await answerLast("918171900001", c.deps)).why, /did not send it/);
  const d = src("lib/operatordeps.mjs");
  assert.match(d, /contextCheck\(\{ channel: "WhatsApp", to: waId, history, planned: `Approved check-in template/, "Claude reads the chat before the template goes");
  assert.match(d, /followOpen: \{ at: Date\.now\(\), kind: "reopen" \}/, "their reply is answered (L44)");
});

// ---- L51 ----
test("self-test: a failing check is reported by name, a passing flow is silent, and the check itself sends nothing to a lead", async () => {
  const res = await runChecks([{ name: "a", run: async () => {} }, { name: "calendar read", run: async () => { throw new Error("no free times"); } }, { name: "s", run: async () => ({ warn: "CALL_TEMPLATE_NAME" }) }]);
  assert.equal(failures(res).length, 1);
  assert.match(summary(res), /2\/3 checks passed\. FAILED: calendar read \(no free times\)\. Not set: CALL_TEMPLATE_NAME/);
  const pure = await runChecks(pureChecks(NOW));
  assert.equal(failures(pure).length, 0, "the question flow and the call hours work");
  const f = src("netlify/functions/self-test.mjs");
  assert.match(f, /schedule: "30 3 \* \* \*"/);
  assert.doesNotMatch(f, /sendSessionMessage|sendTemplateMessage|agentSend|sendInstagramText/, "it never sends to a lead");
  assert.match(f, /reason: "self-test-failed"/);
  assert.ok(isUrgent("self-test-failed"));
});
