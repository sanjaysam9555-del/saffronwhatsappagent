import test from "node:test";
import assert from "node:assert/strict";

process.env.VENDOR_SIGNUP_URL = "https://example.test/vendor-signup";
process.env.ANTHROPIC_API_KEY = "test";
process.env.OWNER_NUMBER = "+91 98100 00001";
process.env.TEAM_ALERT_NUMBER = "919310400859";
const op = await import("../lib/operator.mjs");
const { superviseOnce, needsReview } = await import("../lib/supervisor.mjs");

// Make Claude "call" one tool.
const withTool = async (name, input, fn) => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: [{ type: "tool_use", name, input }] }) });
  try { return await fn(); } finally { globalThis.fetch = real; }
};

test("safeReply blocks money, promises, strange links, empty and long text", () => {
  assert.equal(op.safeReply("Decor starts at ₹5 lakhs").ok, false);
  assert.equal(op.safeReply("We guarantee the date").ok, false);
  assert.equal(op.safeReply("See https://evil.test/x").ok, false);
  assert.equal(op.safeReply("").ok, false);
  assert.equal(op.safeReply("a".repeat(800)).ok, false);
  assert.equal(op.safeReply("Happy to help! See https://saffroncollective.in/decor").ok, true);
  assert.equal(op.safeReply("Sign up: https://example.test/vendor-signup").ok, true);
});

test("isOwner matches the owner and team numbers in any format", () => {
  assert.ok(op.isOwner("919810000001"));
  assert.ok(op.isOwner("+91 93104 00859"));
  assert.ok(!op.isOwner("919999999999"));
  assert.ok(!op.isOwner(""));
  assert.ok(op.COMMAND_PREFIX.test("Agent, resend the link"));
  assert.ok(!op.COMMAND_PREFIX.test("Hello agent"));
});

test("routeMessage: vendor, reply, handover and failure", async () => {
  const v = await withTool("send_vendor_welcome", { name: "Tanmay 123", business: "Q Luxury Rentals" }, () => op.routeMessage({ channel: "WhatsApp", text: "We rent furniture" }));
  assert.deepEqual(v, { kind: "vendor", name: "Tanmay", business: "Q Luxury Rentals" });
  const r = await withTool("reply", { text: "Thank you! Could you tell me your city?" }, () => op.routeMessage({ channel: "WhatsApp", text: "hi" }));
  assert.equal(r.kind, "reply");
  const bad = await withTool("reply", { text: "Packages start at ₹10 lakhs" }, () => op.routeMessage({ channel: "WhatsApp", text: "price?" }));
  assert.equal(bad.kind, "handover");
  const h = await withTool("hand_to_team", { reason: "complaint", hold_text: "I am sorry about this. Our team will look into it today." }, () => op.routeMessage({ channel: "WhatsApp", text: "bad service" }));
  assert.equal(h.kind, "handover");
  assert.equal(h.reason, "complaint");
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 401 });
  try { assert.equal(await op.routeMessage({ channel: "WhatsApp", text: "hi" }), null); } finally { globalThis.fetch = real; }
});

const deps = (over = {}) => {
  const sent = [];
  return { sent, find: async () => [{ waId: "919800610063", name: "Tanmay" }], history: async () => [{ from: "customer", text: "hello" }], send: async (w, t) => { sent.push([w, t]); }, setFlags: async () => {}, windowClosed: async () => false, ...over };
};

test("ownerCommand sends the vendor link to the named contact", async () => {
  const d = deps();
  const out = await withTool("send_vendor_link", { to: "Tanmay" }, () => op.ownerCommand({ text: "agent, resend the vendor link to Tanmay", deps: d }));
  assert.equal(d.sent.length, 1);
  assert.match(d.sent[0][1], /^Hello Tanmay!/);
  assert.match(d.sent[0][1], /example\.test\/vendor-signup/);
  assert.match(out, /^Sent to Tanmay/);
});

test("ownerCommand: ambiguous, missing, closed window and unsafe text send nothing", async () => {
  let d = deps({ find: async () => [{ waId: "1", name: "A" }, { waId: "2", name: "B" }] });
  assert.match(await withTool("send_vendor_link", { to: "A" }, () => op.ownerCommand({ text: "agent x", deps: d })), /More than one match/);
  assert.equal(d.sent.length, 0);
  d = deps({ find: async () => [] });
  assert.match(await withTool("send_vendor_link", { to: "Z" }, () => op.ownerCommand({ text: "agent x", deps: d })), /could not find/);
  d = deps({ windowClosed: async () => true });
  assert.match(await withTool("send_vendor_link", { to: "Tanmay" }, () => op.ownerCommand({ text: "agent x", deps: d })), /24-hour/);
  assert.equal(d.sent.length, 0);
  d = deps();
  assert.match(await withTool("send_message", { to: "Tanmay", text: "We will give 20% discount" }, () => op.ownerCommand({ text: "agent x", deps: d })), /safety rule/);
  assert.equal(d.sent.length, 0);
});

