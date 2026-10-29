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

## L24 Words that come with a file are read
- Date: 2026-10-27
- Chat: +91 86881 14882, "Rehman here" (WhatsApp)
- Went wrong: he sent a file named "Resume .pdf" with the words "Rehman here, I work as freelancer" at 11:06 PM. Every file or photo on WhatsApp went to the plain welcome path, which never looked at the words or the file name, so he got "Welcome to Saffron Collective. Thank you for sharing this. How can we help you?". The job-seeker check in L23 only reads text, so it would not have caught this either.
- Rule: a file or photo that comes with words is read like any other message. A file named like a CV is noted as "[sent a resume]" and handled as a job enquiry. Only a file with no words and no CV name gets the plain welcome. Each media event logs its type, caption length and whether a file name arrived (lengths only).
- Test: Abdur: a resume sent as a file with a caption is read
- Commit: 32e4a4c

## L25 A call nobody picked up needs a next step
- Date: 2026-10-27
- Chat: Nikunj (WhatsApp), a booked call where the lead did not pick up
- Went wrong: the call was booked and the details sent, the team rang and got no answer, and then nothing: no one was told, nothing was scheduled, and the chat sat silent. There was no way to see which booked calls had been missed, and the agent never followed up.
- Rule: a call counts as missed only when the team's own message after the call says so ("tried calling", "could not connect"...) or the owner orders "agent, missed call <name>"; when nobody has said, the team is asked once. The agent then writes itself: first a QUESTION ("we could not connect last time, would you like to connect at a different time?", no times, no flower), and only when the lead says yes, new times (the same calendar event is moved, never a second one). No answer: a short follow-up a day later and a last note two days after that, then the lead is marked cold and the team is told once. Never more than three messages, only 9 am to 8 pm IST, inside the 24-hour window as a chat message and otherwise as the approved template (without one, the team gets a line to do it by hand). A "no" gets a polite close. Anything else the lead says is answered in context like any finished chat (Swati: "handle that conversation as you handle other conversations"); only a request to move the call that cannot be moved from here goes to a person. If the lead wrote after the call time, or the team is already talking to them, the agent stays out. Team messages written before our question never block the lead's answer; a person writing after it does.
- Test: missed call (Nikunj): the first message is the question
- Test: missed call: only the team's words or the owner make it a missed call
- Test: missed call: three messages at most, spaced, then cold
- Test: missed call: how the lead's answer is read
- Test: owner order 'missed call'
- Commit: 7719e6b

## L26 A reply is never one block of text
- Date: 2026-10-27
- Chat: Shriya Verma (Instagram), Rishikesh wedding on 19th and 20th Feb
- Went wrong: both replies Claude wrote for her went out as one long paragraph (a greeting, a fact and a question run together), while every fixed message we send is in short paragraphs. They were hard to read on Instagram.
- Rule: every outgoing message is shaped into short paragraphs on both channels: the first sentence alone, the middle together, a closing question alone. A message that already has line breaks (a list of times, a fixed text) is never touched.
- Test: Shriya: a reply written as one block of text
- Commit: 43a3794

## L27 A correction must show in the summary
- Date: 2026-10-27
- Chat: Ajay, ajayrtale (Instagram), Jaipur wedding on 15 Jan 2027
- Went wrong: the summary said "Looking for: Decoration only". He wrote "looking for venue, decor and events". The agent said "Thank you, we have updated it." and showed the summary again, still "Decoration only", because any answer containing "decor" was saved as Only Decoration. It also thanked him twice in one message ("Thank you, we have updated it." and "Thank you Ajay!"). He then wrote "wrong" and was passed to the team with the holding message, with no question about what was wrong.
- Rule: what they are looking for is Planning + Decoration whenever décor comes with anything more (a venue, events, coordination, catering...); "Only Decoration" only when it is just décor. A corrected summary carries one thank-you. A bare "wrong" is asked about once ("Which detail should we correct?") and the next answer is read as the correction.
- Test: Ajay: 'venue, decor and events' is not saved as Only Decoration
- Commit: 6f7901a

## L28 What a price includes is answered from the website
- Date: 2026-10-27
- Chat: Kajal Malkani, ikavi_26 (Instagram)
- Went wrong: after the price list she asked "What does 3 lakh include" and was handed to the team with a holding message; her next message, "What's included in ₹3.5 lakh?", got no reply at all because the chat was already paused. The questions have no price keyword, so they were treated as unknown questions. The website's pricing page says exactly what each tier includes.
- Rule: a question about what is included, covered or delivered (an amount, a tier or just "what do I get") gets the published inclusions from saffroncollective.in/pricing, word for word, fixed in lib/facts.mjs and never written by the AI: the tier she named, or all three with the pricing link. An amount that is not a tier's published start price is never repeated back as something we offer. This works in the questions, after the summary, in finished chats and in the first-contact route, on both channels.
- Test: Kajal: 'what does 3 lakh include' is answered from the pricing page
- Commit: 070ca7c

