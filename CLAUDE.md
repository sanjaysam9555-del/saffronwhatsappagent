# Saffron lead agent: working rules (read before changing anything)

These come from Swati's feedback on real chats. Every one of them was a real mistake. Add a line whenever she corrects something.

The full story of each mistake (the chat, what went wrong, the rule, the test, the commit) is in docs/LESSONS.md. Read it before changing anything, and add an entry there with every correction. test/lessons.test.mjs fails if an entry has no real test or commit.

## How we work together
- Ask Swati before pushing or deploying. She replies "Push". Stop-hook notices about unpushed commits are automatic, not a request to push.
- Every deploy costs Netlify credits (15 each; 63 deploys used 945 credits in one week). Batch: collect fixes, run the tests, and push once when she says "Push", not one push per fix. Tests, docs, CLAUDE.md and the template file never need a deploy (netlify.toml skips them). Never push only to "save" a commit.
- Every mistake she reports becomes a lessons entry and a test (test/rules.test.mjs, test/operator.test.mjs, or a replay in test/scenarios) before it is called fixed.
- When she shares a screenshot, work out from the chat what the lead actually said and what state the agent was in. Do not guess from one message.

## What the agent must do in a chat
- THE ONE RULE, enforced in code (L35): no message to a lead leaves unless, in that same run, the real chat was read and Claude was given it. The check sits at the only two exits (sendSessionMessage / sendTemplateMessage in lib/wati.mjs, sendInstagramText in lib/manychat.mjs) via assertContext (lib/readgate.mjs). Every function that can send runs inside withChat; every handler reads first; every message nobody just asked for (follow-up, reminder, missed-call note, call confirmation, owner order) goes through contextCheck (lib/presend.mjs) first. Never add a send path without these; test/gate.test.mjs fails if one skips them. CONTEXT_GATE=log or off is the emergency switch only.
- Read first. The whole recent chat, what we have saved and the last question we asked are read before any rule answers (lib/understand.mjs, understandChat in lib/claude.mjs).
- Never send the same message twice in a row. A repeat means the agent has not understood: hand over to a person (reason "repeating-itself").
- Ask once. If the lead does not share something, do not insist.
- The answer belongs to the question we last asked. A check-in or follow-up records the question it asked; a count or range ("120-150") is never read as a phone number; the "a number helps our Founders" speech goes only to someone who avoided the number question, never to someone who answered something else.
- Messages sent a few seconds apart are one burst (8 seconds). If the lead sends something that already answers the question we are about to ask, the question is left out of our reply; her newer message gets the next one (dropAnswered).
- A correction ("please rectify...", "actually...") replaces what we saved. It is never treated as a new answer, and never answered with the same question again. After a correction the summary must show it (check what was saved, not just that "updated" was said). A bare "wrong" is asked about once ("Which detail should we correct?"), not handed to a person.
- A confirmation of the summary is any short yes-like reply ("This is completely correct", "all details are correct"), not only a message starting with "yes"; it leads straight to the call offer (isConfirmation). "Yes, but..." is a correction.
- "It's correct" / "That's right" at the start of a longer reply confirms the summary (isConfirmation, AFFIRM_LEAD); what follows (a question) goes to the team as lead-question while the agent carries on with the call offer (confirmExtra, L39). A chat paused only by the agent's soft handover ("lead-added-details") that we then asked for a number is not closed: their number is the answer, kept, and call times are offered (resumeOnNumber).
- A lead who already confirmed the summary (on either channel) is never asked to confirm it again: the WhatsApp summary uses lead_confirmed_v1 ("tell us if you want to change anything"), via summaryChoice in lib/leadfields.mjs.
- Every message we send that asks the lead something saves the question it asked (waStateAfterSummary, waStateAfterFinish): the reply is read as the answer, never as a stranger's first message, and never sent to the AI front desk. A lead we wrote to first is not a stranger even if the state is missing (sheetLead). A handle like "@kn.follows" is never used as a first name. "Not finalized" is a date answer.
- "Read first" holds at every door, not only in the question flow: the front-desk router is told when we wrote first, and a handover as "money" needs money words in the lead's message (lib/operator.mjs, L33).
- No single word decides. A stop word inside a longer message is never an opt-out (isOptOut; the team is told), "already booked the venue" is not an existing client, "book in advance" and "budget" are not money, and "link/join/register" never send the vendor link on their own (only an unmistakable offer of services does; the front desk reads the rest with the chat). Scheduled messages to leads read the chat first and send nothing if the team has it, the lead is mid-questions or wrote last (chatHolds), or the chat cannot be read. Any new rule or send path must say how it reads the chat first (L34).
- "I didn't get you", "what do you mean", "samajh nahi aaya" mean the lead did not understand us (CONFUSED, intent "confused"): never saved as an answer, never an addition to the summary, never a complaint. Say the last thing again in plainer words, once (kind "clarify"); a second time in a row goes to a person. One message is never answered by two runs (lastInKey, L37).
- A number or email shared at any point is kept. Incomplete numbers ask once for the full number.
- Book at once when we hold a number or an email. Ask for the email once afterwards, never as a condition.
- One calendar event per person. A late email or number goes onto the same event.
- Re-check that a time is still free before confirming it. If it was taken, say so and offer new times.
- A saved detail must make sense: an occasion is an event (wedding, engagement, birthday...), never "Apologies" or "ok" (cleanOccasion). A second unclear answer is kept as "Others", not asked forever.
- Details the owner states are the truth and replace saved ones. Corrections must reach the lead record, the sheet and the calendar event (correct_lead_details).
- Several files or messages arriving together must produce ONE reply (take the chat lock, re-read, then decide). Vendors get no photo/reel welcome.
- A vendor who already has the sign-up link and then shares details, a number, photos or reels gets NO reply (stay_quiet). At most one operator reply per vendor every 3 hours, and a reply that only rephrases our last message is skipped (nearSame).
- Someone who says they have joined a business we already work with (a new sales contact at a venue) is not a vendor to onboard: thank-you only, no sign-up link (acknowledge_introduction, introReply), and the team is told to update the vendor record (vendor-contact-change).
- Someone asking for a job or sharing a CV is not a vendor and not a client: a fixed thank-you (jobReply), no sign-up link, no event questions, a Needs Team line (job-enquiry), and the chat is left alone afterwards (jobSeeker flag). The guard also blocks the vendor link to a CV message.
- A file or photo with words (a caption) is read like any message; the words are what the lead said. A file named like a CV is noted as "[sent a resume]" and treated as a job enquiry. Only a file with no words gets the plain welcome.
- At most one flower per message (oneEmoji). A message is never one block of text: paragraphs() splits it into short paragraphs (first sentence, middle, closing question) on both channels.
- Automatic messages about a call (confirmation, reminders) are spaced: a reminder never follows within hours of the booking or confirmation.
- A booked call nobody picked up is followed up by the agent (lib/missed.mjs, netlify/functions/missed-calls.mjs): it counts as missed only when the team's message says so or the owner orders "agent, missed call <name>"; if nobody has said, the team is asked once. First message is a QUESTION (would you like to connect at a different time?), new times only after a yes (the same calendar event is moved); the wait after the team's own "tried calling" text is ten hours (a booked call is a hot lead); then one follow-up a day later and a last note, then cold. Every step re-reads the chat: if the team spoke to the lead or shared details after the call was missed, the agent never asks for "a new time for the call"; it sends ONE simple message ("Did you get a chance to look at what we shared? Please let us know when we can connect next.", sharedText, template CALL_MISSED_SHARED_TEMPLATE) 36 hours after the team's last message, and the chain ends there (nextStep, assess, L36). A reply that is not a clear yes or no is answered in context like any finished chat (draftAfter), not sent to a person. Three messages at most, 9 am to 8 pm IST, chat message inside 24 hours else the approved template. Never write to a lead who wrote after the call time. The team's "tried calling" counts only while it is their last word: if the team wrote anything else to the lead afterwards (a link, "as we discussed on call"), the call happened and nothing is sent.
- "What does 3 lakh include?", "what is included", "deliverables": answered from the published inclusions (inclusionsAnswer in lib/facts.mjs, from saffroncollective.in/pricing), never handed to a person and never written by the AI. When the website changes, update that text.
- "What is the call for?" has a fixed answer; it never goes to a person.
- Instagram can only be written to within 24 hours of the lead's last message.

## Last check before sending
lib/guard.mjs checks every outgoing message on both channels: unfilled values, the number text sent to someone who answered something else, the link or welcome twice, the same question twice. A mistake that can be spotted in the message text also gets a guard rule and a test in test/guard.test.mjs.

## Owner commands (WhatsApp, start with "agent,")
send_vendor_link, send_message, show_chat, pause_agent, resume_agent, tell_owner, send_call_confirmation, reoffer_call_times, correct_lead_details, missed_call.

## Tests
`node --test` must pass before anything is committed.
