# Lessons from Swati's feedback

Every entry is a real mistake the agent made in a real chat. This is the one place that keeps all of them: what happened, the rule it became, the test that proves it is fixed and the commit that fixed it.

How to add one (do this every time Swati corrects something, before calling it fixed):
1. Add an entry below, copying the shape of the others.
2. `Test:` is a piece of the title of a test in test/ that covers it. `test/lessons.test.mjs` fails if no test has that text in its title, or if the commit does not exist.
3. If the mistake is a type that can be spotted in the message itself, add it to lib/guard.mjs with a test in test/guard.test.mjs and name it in `Guard:`.
4. Put the one-line rule in CLAUDE.md as well.

Entries are in the order they were learned.

## L01 Short first reply, plain wording
- Date: 2026-10-23
- Chat: first replies on Instagram and WhatsApp
- Went wrong: the first reply was long and wordy.
- Rule: Hello Name, a welcome line, one more line, then one question. Names are used only when the profile name is a person. An unclear first message gets the fixed welcome "How can we help you?" and not a written question.
- Test: the first reply from Claude is short
- Commit: b749ab0

## L02 Vendors get the sign-up link, not the client questions
- Date: 2026-10-23
- Chat: vendors who introduced themselves
- Went wrong: vendors were treated as clients.
- Rule: a vendor gets a greeting and the sign-up link, using the name and business they gave. A vendor who writes again after the link is not asked client questions.
- Test: a vendor who introduces themselves gets a greeting and the sign-up link
- Commit: 4e67482

## L03 Two quick messages must not both be answered
- Date: 2026-10-25
- Chat: Instagram leads who sent two messages together
- Went wrong: both messages were answered and the same question was asked twice.
- Rule: one message at a time per chat (lock), re-read the chat, then decide. A quick follow-up never re-asks the question just asked.
- Test: two quick messages from one chat are handled one at a time
- Commit: 22b8785

## L04 Book the call at once; the email is never a condition
- Date: 2026-10-25
- Chat: leads choosing a call time
- Went wrong: the booking waited for an email the lead did not want to give.
- Rule: a number or an email is enough to book at once. The email is asked for once afterwards and added to the same event.
- Test: a number is enough to book at once
- Commit: 5f5245c

## L05 One calendar event per person
- Date: 2026-10-25
- Chat: Instagram leads who gave an email or number after booking
- Went wrong: a second event was created, or the booking was refused.
- Rule: a booking adopts the event that exists (by name, number or guest). A late email or number goes onto it.
- Test: one event per person
- Commit: f4d2b14

## L06 Incomplete numbers are asked for again, once
- Date: 2026-10-25
- Chat: Meghna (Instagram)
- Went wrong: a number with a digit missing was treated as "not shared".
- Rule: ask once for the full number with the country-code note. A short number sent while another question is open is asked about once and never stored as that answer. A full number sent late is saved and thanked.
- Test: a number with a digit missing is asked for again
- Test: an incomplete or late number is handled wherever the chat is
- Commit: 448a5a4

## L07 A typed message and its phone card are read once
- Date: 2026-10-25
- Chat: Meghna (Instagram)
- Went wrong: "could not read it, please type again" was sent twice although she had typed it.
- Rule: read the message that came before the card and answer once.
- Test: a typed message followed by its phone card is read from before the card
- Commit: e346410

## L08 A correction replaces what we saved
- Date: 2026-10-25
- Chat: Meghna ("please rectify the occasion as wedding")
- Went wrong: the correction was treated as a new answer and the same question was asked again.
- Rule: a correction replaces the saved detail. It reaches the questions, the summary, the lead record, the sheet and the calendar event.
- Test: a correction replaces what we hold
- Test: a correction Claude recognised
- Commit: e346410

## L09 Check a time is still free before confirming it
- Date: 2026-10-25
- Chat: Hritika (3:30 pm was held by another lead)
- Went wrong: "Lovely, that time" was sent for a time that was taken.
- Rule: re-check the time just before confirming. If it was taken, say so and offer new times.
- Test: a time taken while they were choosing is caught
- Commit: 5f5245c

