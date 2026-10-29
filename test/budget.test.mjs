import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { budgetQuestionKind, checkBudgetText, budgetFallback, BUDGET_BRIDGE, BUDGET_FACTS } from "../lib/facts.mjs";
import { draftBudgetAnswer } from "../lib/claude.mjs";

const RAJLAKSHMI = "Hi, what's your starting budget for end to end wedding planning, inclusive of all costs involved";
const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("budget: Rajlakshmi's question is a question about the total cost, our fee question is not", () => {
  assert.equal(budgetQuestionKind(RAJLAKSHMI), "total");
  assert.equal(budgetQuestionKind("how much does a wedding cost with you"), "total");
  assert.equal(budgetQuestionKind("Can you do it in 25 lakh?"), "within");
  assert.equal(budgetQuestionKind("What are your planning fees?"), "");
  assert.equal(budgetQuestionKind("price for full wedding planning"), "");
  assert.equal(budgetQuestionKind("my budget is 25 lakh"), ""); // an answer to our question, not a question
});

test("budget: the fixed text passes its own check, gives the context first, and never says 'over' or 'under' budget", () => {
  const t = budgetFallback("total");
  assert.ok(checkBudgetText(t));
  assert.match(t, /3\.5 lakh/);
  assert.match(t, /30 lakh for 100 guests/);
  assert.match(t, /60 lakh for 250 guests/);
  assert.match(t, /40% less/);
  assert.doesNotMatch(t, /under budget|over budget|discount/i);
  assert.match(budgetFallback("within"), /entirely depends on your preferences/);
  assert.ok(checkBudgetText(budgetFallback("within")));
});

test("budget: Claude's wording may only use the figures it was given", () => {
  assert.ok(checkBudgetText("Our fee starts at ₹3.5 lakh. A whole wedding can be about ₹30 lakh for 100 guests, up to ₹60 lakh for 250 guests."));
  for (const bad of [
    "It can start from 45 lakh for 100 guests.",
    "We can give you a 10% discount.",
    "Around ₹5,00,000 more.",
    "A wedding for 150 guests is about 40 lakh.",
    "We guarantee the best price.",
    "Would you like a call?",
    "See https://saffroncollective.in/pricing",
    "",
  ]) assert.equal(checkBudgetText(bad), false, bad);
});

test("budget: no key, a failed call or a bad answer sends the fixed text, and the walk-through invitation comes after the context", async () => {
  const keep = { key: process.env.ANTHROPIC_API_KEY, fetch: globalThis.fetch };
  try {
    delete process.env.ANTHROPIC_API_KEY;
    const a = await draftBudgetAnswer({ text: RAJLAKSHMI, name: "Rajlakshmi", kind: "total" });
    assert.ok(a.startsWith(budgetFallback("total")) && a.endsWith(BUDGET_BRIDGE));
    process.env.ANTHROPIC_API_KEY = "test";
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: [{ text: "We can offer a 20% discount on everything." }] }) });
    const b = await draftBudgetAnswer({ text: RAJLAKSHMI, name: "Rajlakshmi", kind: "total" });
    assert.ok(b.startsWith(budgetFallback("total")), "a reply with a discount is replaced by the fixed text");
    const good = "Our planning fee starts at ₹3.5 lakh, and the wedding budget is entirely yours to shape.\n\nAs an idea, a wedding can be about ₹30 lakh for 100 guests and up to ₹60 lakh for 250 guests.";
    globalThis.fetch = async (_u, o) => { assert.match(JSON.parse(o.body).system, /ONLY these facts/); return { ok: true, json: async () => ({ content: [{ text: good }] }) }; };
    const c = await draftBudgetAnswer({ text: RAJLAKSHMI, name: "Rajlakshmi", kind: "total" });
    assert.equal(c, `${good}\n\n${BUDGET_BRIDGE}`);
    globalThis.fetch = async () => { throw new Error("down"); };
    assert.ok((await draftBudgetAnswer({ text: RAJLAKSHMI, kind: "within" })).startsWith("We can certainly get it done"));
  } finally { process.env.ANTHROPIC_API_KEY = keep.key; if (keep.key === undefined) delete process.env.ANTHROPIC_API_KEY; globalThis.fetch = keep.fetch; }
});

test("budget: both handlers answer a total-cost question through Claude, before the next question, and ahead of the fee list", () => {
  for (const f of ["netlify/functions/ig-process-background.mjs", "netlify/functions/wati-process-background.mjs"]) {
    const s = src(f);
    assert.match(s, /budgetQuestionKind\(text\)/, f);
    assert.match(s, /totalKind \? await draftBudgetAnswer\(/, f);
    assert.ok(s.indexOf("totalKind ? await draftBudgetAnswer") < s.indexOf("priceQ ? priceAnswer(text)"), `${f}: the total-cost answer is chosen before the fee list`);
  }
  assert.match(BUDGET_FACTS, /never a percentage/);
});
