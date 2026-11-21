import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catchUpEligible, catchUpPlan, previewText, catchUpSend, reviewForCatchUp } from "../lib/catchup.mjs";

const now = Date.parse("2026-11-21T18:00:00+05:30");
const H = 3600_000;
const claudeSays = (name, input) => { process.env.ANTHROPIC_API_KEY = "test"; globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: [{ type: "tool_use", name, input }] }) }); };
const chat = [{ from: "us", text: "May I have your number?", t: 1 }, { from: "customer", text: "8750300030 and 9953630749", t: 2 }, { from: "us", text: "A number simply helps our Founders reach you. No spam.", t: 3 }];

test("catch-up: who is looked at (agent-escalated chats yes; team, held, stopped, vendors, old chats no)", () => {
  assert.equal(catchUpEligible({ lastIn: now - 2 * H }, now).ok, true);
  assert.equal(catchUpEligible({ lastIn: now - 2 * H }, now).open, true);
  assert.equal(catchUpEligible({ lastIn: now - 30 * H }, now).open, false);
  assert.equal(catchUpEligible({ lastIn: now - 2 * H, esc: true }, now).ok, true); // the agent handed over and nobody on the team spoke: exactly the case
  assert.equal(catchUpEligible({}, now).ok, false);
  for (const c of [{ dnc: true }, { hold: true }, { skip: true }, { kind: "vendor" }, { humanSpoke: true }, { lastIn: now - 20 * 24 * H }, { lastIn: now - 2 * H, catchUpAt: now - H }])
    assert.equal(catchUpEligible({ lastIn: now - 2 * H, ...c }, now).ok, false, JSON.stringify(c));
});

test("catch-up: Claude reads the chat and writes a corrective message, prices and promises become the team's", async () => {
  claudeSays("send_message", { went_wrong: "She sent two numbers and we answered as if she refused", text: "Sorry for the mix-up, Paavni. Thank you for both numbers, our team will use them. Which city are you thinking of? 🌼" });
  const r = await reviewForCatchUp({ channel: "Instagram", name: "Paavni", history: chat });
  assert.equal(r.kind, "send");
  assert.match(r.text, /Sorry for the mix-up/);
  assert.match(r.wentWrong, /two numbers/);
  claudeSays("send_message", { went_wrong: "x", text: "The full planning package is ₹3.5 lakh" });
  assert.equal((await reviewForCatchUp({ history: chat })).kind, "team"); // a price in the draft is never sent
  claudeSays("flag_for_team", { why: "asks about date availability" });
  assert.deepEqual(await reviewForCatchUp({ history: chat }), { kind: "team", why: "asks about date availability" });
  claudeSays("leave_alone", { why: "they said no thanks" });
  assert.equal((await reviewForCatchUp({ history: chat })).kind, "leave");
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(await reviewForCatchUp({ history: chat }), null); // Claude not reachable: nothing is made up
});

test("catch-up: the plan covers both channels, skips ineligible chats and says what it could not read", async () => {
  claudeSays("send_message", { went_wrong: "asked the date twice", text: "Apologies for the repeat. Which city is the wedding in?" });
  const deps = {
    now: () => now,
    wa: async () => [{ id: "919999000001", name: "Asha", c: { lastIn: now - H } }, { id: "919999000002", name: "Team chat", c: { lastIn: now - H, humanSpoke: true } }],
    ig: async () => [{ id: "ig1", name: "@abhishek", c: { lastIn: now - 2 * H, username: "abhishek" } }, { id: "ig2", name: "@unreadable", c: { lastIn: now - 3 * H } }],
    read: async (channel, id) => (id === "ig2" ? null : chat),
  };
  const p = await catchUpPlan(deps);
  assert.deepEqual(p.items.map((i) => [i.channel, i.name, i.kind]), [["WhatsApp", "Asha", "send"], ["Instagram", "@abhishek", "send"], ["Instagram", "@unreadable", "unread"]]);
  assert.equal((await catchUpPlan(deps, { scope: "whatsapp" })).items.length, 1);
  const t = previewText(p);
  assert.match(t, /I would write to 2/);
  assert.match(t, /Apologies for the repeat/);
  assert.match(t, /Nothing is sent until then/);
  assert.match(previewText({ items: [] }), /nothing to put right/);
});

test("catch-up: send goes only to what was previewed, leaves out who the owner skips, and one failure does not stop the rest", async () => {
  const plan = { items: [
    { channel: "WhatsApp", id: "1", name: "Asha", kind: "send", text: "a", open: true },
    { channel: "Instagram", id: "2", name: "Riya", kind: "send", text: "b", open: true },
    { channel: "Instagram", id: "3", name: "Meera", kind: "send", text: "c", open: true },
    { channel: "WhatsApp", id: "4", name: "Team", kind: "team", why: "price" },
  ] };
  const sent = [], marked = [];
  const out = await catchUpSend(plan, { send: async (it) => { if (it.name === "Riya") throw new Error("window closed"); sent.push(it.name); return { ok: true }; }, mark: async (it) => marked.push(it.name) }, { skip: ["meera"] });
  assert.deepEqual(sent, ["Asha"]);
  assert.deepEqual(marked, ["Asha"]);
  assert.match(out, /Sent to 1/);
  assert.match(out, /Riya.*window closed/);
  assert.match(out, /Meera.*left out/);
});

test("catch-up: the owner command exists, always previews first, and every send is read and gated again", () => {
  const op = readFileSync(new URL("../lib/operator.mjs", import.meta.url), "utf8");
  const deps = readFileSync(new URL("../lib/operatordeps.mjs", import.meta.url), "utf8");
  assert.match(op, /toolDef\("catch_up"/);
  assert.match(op, /no fresh preview to send/);
  assert.match(deps, /they have written since the preview/);
  assert.match(deps, /purpose: "the owner approved a catch-up message/);
  assert.match(deps, /ownerDeps\.send\(it\.id, it\.text, \{ ordered: true \}\)/); // WhatsApp goes through contextCheck in send()
});
