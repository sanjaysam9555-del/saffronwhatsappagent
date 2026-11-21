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

test("operator connector: speaks the protocol and offers only read tools (nothing can send to a lead)", async () => {
  const init = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, deps);
  assert.equal(init.result.serverInfo.name, "saffron-operator");
  assert.ok(init.result.capabilities.tools);
  assert.equal(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, deps), null);
  const list = await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, deps);
  assert.deepEqual(list.result.tools.map((t) => t.name), ["list_chats", "read_chat", "catch_up_start", "catch_up_result"]);
  assert.ok(!MCP_TOOLS.some((t) => /send|book|pause|resume|correct/i.test(t.name)));
  assert.equal((await handleRpc({ jsonrpc: "2.0", id: 3, method: "nope" }, deps)).error.code, -32601);
  assert.equal((await handleRpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "send_message" } }, deps)).error.code, -32602);
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