## L29 A confirmation is not only a message that starts with "yes"
- Date: 2026-10-28
- Chat: Shruti Singh (Instagram), full planning, Patna or closer
- Went wrong: she answered the summary with "This is completely correct." The agent only counted messages that start with words like yes, correct or ok as a confirmation, so this was read as extra information: "Thank you, we have noted this. Our planner will review everything and be in touch shortly." The call was never offered, so there was no time to choose and no booking.
- Rule: a confirmation also includes phrases like "this is completely correct", "all the details are correct" and "that's right" (short, no negation). A "yes, but..." or "all correct except..." is a correction, never a confirmation. A confirmed summary always leads straight to the call offer.
- Test: Shruti: 'This is completely correct' confirms the summary
- Commit: 35e1dda

## L30 Never ask to confirm what the lead has already confirmed
- Date: 2026-10-28
- Chat: Shruti Singh, WhatsApp (after confirming on Instagram)
- Went wrong: she wrote "This is completely correct." in the Instagram chat. The WhatsApp summary that followed still said "Please confirm if this is correct, or reply here with anything you would like to add", asking for the same confirmation a second time.
- Rule: a lead whose Instagram chat is already past the confirmation step gets the confirmed template (lead_confirmed_v1, setting CONFIRMED_TEMPLATE_NAME): "This is what we have noted... If you would like to change anything, just reply here and let us know." Their WhatsApp reply then carries on where the Instagram chat is (the call offer, or a booked call), never back to "please confirm". Until the template is approved and set, the usual template is used.
- Test: Shruti: a lead who already confirmed on Instagram is not asked to confirm again
- Commit: 782ea28

