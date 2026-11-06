import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { newState, advance, ASKS_US } from "../lib/qualify.mjs";
import { waStateAfterFinish } from "../lib/leadfields.mjs";
import { draftClarify, checkClarifyText } from "../lib/claude.mjs";

const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const TEMPLATE = "Thanks for reaching out to Saffron Collective on Instagram! \u{1F33C}\n\nHere is what we have noted so far:\nName: Devika sharma\nEvent: Wedding\nDate: 10th and 11th feb 2027\nLocation: Near jaipur\nService Required: Not provided\n\nWe would like a few more details before we can share a quote or some designs with you: what you need from us.\n\nCould you please reply here with them?";
const FIELDS = { occasion: "Wedding", date: "10th and 11th feb 2027", location: "Near jaipur", number: "+918696500000" };
const state = () => waStateAfterFinish(newState, FIELDS, [{ key: "requirement", label: "what you need from us" }]);
const HER = "Hi\nLet me know what details you need";

test("Devika: a lead who hands the question back is not giving an answer; nothing is saved from it", () => {
  assert.ok(ASKS_US.test(HER));
  for (const t of ["Tell me what you need", "what do you need from me", "Aap batao kya chahiye"]) assert.ok(ASKS_US.test(t), t);
  for (const t of ["Let me know the price", "Let me know what the quote includes", "Feb 10 and 11, let me know if you need anything else"]) assert.equal(ASKS_US.test(t), false, t);
  const r = advance(state(), HER, {}, "Devika");
  assert.equal(r.kind, "clarify");
  assert.equal(r.q.fields.requirement, undefined, "her sentence is not saved as what she is looking for");
  assert.equal(r.q.asked, "requirement", "the question still pending is the same one");
  assert.match(r.reply, /planning|decoration/i);
  assert.equal(advance(r.q, "tell me what you need", {}, "Devika").kind, "escalate", "a second time in a row goes to a person");
  // a message that gives a detail is an answer, even with the same words
  assert.notEqual(advance(state(), "Full planning please, let me know what else you need", { requirement: "Full planning" }, "Devika").kind, "clarify");
});

test("Devika: the clarification is written from what we sent, what we hold and what is still missing, and is checked", async () => {
  const keep = { key: process.env.ANTHROPIC_API_KEY, fetch: globalThis.fetch };
  const fixed = "FIXED";
  const history = [{ from: "us", text: TEMPLATE, t: 1 }, { from: "customer", text: HER, t: 2 }];
  const args = { text: HER, name: "Devika", history, fields: FIELDS, stage: "asking", asked: "requirement", pending: "Would you like help with full planning, decoration only, or both?", fixed };
  try {
    delete process.env.ANTHROPIC_API_KEY;
    assert.equal(await draftClarify(args), fixed, "no key: the plain rewording");
    process.env.ANTHROPIC_API_KEY = "test";
    let body;
    const good = "Thank you, Devika! We have your wedding noted for 10th and 11th February 2027 near Jaipur.\n\nThe one thing left is what you would like our help with: full planning, decoration only, or both? Then we can arrange a call with our Founders.";
    globalThis.fetch = async (_u, o) => { body = JSON.parse(o.body); return { ok: true, json: async () => ({ content: [{ text: good }] }) }; };
    assert.equal(await draftClarify(args), good);
    const sent = body.messages[0].content;
    assert.match(sent, /Service Required: Not provided/, "it is given what we sent her");
    assert.match(sent, /occasion: Wedding; date: 10th and 11th feb 2027; location: Near jaipur/, "and what we hold");
    assert.match(sent, /full planning, decoration only, or both/, "and the one thing still missing");
    assert.match(body.system, /arrange a call with our Founders/);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: [{ text: "Our packages start at 3.5 lakh, which one do you want?" }] }) });
    assert.equal(await draftClarify(args), fixed, "a price is never allowed");
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: [{ text: "Thanks! Is it a wedding?" }] }) });
    assert.equal(await draftClarify(args), fixed, "it must be about the pending question");
    globalThis.fetch = async () => { throw new Error("down"); };
    assert.equal(await draftClarify(args), fixed);
  } finally { process.env.ANTHROPIC_API_KEY = keep.key; if (keep.key === undefined) delete process.env.ANTHROPIC_API_KEY; globalThis.fetch = keep.fetch; }
  assert.ok(checkClarifyText("We just need to know whether you want full planning, decoration only or both. Which would you like?", { asked: "requirement" }));
  assert.equal(checkClarifyText("Share your city", { asked: "requirement" }), false);
  assert.ok(checkClarifyText("Above are your details. Is everything correct?", { stage: "confirm" }));
});

test("Devika: both handlers use it, and Claude is told that handing the question back means confused", () => {
  for (const f of ["netlify/functions/ig-process-background.mjs", "netlify/functions/wati-process-background.mjs"]) {
    assert.match(src(f), /if \(r\.kind === "clarify"\) r = \{ \.\.\.r, reply: await draftClarify\(/, f);
  }
  assert.match(src("lib/understand.mjs"), /hand the question back to us/);
});
