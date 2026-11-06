import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { answerLast, unansweredTail } from "../lib/answerlast.mjs";

const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const T = Date.parse("2026-11-06T05:43:04Z");
const WELCOME = "Hi Yugdipinder!\n\nWelcome to Saffron Collective. \u{1F33C}\n\nHow can we help you?";
const CHAT = [
  { from: "customer", text: "Hey", t: T },
  { from: "us", text: WELCOME, t: T + 9000 },
  { from: "customer", text: "Need a decor guy for wedding", t: T + 39000 },
];
const harness = (msgs, { contact = {}, fresh = true, now = T + 6 * 3600_000 } = {}) => {
  const log = { flags: [], posts: [] };
  return {
    log,
    deps: {
      now: () => now, readMsgs: async () => msgs, getContact: async () => contact,
      setFlags: async (id, p) => log.flags.push([id, p]), allow: async () => fresh, post: async (e) => log.posts.push(e),
    },
  };
};

test("answer command: the lead's unanswered tail is what came after the last message of ours", () => {
  assert.deepEqual(unansweredTail(CHAT), { texts: ["Need a decor guy for wedding"], lastAt: T + 39000 });
  assert.deepEqual(unansweredTail([...CHAT, { from: "us", text: "ok", t: T + 50000 }]).texts, []);
  const burst = [CHAT[1], ...["a", "b", "c", "d"].map((x, i) => ({ from: "customer", text: x, t: T + 20000 + i }))];
  assert.deepEqual(unansweredTail(burst).texts, ["b", "c", "d"], "at most the last three");
});

test("answer command: releases the chat and hands the message back to the normal handler with its own time", async () => {
  const { deps, log } = harness(CHAT, { contact: { name: "Yugdipinder" } });
  const r = await answerLast("919049944687", deps);
  assert.equal(r.ok, true);
  assert.equal(r.text, "Need a decor guy for wedding");
  assert.deepEqual(log.flags, [["919049944687", { esc: false, humanSpoke: false }]]);
  assert.equal(log.posts.length, 1);
  const e = log.posts[0];
  assert.equal(e.eventType, "message"); assert.equal(e.owner, false); assert.equal(e.type, "text");
  assert.equal(e.text, "Need a decor guy for wedding"); assert.equal(e.senderName, "Yugdipinder");
  assert.equal(e.replay, true); assert.equal(e.replayLastInAt, T + 39000, "the 24-hour window is counted from his message, not from now");
});

test("answer command: refuses, and changes nothing, when nothing waits, the team is in the chat, the window is closed, or it was just released", async () => {
  const cases = [
    ["unreadable chat", harness(null), /could not read/],
    ["our message is last", harness([...CHAT, { from: "us", text: "ok", t: T + 50000 }]), /nothing is waiting/],
    ["a person on the team wrote", harness([CHAT[0], { from: "us", text: "Hi, Swati here. What do you need?", t: T + 60000 }, { from: "customer", text: "decor", t: T + 90000 }]), /team has already written/],
    ["window closed", harness(CHAT, { now: T + 40 * 3600_000 }), /24-hour/],
    ["released a moment ago", harness(CHAT, { fresh: false }), /already released/],
  ];
  for (const [name, { deps, log }] of cases) {
    const r = await answerLast("919049944687", deps);
    assert.equal(r.ok, false, name); assert.match(r.why, cases.find((c) => c[0] === name)[2], name);
    assert.deepEqual([log.flags, log.posts], [[], []], `${name}: nothing changed`);
  }
});

test("answer command: it sends nothing itself; the handler reads the chat and sends through the gate", () => {
  const a = src("lib/answerlast.mjs");
  assert.doesNotMatch(a, /sendSessionMessage|sendTemplateMessage|sendInstagramText/);
  assert.match(src("lib/operator.mjs"), /toolDef\("answer_lead"/);
  assert.match(src("lib/operator.mjs"), /deps\.answerLast\(who\.waId\)/);
  assert.match(src("lib/operatordeps.mjs"), /wati-process-background\?key=/);
  assert.match(src("netlify/functions/wati-process-background.mjs"), /evt\.replay && Number\(evt\.replayLastInAt\) > 0/);
});
