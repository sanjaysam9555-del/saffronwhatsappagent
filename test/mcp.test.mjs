import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handleRpc, callTool, keyOk, MCP_TOOLS, flagsOf } from "../lib/mcpops.mjs";

const now = Date.parse("2026-11-21T18:00:00Z"), H = 3600_000;
const deps = {
  now: () => now,
  wa: async () => [["919999000001", { name: "Asha", lastIn: now - H, lastOut: now - 5 * H }], ["919999000002", { name: "Bela", lastIn: now - 9 * H, lastOut: now - 2 * H, humanSpoke: true }]],
  ig: async () => [{ sid: "77", username: "radhika", name: "Radhika", lastIn: now - 2 * H, lastOut: now - 3 * H, esc: true, q: { stage: "asking", fields: { location: "Delhi", date: "Pending" } } }],
  find: async (who) => (/rad/i.test(who) ? [{ channel: "Instagram", id: "77", name: "Radhika", c: { lastIn: now - 2 * H, lastOut: now - 3 * H, q: { fields: { location: "Delhi" } } } }] : /a/i.test(who) ? [{ channel: "WhatsApp", id: "1", name: "Asha", c: {} }, { channel: "WhatsApp", id: "2", name: "Bela", c: {} }] : []),
  read: async () => [{ from: "us", text: "May I have your number?" }, { from: "customer", text: "What does full planning incudes??" }],
  startCatchUp: async () => ({ ok: true }),
  catchUpState: async () => ({ status: null, plan: null, text: "" }),
};

test("operator connector: speaks the protocol; reads are read-only and every send or change is marked as a write", async () => {
  const init = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, deps);
  assert.equal(init.result.serverInfo.name, "saffron-operator");
  assert.ok(init.result.capabilities.tools);
  assert.equal(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, deps), null);
  const list = await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, deps);
  assert.deepEqual(list.result.tools.map((t) => t.name), ["list_chats", "read_chat", "catch_up_start", "catch_up_result", "catch_up_send", "send_message", "answer_lead", "pause_agent", "resume_agent"]);
  // reads are marked read-only; every tool that can reach a lead or change the agent is marked as a write, so the client asks the owner before each call (L75)
  for (const t of MCP_TOOLS) assert.equal(t.annotations.readOnlyHint, ["list_chats", "read_chat", "catch_up_start", "catch_up_result"].includes(t.name), t.name);
  assert.ok(!MCP_TOOLS.some((t) => /book|correct/i.test(t.name))); // booking and corrections stay with the WhatsApp orders for now
  assert.equal((await handleRpc({ jsonrpc: "2.0", id: 3, method: "nope" }, deps)).error.code, -32601);
  assert.equal((await handleRpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "delete_everything" } }, deps)).error.code, -32602);
});

test("operator connector: list_chats shows who is waiting, newest first, with the agent's flags", async () => {
  const all = (await callTool("list_chats", {}, deps)).content[0].text.split("\n");
  assert.match(all[0], /Asha .*WAITING for us/);
  assert.match(all[1], /Radhika .*Instagram @radhika.*WAITING.*agent handed to a person.*stage asking/);
  assert.match(all[2], /Bela .*we spoke last.*team is in the chat/);
  const waiting = (await callTool("list_chats", { waiting_only: true, channel: "whatsapp" }, deps)).content[0].text;
  assert.match(waiting, /Asha/); assert.doesNotMatch(waiting, /Bela|Radhika/);
  assert.deepEqual(flagsOf({ dnc: true }), ["opted out"]);
});

test("operator connector: read_chat finds by name or handle, asks which one when two match, and shows saved details without the Pending ones", async () => {
  const r = (await callTool("read_chat", { who: "@radhika" }, deps)).content[0].text;
  assert.match(r, /THEM: What does full planning incudes/);
  assert.match(r, /location=Delhi/); assert.doesNotMatch(r, /date=Pending/);
  const two = await callTool("read_chat", { who: "a" }, deps);
  assert.equal(two.isError, true); assert.match(two.content[0].text, /Which one\?/);
  assert.equal((await callTool("read_chat", { who: "zzz" }, deps)).isError, true);
});

