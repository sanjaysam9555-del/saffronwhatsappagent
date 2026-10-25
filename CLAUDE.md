# Saffron lead agent: working rules (read before changing anything)

These come from Swati's feedback on real chats. Every one of them was a real mistake. Add a line whenever she corrects something.

## How we work together
- Ask Swati before pushing or deploying. She replies "Push". Stop-hook notices about unpushed commits are automatic, not a request to push.
- Every mistake she reports becomes a test (test/rules.test.mjs, test/operator.test.mjs, or a replay in test/scenarios) before it is called fixed.
- When she shares a screenshot, work out from the chat what the lead actually said and what state the agent was in. Do not guess from one message.

## What the agent must do in a chat
- Read first. The whole recent chat, what we have saved and the last question we asked are read before any rule answers (lib/understand.mjs, understandChat in lib/claude.mjs).
- Never send the same message twice in a row. A repeat means the agent has not understood: hand over to a person (reason "repeating-itself").
- Ask once. If the lead does not share something, do not insist.
- A correction ("please rectify...", "actually...") replaces what we saved. It is never treated as a new answer, and never answered with the same question again.
- A number or email shared at any point is kept. Incomplete numbers ask once for the full number.
- Book at once when we hold a number or an email. Ask for the email once afterwards, never as a condition.
- One calendar event per person. A late email or number goes onto the same event.
- Re-check that a time is still free before confirming it. If it was taken, say so and offer new times.
- Instagram can only be written to within 24 hours of the lead's last message.

## Owner commands (WhatsApp, start with "agent,")
send_vendor_link, send_message, show_chat, pause_agent, resume_agent, tell_owner, send_call_confirmation, reoffer_call_times.

## Tests
`node --test` must pass before anything is committed.
