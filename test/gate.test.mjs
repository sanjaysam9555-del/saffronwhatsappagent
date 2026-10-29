import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

process.env.DRY_RUN = "true";
process.env.ANTHROPIC_API_KEY = "test-key";
process.env.OWNER_NUMBER = "919810000001";
process.env.TEAM_ALERT_NUMBER = "919310400859";
delete process.env.CONTEXT_GATE;
const gate = await import("../lib/readgate.mjs");
const wati = await import("../lib/wati.mjs");
const { sendInstagramText } = await import("../lib/manychat.mjs");
const { contextCheck } = await import("../lib/presend.mjs");

const LEAD = "919860449954", SID = "123456789012345";
const withTool = async (name, input, fn) => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: [{ type: "tool_use", name, input }] }) });
  try { return await fn(); } finally { globalThis.fetch = real; }
};
const blocked = (p) => assert.rejects(p, (e) => e.name === "ContextNotRead");

test("THE ONE RULE: nothing goes to a lead unless the chat was read and Claude was given it", async () => {
  // outside any run: blocked (a send path that was not wrapped in withChat)
  await blocked(wati.sendSessionMessage(LEAD, "hello"));
  await blocked(sendInstagramText(SID, "hello"));
  await gate.withChat(async () => {
    // nothing read yet
    await blocked(wati.sendSessionMessage(LEAD, "hello"));
    await blocked(wati.sendTemplateMessage(LEAD, "t", { first_name: "A" }));
    await blocked(sendInstagramText(SID, "hello"));
    // chat read, Claude never saw it
    gate.noteRead(LEAD); gate.noteRead(SID);
    await blocked(wati.sendSessionMessage(LEAD, "hello"));
    await blocked(sendInstagramText(SID, "hello"));
    // Claude handed a chat: now it may go (the dry run only logs)
    gate.claudeSaw([]);
    assert.deepEqual(await wati.sendSessionMessage(LEAD, "hello"), { dryRun: true });
    assert.deepEqual(await wati.sendTemplateMessage(LEAD, "t", { first_name: "A" }), { dryRun: true });
    assert.deepEqual(await sendInstagramText(SID, "hello"), { dryRun: true });
    // a different person is not covered by this person's reading
    await blocked(wati.sendSessionMessage("919800000002", "hello"));
  });
  // a chat read AFTER Claude last looked is not covered until Claude looks again
  await gate.withChat(async () => {
    gate.noteRead(LEAD); gate.claudeSaw([]);
    gate.noteRead("919800000003");
    await blocked(wati.sendSessionMessage("919800000003", "hello"));
    gate.claudeSaw([]);
    assert.deepEqual(await wati.sendSessionMessage("919800000003", "hello"), { dryRun: true });
  });
});

test("the gate: your own team and owner numbers are exempt, the modes work, and a breach is logged", async () => {
  await gate.withChat(async () => {
    assert.deepEqual(await wati.sendSessionMessage("919810000001", "your order is done"), { dryRun: true }); // owner
    assert.deepEqual(await wati.sendTemplateMessage("+91 93104 00859", "alert", {}), { dryRun: true });     // team alert
  });
  process.env.CONTEXT_GATE = "log";
  try {
    const r = gate.assertContext(LEAD, "test");
    assert.equal(r.ok, false, "log mode reports it but does not throw");
    process.env.CONTEXT_GATE = "off";
    assert.equal(gate.assertContext(LEAD, "test").ok, true);
  } finally { delete process.env.CONTEXT_GATE; }
  assert.equal(gate.gateMode(), "enforce", "with nothing set the default is to block");
  await gate.withChat(async () => { gate.exemptFromGate(SID); assert.deepEqual(await sendInstagramText(SID, "test helper"), { dryRun: true }); });
});

test("reading the chat from Wati counts as the chat being read (an empty chat too), an unreadable one does not", async () => {
  const real = globalThis.fetch;
  process.env.WATI_BASE_URL = "https://wati.test";
  try {
    await gate.withChat(async () => {
      globalThis.fetch = async () => ({ status: 404, ok: false });
      assert.deepEqual(await wati.getRecentMessages(LEAD, 10), []);
      assert.equal(gate.readState(LEAD).read, true);
    });
    await gate.withChat(async () => {
      globalThis.fetch = async () => ({ status: 500, ok: false });
      assert.equal(await wati.getRecentMessages(LEAD, 10), null);
      assert.equal(gate.readState(LEAD).read, false, "an unreadable chat is not a read chat");
    });
  } finally { globalThis.fetch = real; }
});

