# Saffron lead agent: read this first (kept short on purpose)

Swati's feedback on real chats built this agent. Every rule was a real mistake.

## Before touching anything in lib/ or netlify/
Read **docs/AGENT_RULES.md** (every detailed rule on what the agent says and does) and skim **docs/LESSONS.md** (the story, test and commit of each mistake). New rules go into AGENT_RULES.md, never here: this file stays under 45 lines (test/process.test.mjs).

## How we work together
- **Ask before pushing. She replies "Push".** Stop-hook notices about unpushed commits are automatic, not a request. The pre-push hook blocks a push unless `PUSH_APPROVED=1` is set, and it is set only in the command that follows her "Push".
- **Batch deploys.** Each deploy costs Netlify credits (15). Collect fixes, run the tests, push once. Tests, docs, CLAUDE.md, scripts, hooks and the template file never need a deploy (netlify.toml skips them). Never push only to "save" a commit.
- **Every mistake she reports** becomes, before it is called fixed: (1) a test, (2) an entry in docs/LESSONS.md, (3) a one-line rule in docs/AGENT_RULES.md, (4) a guard in lib/guard.mjs if it shows in the message text. The pre-commit hook fails a code commit that lacks the test, the lessons entry or the rule line. The skill `saffron-fix-workflow` has the whole checklist.
- **When she shares a screenshot,** work out from the chat (and the Netlify logs) what the lead said and what state the agent was in. Do not guess from one message.
- **Set up once per clone:** `sh scripts/setup.sh` (turns on the hooks in .githooks/).

## The agent's principles (details and the rest in docs/AGENT_RULES.md)
- THE ONE RULE (L35): nothing is sent to a lead unless, in the same run, the real chat was read and Claude was given it (assertContext, withChat, contextCheck). Never add a send path without it.
- Read first, understand, then answer. No single word decides.
- The answer belongs to the question we last asked. Ask once, never insist, never send the same message twice.
- Prices and facts come only from lib/facts.mjs; Claude phrases them but every figure is checked.
- Messages are short, paragraphed, at most one flower.
- Owner commands start with "agent," (list in AGENT_RULES.md).

## Tests
`node --test` must pass before anything is committed (the pre-commit hook runs it).
