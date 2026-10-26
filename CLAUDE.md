# Saffron lead agent: working rules (read before changing anything)

These come from Swati's feedback on real chats. Every one of them was a real mistake. Add a line whenever she corrects something.

The full story of each mistake (the chat, what went wrong, the rule, the test, the commit) is in docs/LESSONS.md. Read it before changing anything, and add an entry there with every correction. test/lessons.test.mjs fails if an entry has no real test or commit.

## How we work together
- Ask Swati before pushing or deploying. She replies "Push". Stop-hook notices about unpushed commits are automatic, not a request to push.
- Every mistake she reports becomes a lessons entry and a test (test/rules.test.mjs, test/operator.test.mjs, or a replay in test/scenarios) before it is called fixed.
- When she shares a screenshot, work out from the chat what the lead actually said and what state the agent was in. Do not guess from one message.

## What the agent must do in a chat
- Read first. The whole recent chat, what we have saved and the last question we asked are read before any rule answers (lib/understand.mjs, understandChat in lib/claude.mjs).
- Never send the same message twice in a row. A repeat means the agent has not understood: hand over to a person (reason "repeating-itself").
- Ask once. If the lead does not share something, do not insist.
- The answer belongs to the question we last asked. A check-in or follow-up records the question it asked; a count or range ("120-150") is never read as a phone number; the "a number helps our Founders" speech goes only to someone who avoided the number question, never to someone who answered something else.
- A correction ("please rectify...", "actually...") replaces what we saved. It is never treated as a new answer, and never answered with the same question again.
- A number or email shared at any point is kept. Incomplete numbers ask once for the full number.
- Book at once when we hold a number or an email. Ask for the email once afterwards, never as a condition.
- One calendar event per person. A late email or number goes onto the same event.
- Re-check that a time is still free before confirming it. If it was taken, say so and offer new times.
- A saved detail must make sense: an occasion is an event (wedding, engagement, birthday...), never "Apologies" or "ok" (cleanOccasion). A second unclear answer is kept as "Others", not asked forever.
- Details the owner states are the truth and replace saved ones. Corrections must reach the lead record, the sheet and the calendar event (correct_lead_details).
- Several files or messages arriving together must produce ONE reply (take the chat lock, re-read, then decide). Vendors get no photo/reel welcome.
- A vendor who already has the sign-up link and then shares details, a number, photos or reels gets NO reply (stay_quiet). At most one operator reply per vendor every 3 hours, and a reply that only rephrases our last message is skipped (nearSame).
- Someone who says they have joined a business we already work with (a new sales contact at a venue) is not a vendor to onboard: thank-you only, no sign-up link (acknowledge_introduction, introReply), and the team is told to update the vendor record (vendor-contact-change).
- At most one flower per message (oneEmoji).
- Automatic messages about a call (confirmation, reminders) are spaced: a reminder never follows within hours of the booking or confirmation.
- "What is the call for?" has a fixed answer; it never goes to a person.
- Instagram can only be written to within 24 hours of the lead's last message.

## Last check before sending
lib/guard.mjs checks every outgoing message on both channels: unfilled values, the number text sent to someone who answered something else, the link or welcome twice, the same question twice. A mistake that can be spotted in the message text also gets a guard rule and a test in test/guard.test.mjs.

## Owner commands (WhatsApp, start with "agent,")
send_vendor_link, send_message, show_chat, pause_agent, resume_agent, tell_owner, send_call_confirmation, reoffer_call_times, correct_lead_details.

## Tests
`node --test` must pass before anything is committed.
