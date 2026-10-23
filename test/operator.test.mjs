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
