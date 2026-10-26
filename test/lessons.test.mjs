import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

// Every test title in test/ (single, double or backtick quoted).
const titles = readdirSync(new URL("test/", root)).filter((f) => f.endsWith(".test.mjs"))
  .flatMap((f) => [...read(`test/${f}`).matchAll(/^\s*test\(\s*(["'`])((?:\\.|(?!\1).)*)\1/gm)].map((m) => m[2]));

const lessons = read("docs/LESSONS.md").split(/^## /m).slice(1).filter((s) => /^L\d\d /.test(s)).map((block) => {
  const get = (k) => [...block.matchAll(new RegExp(`^- ${k}: (.+)$`, "gm"))].map((m) => m[1].trim());
  return { id: block.slice(0, 3), title: block.split("\n")[0], tests: get("Test"), commits: get("Commit"), guards: get("Guard"), rule: get("Rule"), went: get("Went wrong"), chat: get("Chat"), date: get("Date") };
});

test("the lessons file has entries, and each one is complete", () => {
  assert.ok(lessons.length >= 20, `only ${lessons.length} lessons`);
  const ids = lessons.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate lesson numbers");
  for (const l of lessons) {
    assert.equal(l.date.length, 1, `${l.id}: needs one Date`);
    assert.match(l.date[0], /^\d{4}-\d{2}-\d{2}$/, `${l.id}: Date must be YYYY-MM-DD`);
    for (const k of ["chat", "went", "rule"]) assert.ok(l[k].length === 1 && l[k][0].length > (k === "chat" ? 3 : 10), `${l.id}: needs a ${k} line`);
    assert.ok(l.tests.length >= 1, `${l.id} (${l.title}): a lesson without a test is not fixed`);
    assert.ok(l.commits.length === 1, `${l.id}: needs one Commit`);
  }
});

test("every lesson points to a real test", () => {
  for (const l of lessons) for (const t of l.tests) {
    assert.ok(titles.some((title) => title.includes(t)), `${l.id}: no test has "${t}" in its title`);
  }
});

test("every lesson names a commit that exists", { skip: !existsSync(new URL(".git", root)) }, () => {
  for (const l of lessons) {
    const c = l.commits[0];
    assert.match(c, /^[0-9a-f]{7,40}$/, `${l.id}: bad commit "${c}"`);
    try { execSync(`git cat-file -e ${c}^{commit}`, { cwd: new URL(".", root), stdio: "ignore" }); }
    catch { assert.fail(`${l.id}: commit ${c} not found`); }
  }
});

test("every guard a lesson names is implemented in lib/guard.mjs or lib/understand.mjs", () => {
  const src = read("lib/guard.mjs") + read("lib/understand.mjs");
  for (const l of lessons) for (const g of l.guards) {
    const code = g.split(" ")[0];
    assert.ok(src.includes(code) || /oneEmoji/.test(g), `${l.id}: guard "${g}" not found in the code`);
  }
});

test("CLAUDE.md points to the lessons file", () => {
  assert.match(read("CLAUDE.md"), /docs\/LESSONS\.md/);
});