## L10 Offer new times, apologise first when we caused the confusion
- Date: 2026-10-25
- Chat: Hritika, Meghna, Shubham (owner orders)
- Went wrong: nobody told the lead their time was gone, and a confusing message was followed by nothing.
- Rule: the owner can have the agent re-offer times, with the details given, a note, and an apology first. The chat goes back to the agent afterwards.
- Test: ownerCommand: re-offer times to an Instagram lead whose chosen time is gone
- Test: re-offering times can answer the lead's question first
- Commit: ef4e2f2

## L11 Read the whole chat first, and never send the same message twice
- Date: 2026-10-26
- Chat: Meghna ("how can we ensure the agent reads the context first")
- Went wrong: rules answered the latest message alone.
- Rule: the recent chat, what we have saved and the last question asked are read before any rule answers. A repeat means the agent has not understood: a person takes over (reason repeating-itself).
- Test: understand: the chat is laid out clearly
- Test: understand: an identical message to the one we just sent is a repeat
- Guard: same-question
- Commit: 9e918de

## L12 "What is the call for?" has a fixed answer, and a number shared with it is kept
- Date: 2026-10-26
- Chat: Shubham
- Went wrong: the question went to a person and the number she shared was lost.
- Rule: answer what the call is about, keep the number, then ask Meet or phone again.
- Test: call stage: 'what is the purpose of the call' is answered
- Commit: 33cedc7

## L13 Vendors get no photo or reel welcome, and files together get one reply
- Date: 2026-10-26
- Chat: Paras and "Anchor" (WhatsApp)
- Went wrong: photos, reels and links sent together each got a welcome; vendors got replies to every share.
- Rule: take the chat lock, re-read, then decide. Vendors get no media welcome.
- Test: media on its own: no welcome for a vendor
- Guard: welcome-twice
- Commit: e58f78d

## L14 An occasion must be a real event; the owner's details are the truth
- Date: 2026-10-26
- Chat: Meghna ("Apologies" saved as her occasion)
- Went wrong: "Apologies Apologies" was saved as the occasion. The corrected number was kept but the other details were left out, and the sheet and the calendar still showed the old ones.
- Rule: an occasion is an event (wedding, engagement, birthday). An unclear answer is asked about again once, then kept as Others. Details the owner states replace saved ones in the lead record, the sheet and the calendar event.
- Test: an occasion must be an occasion
- Test: owner-stated details replace saved ones
- Test: ownerCommand: correct what is saved about a lead
- Commit: d9b78cc

## L15 Confirmation and reminders must not arrive back to back
- Date: 2026-10-26
- Chat: Meghna (confirmed 6:42, reminded 10:00)
- Went wrong: the WhatsApp confirmation and the day-before reminder arrived hours apart. "This counts as pester."
- Rule: no day-before reminder within 18 hours of the booking or confirmation, and no hour-before reminder within 3 hours.
- Test: call reminders never pester
- Commit: 5171970

## L16 One flower per message, direct answers
- Date: 2026-10-26
- Chat: Shubham ("too many smileys and indirect answers")
- Went wrong: several flowers in one message, and filler thanks before the answer.
- Rule: at most one flower per message. Answer what was asked, plainly.
- Test: one flower per message
- Guard: one flower per message (oneEmoji)
- Commit: 3536d29

## L17 A vendor who already has the link gets no repeated replies
- Date: 2026-10-26
- Chat: Sunita Kashyap, Paras, "Anchor"
- Went wrong: "Thank you, please complete onboarding" and reminders were sent again and again.
- Rule: a vendor who already has the sign-up link and then shares details, a number, photos or reels gets no reply (stay_quiet). At most one operator reply per vendor every 3 hours. A reply that only rephrases our last message is skipped.
- Test: vendors who already have the link
- Guard: link-twice
- Commit: 4e5c86a

## L18 Someone who joined a business we already work with is not a vendor to onboard
- Date: 2026-10-26
- Chat: Ankit D Srivastava, Karma Lake Lands Golf Resort
- Went wrong: he said he had recently joined a property that is already in our vendor list, and got the vendor welcome and the sign-up link.
- Rule: thank-you only, no link. The team is told to update the vendor record (vendor-contact-change).
- Test: someone who joined a business we know gets a thank-you
- Commit: 5fb6a8e

