import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { withChat, noteInbound, noteWhy, noteRead, claudeSaw, assertContext, runTrace, callerOf } from "../lib/readgate.mjs";
import { noReplyLine } from "../lib/noreply.mjs";

const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const LEAD = "919595882608";

test("no-reply log: a lead's message that ends with nothing sent leaves a reason line", async () => {
  await withChat(async () => {
    noteInbound({ channel: "WhatsApp", contact: `+${LEAD}`, text: "Hi" });
    noteWhy("team-already-in-chat");
    const line = noReplyLine(runTrace(), "abcdef1234");
    assert.match(line, /^\(no reply: team-already-in-chat/);
    assert.match(line, /build abcdef1/);
  });
});

test("no-reply log: nothing is logged once a message really went to the lead", async () => {
  await withChat(async () => {
    noteInbound({ channel: "WhatsApp", contact: `+${LEAD}`, text: "Hi" });
    noteRead(LEAD); claudeSaw([]);
    assert.equal(assertContext(LEAD).ok, true);
    assert.equal(runTrace().sent, 1);
    assert.equal(noReplyLine(runTrace()), "");
  });
});

test("no-reply log: a message to our own team does not count as a reply to the lead", async () => {
  const old = process.env.OWNER_NUMBER; process.env.OWNER_NUMBER = "919999900000";
  try {
    await withChat(async () => {
      noteInbound({ channel: "WhatsApp", contact: `+${LEAD}`, text: "Hi" });
      assertContext("919999900000"); // an alert to the owner
      noteWhy("handed to the team: who-is-this");
      assert.equal(runTrace().sent, 0);
      assert.match(noReplyLine(runTrace(), ""), /handed to the team: who-is-this/);
    });
  } finally { if (old === undefined) delete process.env.OWNER_NUMBER; else process.env.OWNER_NUMBER = old; }
});

test("no-reply log: a blocked send is not a reply, and a run with no reason still says it had none", async () => {
  await withChat(async () => {
    noteInbound({ channel: "Instagram", contact: "@someone", text: "Hello" });
    assert.throws(() => assertContext("12345678901"), /CONTEXT GATE/);
    assert.equal(runTrace().sent, 0);
    assert.match(noReplyLine(runTrace(), ""), /no reason recorded/);
  });
});

test("no-reply log: runs that were not about a lead's message log nothing", () => {
  assert.equal(noReplyLine({ inbound: null, why: "ignored", sent: 0 }), "");
  assert.match(callerOf(2), /noreply\.test\.mjs:\d+/);
});

test("no-reply log: both handlers note the inbound message, keep the reason and write the line when the run ends", () => {
  for (const f of ["netlify/functions/wati-process-background.mjs", "netlify/functions/ig-process-background.mjs"]) {
    const s = src(f);
    assert.match(s, /noteInbound\(\{ channel: "(WhatsApp|Instagram)"/, f);
    assert.match(s, /noteWhy\(`handed to the team: \$\{reason\}`\)/, f);
    assert.match(s, /await logNoReply\(\)/, f);
    assert.match(s, /logNoReply\(`error: \$\{e\.message\}`\)/, f);
  }
});