test("Claude's check before a scheduled message: fails closed, and hands Claude the chat", async () => {
  const chat = [{ from: "us", text: "We would like a few more details", t: 1 }, { from: "customer", text: "Planning in the coming year", t: 2 }];
  // chat not read: nothing is sent
  assert.equal((await contextCheck({ to: LEAD, history: null, planned: "x" })).send, false);
  // Claude unreachable: nothing is sent
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 529, text: async () => "overloaded" });
  try { assert.equal((await gate.withChat(() => contextCheck({ to: LEAD, history: chat, planned: "x" }))).send, false); } finally { globalThis.fetch = real; }
  // Claude says send: the gate then opens for this person only
  await gate.withChat(async () => {
    const v = await withTool("send_it", { why: "fits" }, () => contextCheck({ to: LEAD, history: chat, planned: "Gentle reminder" }));
    assert.equal(v.send, true);
    assert.deepEqual(await wati.sendTemplateMessage(LEAD, "t", {}), { dryRun: true });
    await blocked(wati.sendTemplateMessage("919800000009", "t", {}));
  });
  // Claude says do not send
  const no = await gate.withChat(() => withTool("do_not_send", { why: "the lead already answered" }, () => contextCheck({ to: LEAD, history: chat, planned: "x" })));
  assert.equal(no.send, false);
  assert.match(no.why, /already answered/);
});

// ---- the structure: a new send path cannot skip the rule without this test failing ----
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const SEND_CALL = /\b(sendSessionMessage|sendTemplateMessage|sendInstagramText)\(/;
const OWNER_OR_TEAM_ONLY = new Set(["daily-summary.mjs", "morning-digest.mjs", "weekly-review.mjs"]); // sent to your own number only

test("STRUCTURE: both exits check the gate, and every function that can send runs inside it", () => {
  assert.match(read("lib/wati.mjs"), /export async function sendSessionMessage[^{]*\{\s*assertContext\(/);
  assert.match(read("lib/wati.mjs"), /export async function sendTemplateMessage[^{]*\{\s*assertContext\(/);
  assert.match(read("lib/manychat.mjs"), /export async function sendInstagramText[^{]*\{\s*assertContext\(/);
  const bad = [];
  for (const f of readdirSync(new URL("../netlify/functions/", import.meta.url))) {
    if (!f.endsWith(".mjs")) continue;
    const src = read(`netlify/functions/${f}`);
    if (!SEND_CALL.test(src)) continue;
    if (OWNER_OR_TEAM_ONLY.has(f)) { assert.match(src, /OWNER_NUMBER|TEAM_ALERT_NUMBER/, `${f} must send only to your own number`); continue; }
    if (!/export default \([^)]*\) => withChat\(/.test(src)) bad.push(`${f}: sends messages but does not run inside withChat`);
    if (!/contextCheck|understandChat|routeMessage|draftFollowUp|reviewChat/.test(src)) bad.push(`${f}: sends messages but never hands Claude the chat`);
  }
  assert.deepEqual(bad, []);
});

test("STRUCTURE: owner-ordered sends and the inbound handlers read the chat first", () => {
  const deps = read("lib/operatordeps.mjs");
  for (const call of ["sendInstagramText(m.sid", "sendTemplateMessage(number", "sendSessionMessage(waId"]) {
    const i = deps.indexOf(call);
    assert.ok(i > 0 && deps.lastIndexOf("contextCheck(", i) > deps.lastIndexOf("async", i - 400), `a Claude check comes before ${call}`);
  }
  const wa = read("netlify/functions/wati-process-background.mjs"), ig = read("netlify/functions/ig-process-background.mjs");
  assert.ok(wa.indexOf("READ FIRST") > 0 && wa.indexOf("READ FIRST") < wa.indexOf("const d = decide("), "WhatsApp reads first, before decide()");
  assert.ok(ig.indexOf("READ FIRST") > 0 && ig.indexOf("READ FIRST") < ig.indexOf("const d = decide("), "Instagram reads first, before decide()");
  // exemptFromGate is only for the two test helpers
  const users = readdirSync(new URL("../netlify/functions/", import.meta.url)).filter((f) => f.endsWith(".mjs") && /exemptFromGate\(/.test(read(`netlify/functions/${f}`)));
  assert.deepEqual(users, ["ig-process-background.mjs"]);
  assert.equal((ig.match(/exemptFromGate\(sid\)/g) || []).length, 2, "only the two test helpers are exempt");
});