## L19 The answer belongs to the question we last asked
- Date: 2026-10-26
- Chat: Aishvarya (Instagram)
- Went wrong: after a check-in asked for the date, "March 2027" was read as the answer to the old number question and she got the number speech. Then "120-150" guests was read as an incomplete phone number, and "Number of guests" brought the number speech again.
- Rule: a check-in records the question it asked. A count or range is never a phone number. The number speech goes only to someone who avoided the number question.
- Test: Aishvarya: a guest range is not a phone number
- Test: guard (Aishvarya)
- Guard: number-ask-misplaced
- Commit: c680b7a

## L20 Only write to Instagram inside the 24-hour window, and ask once without insisting
- Date: 2026-10-22
- Chat: Instagram leads in general
- Went wrong: messages must not be sent after Meta's window closes, and a lead who does not share something must not be chased.
- Rule: Instagram is written to only within 24 hours of the lead's last message. If a detail is not shared, ask once and move on.
- Test: Instagram flow: number asked first, any country accepted, deferral handled without pushing
- Test: ownerCommand: ambiguous, missing, closed window and unsafe text send nothing
- Commit: ab6462b

## L21 Do not ask what the lead has just answered
- Date: 2026-10-27
- Chat: Tulsi Mittal (Instagram)
- Went wrong: she sent her number (typed, then as a phone card) and answered "Which city or destination?" within about a minute. Our reply to the number asked for the city again, and only the next reply dealt with her answer. The logs show six messages in about 60 seconds, each its own run, 7 to 15 seconds apart, while messages were only grouped when they came within 5 seconds. Each reply was written from what she had sent when its run started.
- Rule: messages within 8 seconds are one burst. Before a reply goes out, if she has sent something newer that already answers the question we are about to ask, that question is left out and her newer message gets the next one.
- Test: Tulsi: a question the lead has already answered
- Commit: 4b50713

## L22 Claude must read the whole chat, not the part Instagram has shown so far
- Date: 2026-10-27
- Chat: Tulsi Mittal (Instagram), found from the logs
- Went wrong: Swati's Meta app reads each Instagram chat for the agent, and it works. But in Tulsi's burst it returned one message, twice, and that short list replaced our own record of the chat, which had more. The agent read a shortened chat. Only first-touch runs logged how much of the chat was read, so it could not be checked for later turns.
- Rule: the chat given to Claude is Instagram's list completed with our own record (nothing twice, newest last). Every read logs how many messages it used (counts only, never the text).
- Test: Tulsi: when Instagram's chat lags behind
- Commit: 6c2af9c

## L23 A CV is not a vendor sign-up
- Date: 2026-10-27
- Chat: +91 82096 93847 (WhatsApp)
- Went wrong: he wrote about working at Saffron (event execution, vendor coordination, client handling, sales), asked about relevant openings and shared his CV. The agent sent "Thank you for your interest in working with Saffron Collective! Please create your vendor profile here" with the vendor sign-up link.
- Rule: someone asking for a job or sharing a CV gets a fixed thank-you with no link and no event questions. The team is told (Needs Team: job-enquiry) and the chat is left alone afterwards. This is checked before the vendor and money rules, by the operator, by the hourly supervisor, and again by the check before sending. Words like "resume", "opening" or "job" alone are not enough ("can we resume tomorrow", "any openings on 12 December", "great job").
- Test: a CV or a job enquiry gets a thank-you
- Test: the operator routes a job seeker to the thank-you
- Test: guard: the vendor sign-up link is never sent to someone sharing a CV
- Guard: link-to-job-seeker
- Commit: c63bcb8

## Mistakes the guard watches for in every message
These are checked in lib/guard.mjs just before any message is sent on either channel: an unfilled value (undefined, null, {{name}}), the number text sent to someone who answered something else, the sign-up link or the welcome sent twice within 24 hours, the vendor link sent to someone sharing a CV, and the same question as our last message with nothing new around it. Blocked messages hand the chat to a person (reason message-blocked) or are skipped quietly.
