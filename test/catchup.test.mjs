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

test("Swati: Radhika gets the published inclusions with the website link and a call offer, never Claude's own description of planning", async () => {
  const { inclusionsAnswer } = await import("../lib/facts.mjs");
  claudeSays("send_inclusions", { went_wrong: "She asked what full planning includes and got a hold message", apology: "Sorry for the generic reply, Radhika.", which: "full" });
  const r = await reviewForCatchUp({ channel: "Instagram", name: "Radhika", history: chat });
  assert.equal(r.kind, "send");
  assert.match(r.text, /^Sorry for the generic reply, Radhika\./);
  assert.ok(r.text.includes(inclusionsAnswer("full planning").split("\n\n")[0])); // the website's own words for the tier
  assert.match(r.text, /https:\/\/saffroncollective\.in\/pricing/);
  assert.match(r.text, /how each planning option differs/);
  assert.match(r.text, /Would you like more details\? Just let us know/);
  claudeSays("send_inclusions", { went_wrong: "x", apology: "Sorry!", which: "all" });
  const all = await reviewForCatchUp({ history: chat });
  assert.match(all.text, /Partial Planning/); assert.match(all.text, /Wedding Day Coordination/);
});

test("Swati: a package request without a kind gets the clarifying question, in catch-up and in the live agent, even after a call is booked", async () => {
  const { isPackageAsk, PACKAGE_CLARIFY } = await import("../lib/facts.mjs");
  for (const t of ["Can you send the package details?", "Please share packages", "Package details before our call on Friday", "What is the cost?", "what is the price of the package?", "How much for packages", "please send me the details", "Need the amount and details", "pls share details"]) assert.equal(isPackageAsk(t), true, t);
  // a named service gets the published answer; a total-budget question, an amount, money words, or the lead's own details are something else
  for (const t of ["full planning package", "decor package please", "What is the price for partial planning?", "What does full planning include?", "I will share my details", "Please share your contact details", "budget is 40 lakh, what is the cost?", "what is the advance payment", "Hello", "We are looking for a Rishikesh wedding"]) assert.equal(isPackageAsk(t), false, t);
  assert.match(PACKAGE_CLARIFY, /entire wedding, a décor package, or a planning package/);
  assert.match(PACKAGE_CLARIFY, /what details you need/);
  claudeSays("send_package_question", { went_wrong: "She asked twice for package details and got a hold message", apology: "Sorry for the wait, Hansika." });
  const r = await reviewForCatchUp({ channel: "Instagram", name: "Hansika", history: chat });
  assert.equal(r.kind, "send");
  assert.equal(r.text, `Sorry for the wait, Hansika.\n\n${PACKAGE_CLARIFY}`);
  for (const f of ["ig-process-background", "wati-process-background"]) {
    const src = readFileSync(new URL(`../netlify/functions/${f}.mjs`, import.meta.url), "utf8");
    assert.match(src, /const packageQ = !inclQ && !hardMoney\(text\) && !budgetQuestionKind\(text\) && budgetLakhs\(text\) === null && \(isPackageAsk\(text\) \|\| read0\?\.asksPackage === true\)/);
    assert.match(src, /packageQ && \(await allow\(/); // the finished chat (call booked)
    assert.match(src, /packageQ && \["confirm", "call"\]/); // after the summary
    assert.match(src, /packageQ \? PACKAGE_CLARIFY : priceQ \? priceAnswer\(text\)/); // while the questions are asked
  }
});

test("Swati: Niraj, who keeps asking for a call at his own time, is asked to choose one of the offered slots", async () => {
  const { STRICT_TIMELINE } = await import("../lib/catchup.mjs");
  claudeSays("send_call_slot_reminder", { went_wrong: "He keeps asking for a call right now; we only repeat the slots", first_name: "Niraj" });
  const r = await reviewForCatchUp({ channel: "Instagram", name: "Niraj", history: chat });
  assert.equal(r.kind, "send");
  assert.equal(r.text, `Niraj, ${STRICT_TIMELINE}`);
  assert.match(r.text, /strict timeline/); assert.match(r.text, /one of the time slots offered/);
  claudeSays("send_call_slot_reminder", { went_wrong: "x" });
  assert.match((await reviewForCatchUp({ history: chat })).text, /^Our team works to a strict timeline/); // no name: no guess
});

test("Swati: Claude's reading of the chat also decides whether a general cost, price or details ask needs the package question", async () => {
  const u = await import("../lib/understand.mjs");
  assert.equal(u.normalizeRead({ intent: "question", asks_package: true }).asksPackage, true);
  assert.equal(u.normalizeRead({ intent: "question", asks_package: "yes" }).asksPackage, false);
  assert.equal(u.normalizeRead({ intent: "other" }).asksPackage, false);
  assert.match(u.READ_SYSTEM, /asks_package/);
});