test("supervisor picks only unanswered chats inside the window", () => {
  const now = Date.now();
  assert.ok(needsReview({ lastIn: now - 40 * 60_000 }, now));
  assert.ok(!needsReview({ lastIn: now - 5 * 60_000 }, now)); // too fresh
  assert.ok(!needsReview({ lastIn: now - 23 * 3600_000 }, now)); // window closing
  assert.ok(!needsReview({ lastIn: now - 40 * 60_000, lastOut: now - 30 * 60_000 }, now)); // answered
  assert.ok(!needsReview({ lastIn: now - 40 * 60_000, dnc: true }, now));
  assert.ok(!needsReview({ lastIn: now - 40 * 60_000, supervisedAt: now - 40 * 60_000 }, now)); // already reviewed
});

const sdeps = (c, over = {}) => {
  const log = { sent: [], team: [], saved: [] };
  return { log, contacts: async () => [["919800610063", c]], history: async () => [{ from: "customer", text: "I'm Tanmay from Q Luxury Rentals" }], send: async (w, t) => log.sent.push(t), save: async (w, p) => log.saved.push(p), logTeam: async (o) => log.team.push(o.reason), count: async () => {}, allowed: () => true, ...over };
};

test("supervisor sends a vendor link, flags unclear chats, and never answers handed-over chats", async () => {
  const c = { lastIn: Date.now() - 40 * 60_000, name: "Tanmay" };
  let d = sdeps(c);
  let res = await withTool("send_vendor_welcome", { name: "Tanmay", business: "QLR" }, () => superviseOnce(d));
  assert.equal(res.sent, 1);
  assert.match(d.log.sent[0], /vendor-signup/);
  assert.deepEqual(d.log.team, ["supervisor-sent"]);
  d = sdeps(c);
  res = await withTool("flag_for_team", { why: "wants a refund" }, () => superviseOnce(d));
  assert.equal(res.flagged, 1);
  assert.equal(d.log.sent.length, 0);
  d = sdeps({ ...c, esc: true });
  res = await withTool("reply", { text: "Thank you, noted!" }, () => superviseOnce(d));
  assert.equal(d.log.sent.length, 0); // the team has this chat
  assert.equal(res.flagged, 1);
  d = sdeps(c, { history: async () => [{ from: "customer", text: "a" }, { from: "us", text: "b" }] });
  res = await superviseOnce(d);
  assert.equal(res.looked, 0); // someone already answered
});

test("Instagram history: finds the chat by username, labels sides, drops the message being answered, never throws", async () => {
  const { getInstagramHistory, withoutCurrent } = await import("../lib/igapi.mjs");
  process.env.INSTAGRAM_ACCESS_TOKEN = "t";
  const real = globalThis.fetch;
  const msgs = { m3: { id: "m3", message: "Jaipur", from: { id: "555" } }, m2: { id: "m2", message: "Lovely! Which city?", from: { id: "999" } }, m1: { id: "m1", message: "Hi, need decor", from: { id: "555" } } };
  globalThis.fetch = async (url) => {
    const u = String(url);
    const json = (b) => ({ ok: true, json: async () => b });
    if (u.includes("/me/conversations")) return json({ data: [{ id: "c0", participants: { data: [{ id: "999", username: "us" }, { id: "111", username: "someone" }] } }, { id: "c1", participants: { data: [{ id: "999", username: "us" }, { id: "555", username: "Riya_Shah" }] } }] });
    if (u.includes("/c1")) return json({ messages: { data: [{ id: "m3" }, { id: "m2" }, { id: "m1" }] } });
    return json(msgs[u.match(/\/(m\d)\?/)?.[1]]);
  };
  try {
    const h = await getInstagramHistory({ username: "@riya_shah" });
    assert.deepEqual(h.map((m) => m.from), ["customer", "us", "customer"]);
    assert.equal(h[0].text, "Hi, need decor");
    assert.deepEqual(withoutCurrent(h, "Jaipur").map((m) => m.text), ["Hi, need decor", "Lovely! Which city?"]);
    assert.equal(await getInstagramHistory({ username: "nobody" }), null);
    globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 100, message: "bad" } }) });
    assert.equal(await getInstagramHistory({ username: "riya_shah" }), null);
    globalThis.fetch = async () => { throw new Error("down"); };
    assert.equal(await getInstagramHistory({ username: "riya_shah" }), null);
    assert.equal(await getInstagramHistory({}), null);
  } finally { globalThis.fetch = real; delete process.env.INSTAGRAM_ACCESS_TOKEN; }
});