test("operator connector: the key is required, compared in constant time, and the function refuses without it; catch-up job sends nothing", () => {
  assert.equal(keyOk("a".repeat(20), "a".repeat(20)), true);
  assert.equal(keyOk("a".repeat(20), "b".repeat(20)), false);
  assert.equal(keyOk("short", "short"), false); // a key under 16 characters is never accepted
  assert.equal(keyOk("", ""), false);
  const fn = readFileSync(new URL("../netlify/functions/operator-mcp.mjs", import.meta.url), "utf8");
  assert.match(fn, /if \(!want\) return new Response\("not set up", \{ status: 503/);
  assert.match(fn, /keyOk\(url\.searchParams\.get\("key"\) \|\| bearer, want\)/);
  const job = readFileSync(new URL("../netlify/functions/catchup-background.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(job, /sendSessionMessage|sendInstagramText|catchUp\.send|ownerDeps\.send/);
  assert.match(job, /WEBHOOK_SECRET/);
});

test("operator connector: write tools send only a fresh previewed plan, refuse unsafe or duplicate messages, and never act on an unclear name", async () => {
  const sent = [], paused = [];
  const w = {
    ...deps,
    catchUpState: async () => ({ status: null, plan: w.plan, text: "" }),
    sendCatchUp: async (plan, skip) => { sent.push(["plan", skip]); return `Sent to ${plan.items.length}.`; },
    sendTo: async (f, t) => (/lakh/.test(t) ? { ok: false, why: "it breaks a safety rule (money language)" } : (sent.push([f.name, t]), { ok: true, text: t })),
    answerLead: async (id) => (id === "1" ? { ok: true } : { ok: false, why: "a person on the team has written in this chat" }),
    setPaused: async (f, p) => paused.push([f.name, p]),
  };
  w.plan = null;
  assert.equal((await callTool("catch_up_send", {}, w)).isError, true); // no preview: nothing sent
  w.plan = { at: now - 13 * H, items: [{ kind: "send" }] };
  assert.match((await callTool("catch_up_send", {}, { ...w, now: () => now })).content[0].text, /older than 12 hours|more than 12 hours/);
  w.plan = { at: Date.now() - H, items: [{ kind: "send" }, { kind: "send" }, { kind: "team" }] };
  assert.equal((await callTool("catch_up_send", { skip: ["Hansika"] }, w)).content[0].text, "Sent to 3.");
  assert.deepEqual(sent.at(-1), ["plan", ["Hansika"]]);
  assert.match((await callTool("send_message", { who: "@radhika", text: "Hello Radhika" }, w)).content[0].text, /^Sent to Radhika/);
  const bad = await callTool("send_message", { who: "@radhika", text: "It is 3 lakh" }, w);
  assert.equal(bad.isError, true); assert.match(bad.content[0].text, /safety rule/);
  const amb = await callTool("send_message", { who: "a", text: "Hi" }, w); // two chats match: nothing is sent
  assert.equal(amb.isError, true); assert.match(amb.content[0].text, /Which one\?/);
  assert.equal(sent.filter((x) => x[0] === "Asha" || x[0] === "Bela").length, 0);
  assert.equal((await callTool("answer_lead", { who: "@radhika" }, w)).isError, true); // Instagram: not offered
  await callTool("pause_agent", { who: "@radhika" }, w); await callTool("resume_agent", { who: "@radhika" }, w);
  assert.deepEqual(paused, [["Radhika", true], ["Radhika", false]]);
});

test("operator connector: every send goes through the read-first gate, and skip names find styled spellings", async () => {
  const { plainName, catchUpSend } = await import("../lib/catchup.mjs");
  assert.equal(plainName("ʀᴀᴊᴇᴇᴠ ʀᴀɪᴄʜᴀɴᴅ"), "rajeev raichand");
  const done = [];
  await catchUpSend({ items: [{ kind: "send", channel: "Instagram", id: "1", name: "ʀᴀᴊᴇᴇᴠ ʀᴀɪᴄʜᴀɴᴅ", text: "x" }, { kind: "send", channel: "Instagram", id: "2", name: "Meera", text: "y" }] }, { send: async (it) => (done.push(it.name), { ok: true }), mark: async () => {} }, { skip: ["Rajeev"] });
  assert.deepEqual(done, ["Meera"]);
  const { readFileSync } = await import("node:fs");
  const fn = readFileSync(new URL("../netlify/functions/operator-mcp.mjs", import.meta.url), "utf8");
  const od = readFileSync(new URL("../lib/operatordeps.mjs", import.meta.url), "utf8");
  assert.match(fn, /safeReply\(text\)/); assert.match(fn, /allow\(`mcpsend:/); assert.match(fn, /ownerDeps\.windowClosed/);
  assert.match(od, /sendIg: async[\s\S]*contextCheck\([\s\S]*sendInstagramText\(sid, text\)/); // the chat is read and Claude agrees before the Instagram send
  const cu = readFileSync(new URL("../lib/catchup.mjs", import.meta.url), "utf8");
  assert.match(cu, /at most ONE question/); assert.match(cu, /is NOT this: that is send_package_question/);
});