## L31 A missed-call text is not a missed call once the team has spoken to the lead
- Date: 2026-10-28
- Chat: Meghna Sethi, WhatsApp (call booked, then spoke)
- Went wrong: at 9:00 AM the agent wrote "We tried to reach you for our call but could not connect last time", although the call had taken place: the night before the team had sent the Drive link, the wedding-services page ("like we discussed on call") and the portfolio. The agent had counted an earlier "tried calling" text (or the owner's flag) and never noticed that the team wrote to her afterwards.
- Rule: the team's "tried calling" counts only while it is the team's last word on the chat. Any other team message after it (or after the owner's "missed call" order) means they got through: the agent skips the call ("the team has been in touch").
- Test: missed call (Meghna): a 'tried calling' text followed by the team speaking to the lead is not a missed call
- Commit: 9828b66

## L32 Every message we send that asks something must save what we asked
- Date: 2026-10-29
- Chat: Kapil, @kn.follows (Instagram lead), WhatsApp
- Went wrong: at 10:00 AM the "we would like a few more details: event date, location and what you need from us" template went out (greeting him as "Hi @kn.follows"). It saved no conversation state. At 11:38 he answered "Planning in the coming year, dates not finalized" and the agent treated him as a stranger writing for the first time: the AI front desk guessed "money" and handed him to the team with "a member of our team will get back to you", without asking his location or offering a call. A further gap: "dates not finalized" is a real answer, but would have been asked again as a vague date.
- Rule: any template or message that asks the lead something (the summary, the "few more details" message, a check-in) records the question it asked (waStateAfterFinish, waStateAfterSummary), so the reply is read as its answer. A lead we wrote to first (a sheet row and our last message in the chat) is never treated as a stranger, even if the state was not saved (sheetLead). A profile handle ("@name") is not a first name: the greeting says "there". "Not finalized", "not fixed", "not decided" count as a date answer, asked about once at most.
- Test: Kapil: a reply to the 'few more details' message is read as the answer, not handed to the team as a stranger
- Commit: 6aab647

## L33 "Read the chat first" must hold at every door, not only in the question flow
- Date: 2026-10-29
- Chat: Kapil, @kn.follows (same chat as L32)
- Went wrong: the rule "read the whole chat before answering" was built into the question flow (understandChat) but not into the older front-desk router, which a lead reaches when no state is saved. The router was given the chat, but the line telling it what we know said "A contact we have not spoken to before", contradicting the chat. It then chose "hand to team: money" for "dates not finalized", a message with no money in it.
- Rule: wherever the AI decides what to do with a message it is told when we wrote first ("most likely the answer to our last message, never a stranger"). A handover for "money" is accepted only when their words contain money (price, payment, discount, advance, availability); otherwise, in a chat we started, the questions carry on.
- Test: Kapil: the router is told we wrote first, and cannot hand over as 'money' a reply that has no money in it
- Commit: 85c369d

## L34 Audit: no single word decides, and nothing is sent before the chat is read
- Date: 2026-10-29
- Chat: found while auditing after Kapil (L32, L33); no new chat yet, but each of these would have hit a real lead
- Went wrong: the same mistake as Kapil sat in other places. (1) A stop word ("not interested", "don't call") inside a longer message put the lead on the do-not-contact list: "not interested in a video call, phone please" would have ended the chat for good. (2) "already booked" or "paid the" made a lead an existing client: "we already booked the venue" was handed to the team. (3) "budget" or "advance" made a message money: "book in advance" was handed to the team. (4) The words "link", "join" or "register" sent the vendor sign-up link before the front desk read the chat: a client asking for "the Meet link" could get it. (5) The scheduled "summary / a few more details" sender read no chat at all: it could message someone the team was already speaking to, or someone mid-questions with the agent.
- Rule: a stop is short and stands alone (isOptOut); the same words in a longer message are read normally and the team is told (possible-opt-out), no do-not-contact flag. Existing client needs "with you/us" or the advance/final payment to us. Money needs a payment word ("advance payment", not "in advance"; a volunteered budget is noted). The vendor link goes on words alone only for an unmistakable offer of services; anything softer goes to the front desk with the chat. Every scheduled message to a lead reads the chat first and sends nothing if the team has the chat, the lead is mid-questions, the lead wrote last (chatHolds), or the chat cannot be read; the same on Instagram when the chat is with the team.
- Test: audit: one word never decides (opt-out, existing client, money, vendor link, scheduled sends)
- Commit: 901c31c

## L35 The one rule, enforced where messages leave: read the chat, hand it to Claude, then send
- Date: 2026-10-29
- Chat: Swati after Kapil (L32 to L34): "no message goes out without reading the context, no matter where or what the chat is"
- Went wrong: "read the chat first" was a habit built into some paths, not something the system enforced. Each time a new path (a scheduled job, the front desk router, a template send) missed it, a lead got a wrong message. Fixing paths one by one left the next unwritten path open.
- Rule: nothing is sent to a lead unless, in that same run, (1) the real chat was read (getRecentMessages, or Instagram's own history / our record) and (2) Claude was handed that chat and answered (understandChat, routeMessage, draftReply, draftFollowUp, reviewChat or contextCheck). This is enforced at the only two exits, sendSessionMessage/sendTemplateMessage (lib/wati.mjs) and sendInstagramText (lib/manychat.mjs), by assertContext (lib/readgate.mjs): a send without both is blocked, the team is told (agent-error), and the breach is logged ("CONTEXT GATE"). Both inbound handlers read first, before decide(). Every message nobody just asked for (follow-ups, reminders, missed-call notes, call confirmations, owner-ordered sends) first goes through contextCheck (lib/presend.mjs): Claude gets the chat and the planned message and says send or do not send; if the chat cannot be read or Claude cannot answer, nothing is sent. Messages to your own number are exempt. A new send path that skips this fails test/gate.test.mjs. Emergency switch: CONTEXT_GATE=log (log only) or off.
- Limit, stated plainly: this proves the chat was read and handed to Claude. It cannot prove Claude judged it well; that is covered by the guard, the other rules and corrections.
- Test: THE ONE RULE: nothing goes to a lead unless the chat was read and Claude was given it
- Commit: cef7c86

## L36 The missed-call chain re-reads the chat at every step, and after the team shared things it asks one simple question
- Date: 2026-10-29
- Chat: Meghna Sethi, WhatsApp (same chat as L31)
- Went wrong: L31 made the FIRST missed-call message check whether the team had since spoken to the lead. Step 2 ("Just checking in. Would you like us to set up a new time for the call with our Founders?", 9:30 AM) did not: once step 1 had gone, the chain moved on by the clock alone, a day later, even though the team had shared the Drive link and written "like we discussed on call" in the meantime (and had deleted our first note from the chat). The team was talking to her; the agent asked as if nobody had been. This message went out from the code that ran before the one-rule gate was pushed.
- What Swati said it should have been: "Hi Meghna, did you get a chance to look at the things we shared? Please let us know when we can connect next." Simple, for people we have already spoken to and sent details.
- Rule: every step of the chain (2, 3 and going cold) reads the chat first. If the call was missed and the team has since spoken to the lead or shared details (not a "tried calling" text), the agent never asks about "a new time for the call with our Founders". It sends ONE simple follow-up (sharedText), a day after the team's last message, with its own template (CALL_MISSED_SHARED_TEMPLATE; without one the team gets the draft to send by hand). That is the end of the chain: nothing more is sent, then cold. This holds for the first message as well as for steps 2 and 3. A note the team deleted cannot be seen through Wati, so the team's later messages are what show it. If the team spoke and nobody ever said the call was missed, the call happened and nothing is sent.
- Test: missed call (Meghna step 2): after the team shared things, the chain sends one simple follow-up instead of asking for a new call time
- Commit: 3dc0c1b

## Mistakes the guard watches for in every message
These are checked in lib/guard.mjs just before any message is sent on either channel: an unfilled value (undefined, null, {{name}}), the number text sent to someone who answered something else, the sign-up link or the welcome sent twice within 24 hours, the vendor link sent to someone sharing a CV, and the same question as our last message with nothing new around it. Blocked messages hand the chat to a person (reason message-blocked) or are skipped quietly.
