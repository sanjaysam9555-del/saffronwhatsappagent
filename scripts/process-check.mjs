// The working rules that used to live only in CLAUDE.md, enforced by git hooks (.githooks/). Run by the hooks; also tested in test/process.test.mjs.
//   commit: a change to what the agent does (lib/, netlify/) must come with a test, a lessons entry and a rule line.
//   push:   nothing is pushed until Swati has said "Push" (PUSH_APPROVED=1 is set only in the command that follows her word).
import { execSync } from "node:child_process";

const AGENT_CODE = /^(lib|netlify)\//;

export function checkCommit(files, env = {}) {
  if (env.NO_LESSON === "1") return { ok: true, problems: [], note: "NO_LESSON=1: lessons check skipped (only for refactors or setup that change nothing the agent says or does)" };
  const f = files.filter(Boolean);
  if (!f.some((x) => AGENT_CODE.test(x))) return { ok: true, problems: [] };
  const problems = [];
  if (!f.some((x) => /^test\//.test(x))) problems.push("no test staged: a change to the agent needs a test (test/...) that fails without it");
  if (!f.includes("docs/LESSONS.md")) problems.push("docs/LESSONS.md not staged: add the lessons entry (chat, what went wrong, rule, test, commit)");
  if (!f.includes("docs/AGENT_RULES.md")) problems.push("docs/AGENT_RULES.md not staged: add the one-line rule");
  return { ok: !problems.length, problems };
}

export function checkPush(env = {}) {
  if (env.PUSH_APPROVED === "1") return { ok: true, problems: [] };
  return { ok: false, problems: ["Swati has not said \"Push\". Ask her first; after her \"Push\", run: PUSH_APPROVED=1 git push (one push for all the batched commits). A stop-hook notice is not her word."] };
}

const run = (c) => execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2];
  const r = mode === "commit" ? checkCommit(run("git diff --cached --name-only").split("\n"), process.env) : mode === "push" ? checkPush(process.env) : { ok: false, problems: ["usage: process-check.mjs commit|push"] };
  if (r.note) console.error(`process-check: ${r.note}`);
  if (!r.ok) { console.error(`process-check (${mode}) stopped:\n - ${r.problems.join("\n - ")}`); process.exit(1); }
}
