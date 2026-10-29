import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { checkCommit, checkPush } from "../scripts/process-check.mjs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("process: a change to the agent needs a test, a lessons entry and a rule line in the same commit", () => {
  assert.equal(checkCommit(["docs/LESSONS.md", "CLAUDE.md", "README.md", "wati-templates.json"]).ok, true, "docs and templates alone need no lessons entry");
  const code = checkCommit(["lib/qualify.mjs"]);
  assert.equal(code.ok, false);
  assert.equal(code.problems.length, 3);
  assert.equal(checkCommit(["netlify/functions/x.mjs", "test/x.test.mjs", "docs/LESSONS.md"]).ok, false, "the rule line is missing");
  assert.equal(checkCommit(["lib/facts.mjs", "test/budget.test.mjs", "docs/LESSONS.md", "docs/AGENT_RULES.md"]).ok, true);
  assert.equal(checkCommit(["lib/facts.mjs"], { NO_LESSON: "1" }).ok, true, "explicit escape for refactors");
});

test("process: nothing is pushed until Swati has said Push", () => {
  assert.equal(checkPush({}).ok, false);
  assert.match(checkPush({}).problems[0], /Swati has not said/);
  assert.equal(checkPush({ PUSH_APPROVED: "1" }).ok, true);
});

test("process: the hooks exist, are executable and are switched on by scripts/setup.sh", () => {
  for (const h of ["pre-commit", "pre-push"]) {
    assert.ok(existsSync(new URL(`../.githooks/${h}`, import.meta.url)), h);
    assert.ok(statSync(new URL(`../.githooks/${h}`, import.meta.url)).mode & 0o100, `${h} must be executable`);
    assert.match(read(`.githooks/${h}`), /process-check\.mjs (commit|push)/);
  }
  assert.match(read("scripts/setup.sh"), /core\.hooksPath \.githooks/);
});

test("process: CLAUDE.md stays short; the detailed rules live in docs/AGENT_RULES.md", () => {
  const claude = read("CLAUDE.md");
  assert.ok(claude.trimEnd().split("\n").length <= 45, "CLAUDE.md grew past 45 lines: move rules to docs/AGENT_RULES.md");
  assert.match(claude, /docs\/AGENT_RULES\.md/);
  assert.match(claude, /docs\/LESSONS\.md/);
  assert.match(claude, /Ask before pushing/);
  const rules = read("docs/AGENT_RULES.md");
  for (const key of ["THE ONE RULE", "dropAnswered", "resumeOnNumber", "BUDGET_FACTS", "lastInKey", "inclusionsAnswer", "Owner commands"]) assert.ok(rules.includes(key), `AGENT_RULES.md lost a rule: ${key}`);
});