test("callTools lets Claude choose the tool (this model rejects a forced choice)", async () => {
  const real = globalThis.fetch;
  let seen = "";
  globalThis.fetch = async (url, init) => { seen = JSON.parse(init.body).tool_choice.type; return { ok: true, status: 200, json: async () => ({ content: [{ type: "tool_use", name: "stay_quiet", input: { why: "x" } }] }) }; };
  try {
    const r = await op.routeMessage({ channel: "WhatsApp", text: "ok" });
    assert.equal(r.kind, "quiet");
    assert.equal(seen, "auto");
  } finally { globalThis.fetch = real; }
});

test("Instagram: a message ManyChat could not read is recovered from Meta only when fresh, from the lead and the newest", async () => {
  const { getLatestCustomerText } = await import("../lib/igapi.mjs");
  process.env.INSTAGRAM_ACCESS_TOKEN = "t";
  const real = globalThis.fetch;
  const setup = (msg) => { globalThis.fetch = async (url) => {
    const u = String(url), json = (b) => ({ ok: true, json: async () => b });
    if (u.includes("/me/conversations")) return json({ data: [{ id: "c1", participants: { data: [{ id: "999", username: "us" }, { id: "555", username: "riya_shah" }] } }] });
    if (u.includes("/c1")) return json({ messages: { data: [{ id: "m9" }, { id: "m8" }] } });
    return json(msg);
  }; };
  const iso = (ms) => new Date(ms).toISOString().replace("Z", "+0000"); // Meta's time format
  try {
    setup({ id: "m9", message: "9555879555", from: { id: "555" }, created_time: iso(Date.now() - 20_000) });
    assert.equal(await getLatestCustomerText({ username: "riya_shah", tries: 1 }), "9555879555");
    setup({ id: "m9", message: "9555879555", from: { id: "555" }, created_time: iso(Date.now() - 20 * 60_000) });
    assert.equal(await getLatestCustomerText({ username: "riya_shah", tries: 1 }), ""); // too old
    setup({ id: "m9", message: "Thanks!", from: { id: "999" }, created_time: iso(Date.now() - 5_000) });
    assert.equal(await getLatestCustomerText({ username: "riya_shah", tries: 1 }), ""); // our own message
    setup({ id: "m9", from: { id: "555" }, created_time: iso(Date.now() - 5_000) });
    assert.equal(await getLatestCustomerText({ username: "riya_shah", tries: 1 }), ""); // a photo: no text, never reuse an older one
    assert.equal(await getLatestCustomerText({}), "");
  } finally { globalThis.fetch = real; delete process.env.INSTAGRAM_ACCESS_TOKEN; }
});

test("a number that arrives as an unreadable phone card is accepted and the chat moves on", async () => {
  const { newState, advance, numberInChat } = await import("../lib/qualify.mjs");
  let q = newState({}, "Instagram", "instagram");
  q = advance(q, "Hi I need wedding planning", {}, "Riya").q; // first turn: asks for the number
  assert.equal(q.asked, "number");
  const r = numberInChat(q, "Riya");
  assert.equal(r.q.fields.number, "Shared in this chat");
  assert.equal(r.q.numCard, true);
  assert.match(r.reply, /noted your number/);
  assert.ok(!/mobile number/.test(r.reply)); // does not ask for it again
  assert.notEqual(r.q.asked, "number");
});

test("a number that arrived as a phone card is found in the real chat", async () => {
  const { findNumberInChat } = await import("../lib/igapi.mjs");
  process.env.INSTAGRAM_ACCESS_TOKEN = "t";
  const real = globalThis.fetch;
  const msgs = { m3: { id: "m3", message: "9555879555", from: { id: "555" } }, m2: { id: "m2", message: "May I have your mobile number?", from: { id: "999" } }, m1: { id: "m1", message: "Hi, need decor", from: { id: "555" } } };
  globalThis.fetch = async (url) => {
    const u = String(url), json = (b) => ({ ok: true, json: async () => b });
    if (u.includes("/me/conversations")) return json({ data: [{ id: "c1", participants: { data: [{ id: "999", username: "us" }, { id: "555", username: "riya_shah" }] } }] });
    if (u.includes("/c1")) return json({ messages: { data: [{ id: "m3" }, { id: "m2" }, { id: "m1" }] } });
    return json(msgs[u.match(/\/(m\d)\?/)?.[1]]);
  };
  try {
    assert.equal(await findNumberInChat({ username: "riya_shah" }), "+919555879555");
    assert.equal(await findNumberInChat({ username: "nobody" }), null); // chat not found: unknown, not "no number"
    globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({}) });
    assert.equal(await findNumberInChat({ username: "riya_shah" }), null); // could not read: unknown
    msgs.m3.message = "no number here"; // the chat is readable and holds no number
    globalThis.fetch = async (url) => {
      const u = String(url), json = (b) => ({ ok: true, json: async () => b });
      if (u.includes("/me/conversations")) return json({ data: [{ id: "c1", participants: { data: [{ id: "999", username: "us" }, { id: "555", username: "riya_shah" }] } }] });
      if (u.includes("/c1")) return json({ messages: { data: [{ id: "m3" }, { id: "m2" }, { id: "m1" }] } });
      return json(msgs[u.match(/\/(m\d)\?/)?.[1]]);
    };
    assert.equal(await findNumberInChat({ username: "riya_shah" }), ""); // read, nothing found
  } finally { globalThis.fetch = real; delete process.env.INSTAGRAM_ACCESS_TOKEN; }
});

test("a number marked Pending from a card gets the one gentle ask in the summary", async () => {
  const { newState, advance } = await import("../lib/qualify.mjs");
  let q = newState({}, "Instagram", "instagram");
  q = advance(q, "Hi I need decor", {}, "Riya").q;
  q = { ...q, numCard: true, fields: { ...q.fields, number: "Pending" } };
  let last;
  for (const [k, v] of [["requirement", "Decor"], ["date", "March 2027"], ["venue", "Jaipur"], ["guests", "300"]]) {
    last = advance(q, v, { [k]: v }, "Riya"); q = last.q;
  }
  for (let i = 0; i < 6 && last.kind !== "summary"; i++) { last = advance(q, "ok", {}, "Riya"); q = last.q; }
  assert.equal(last.kind, "summary");
  assert.match(last.reply, /share your mobile number here/);
});

test("when we cannot tell what they want, the fixed welcome asks how we can help", async () => {
  const { greetingText, refOpen } = await import("../lib/media.mjs");
  const act = await withTool("ask_how_to_help", {}, () => op.routeMessage({ channel: "Instagram", profileName: "Kritika Suri", text: "Hey how can I connect", history: [], state: {} }));
  assert.deepEqual(act, { kind: "open" });
  assert.equal(greetingText("Kritika"), "Hi Kritika!\n\nWelcome to Saffron Collective. 🌼\n\nHow can we help you?");
  assert.equal(greetingText(""), "Hi!\n\nWelcome to Saffron Collective. 🌼\n\nHow can we help you?");
  assert.match(refOpen("Kritika"), /^Hi Kritika!\n\nWelcome to Saffron Collective\. 🌼\n\n/);
});

test("two quick messages from one chat are handled one at a time, and the second knows it had to wait", async () => {
  const { acquireLock } = await import("../lib/lock.mjs");
  const mem = new Map();
  const store = { get: async (k) => mem.get(k), setJSON: async (k, v) => { mem.set(k, v); }, delete: async (k) => { mem.delete(k); } };
  const fast = { store, settleMs: 5, pollMs: 10, waitMs: 2000 };
  const order = [];
  const run = async (name, ms) => {
    const l = await acquireLock("ig:1", fast);
    order.push(`${name}:start:${l.waited ? "waited" : "first"}`);
    await new Promise((r) => setTimeout(r, ms));
    order.push(`${name}:end`);
    await l.release();
  };
  const a = run("A", 120);
  await new Promise((r) => setTimeout(r, 30));
  const b = run("B", 10);
  await Promise.all([a, b]);
  assert.deepEqual(order, ["A:start:first", "A:end", "B:start:waited", "B:end"]); // B never starts while A is working
  assert.equal(mem.size, 0); // the lock is released
  // a different chat is never held up
  const l1 = await acquireLock("ig:1", fast); const l2 = await acquireLock("ig:2", fast);
  assert.equal(l1.waited, false); assert.equal(l2.waited, false);
  await l1.release(); await l2.release();
  // a lock left behind by a crashed run expires
  mem.set("lock:ig:3", { token: "old", t: Date.now() - 200_000 });
  assert.equal((await acquireLock("ig:3", fast)).waited, false);
  // if the store is broken the message is still handled
  const broken = { get: async () => { throw new Error("down"); } };
  assert.equal((await acquireLock("ig:4", { store: broken })).waited, false);
});
