import test from "node:test";
import assert from "node:assert/strict";

process.env.VENDOR_SIGNUP_URL = "https://example.test/vendor-signup";
const { checkOutgoing, aboutSomethingElse, PLACEHOLDER, dropQuestion } = await import("../lib/guard.mjs");

const NOW = Date.parse("2026-10-26T08:00:00Z");
const SPEECH = "Happy to continue here.\n\nA number simply helps our Founders reach you with exact details. No spam, just one call. You can share it whenever you like. 🌼";
const INCOMPLETE = "That number looks incomplete. Could you share the full mobile number?\n\nNote: Please include the country code if it is outside India.";
const GUESTS = "Roughly how many guests are you expecting?";

test("guard: nothing wrong, nothing changed", () => {
  const r = checkOutgoing({ msg: "Lovely! Which city are you considering?", lastIn: "March 2027", prev: {}, now: NOW });
  assert.deepEqual(r, { action: "send", msg: "Lovely! Which city are you considering?" });
});

test("guard: an unfilled value never reaches a lead", () => {
  for (const bad of ["Hi undefined!", "Hello {{name}}", "Your call is on [object Object]", "Date: null", "Guests: NaN", "Hi ${name}"]) {
    const r = checkOutgoing({ msg: bad, prev: {}, now: NOW });
    assert.equal(r.action, "handover", bad);
    assert.equal(r.code, "placeholder");
  }
  assert.ok(!PLACEHOLDER.test("Nullah road venue, 30 guests"));
});

test("guard (Aishvarya): the number text is cut from a reply to someone who answered something else", () => {
  // she wrote "March 2027" and the number speech went out with the next question
  const a = checkOutgoing({ msg: `${SPEECH}\n\nWhich city or destination are you considering?`, lastIn: "March 2027", prev: {}, now: NOW });
  assert.equal(a.action, "send");
  assert.ok(!/number simply helps|Happy to continue/i.test(a.msg));
  assert.match(a.msg, /Which city or destination/);
  // she wrote a guest range and was told the number looks incomplete
  const b = checkOutgoing({ msg: INCOMPLETE, lastIn: "120-150", prev: {}, now: NOW });
  assert.equal(b.action, "handover");
  assert.equal(b.code, "number-ask-misplaced");
  // she explained "Number of guests" and got the speech and the same question
  const c = checkOutgoing({ msg: `${SPEECH}\n\n${GUESTS}`, lastIn: "Number of guests", prev: {}, now: NOW });
  assert.equal(c.msg, GUESTS);
});

test("guard: the number text still goes to someone who really is avoiding the number", () => {
  assert.equal(checkOutgoing({ msg: SPEECH, lastIn: "not now", prev: {}, now: NOW }).action, "send");
  assert.equal(checkOutgoing({ msg: SPEECH, lastIn: "I prefer not to share my number", prev: {}, now: NOW }).msg, SPEECH);
  assert.equal(checkOutgoing({ msg: INCOMPLETE, lastIn: "986251968", prev: {}, now: NOW }).action, "send"); // Meghna: a real short number
  assert.ok(!aboutSomethingElse("986251968"));
  assert.ok(aboutSomethingElse("120-150") && aboutSomethingElse("150+") && aboutSomethingElse("Number of guests") && aboutSomethingElse("March 2027"));
});

test("guard (Sunita, Paras): the sign-up link and the welcome are not sent twice", () => {
  const link = "Hello Sunita!\n\nThank you for introducing your work to us.\n\nPlease complete onboarding here:\nhttps://example.test/vendor-signup";
  const prev = { lastOutText: link, lastOut: NOW - 3600_000 };
  assert.equal(checkOutgoing({ msg: link.replace("Sunita", "Sunita K"), lastIn: "photos", prev, now: NOW }).action, "skip");
  assert.equal(checkOutgoing({ msg: link, lastIn: "hi", prev: { ...prev, lastOut: NOW - 30 * 3600_000 }, now: NOW }).action, "send"); // a day later is fine
  const w = "Hi Ankit!\n\nWelcome to Saffron Collective.\n\nHow can we help you?";
  assert.equal(checkOutgoing({ msg: w, lastIn: "hello", prev: { lastOutText: w, lastOut: NOW - 600_000 }, now: NOW }).action, "skip");
});

test("guard: the same question as our last message, with nothing new, is stopped; an answer around it is allowed", () => {
  const prev = { lastOutText: `Nearby Pune sounds lovely! 🌼\n\n${GUESTS}`, lastOut: NOW - 60_000 };
  assert.equal(checkOutgoing({ msg: GUESTS, lastIn: "ok", prev, now: NOW }).code, "same-question");
  assert.equal(checkOutgoing({ msg: `Nearby Pune sounds lovely!\n\n${GUESTS}`, lastIn: "ok", prev, now: NOW }).code, "same-question");
  // a real answer before the question (the call-purpose answer, a taught answer) is fine
  assert.equal(checkOutgoing({ msg: `The call is a 20-minute conversation with our Founders.\n\n${GUESTS}`, lastIn: "what is the call for?", prev, now: NOW }).action, "send");
  // an old question may be asked again
  assert.equal(checkOutgoing({ msg: GUESTS, lastIn: "hi", prev: { ...prev, lastOut: NOW - 5 * 3600_000 }, now: NOW }).action, "send");
  // a message that is allowed to repeat (repeatOk) skips these checks
  assert.equal(checkOutgoing({ msg: GUESTS, lastIn: "ok", prev, now: NOW, repeatOk: true }).action, "send");
});

test("guard is wired into both senders", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of ["netlify/functions/ig-process-background.mjs", "netlify/functions/wati-process-background.mjs"]) {
    const s = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.match(s, /checkOutgoing\(\{ msg, lastIn: text, prev: prev0, repeatOk \}\)/, f);
    assert.match(s, /toHuman\("message-blocked", true\)/, f);
  }
});

test("Tulsi: a question the lead has already answered in a newer message is left out of the reply", async () => {
  const reply = "Thank you, I have noted your number. 🌼\n\nWhich city or destination are you considering?";
  assert.equal(dropQuestion(reply), "Thank you, I have noted your number. 🌼");
  assert.equal(dropQuestion("Which city or destination are you considering?"), ""); // nothing left: nothing is sent, the newer message gets the answer
  assert.equal(dropQuestion("Lovely, that is noted."), "Lovely, that is noted.");   // no question: unchanged
  assert.equal(dropQuestion(`Nearby Pune sounds lovely!\n\n${GUESTS} 🌼`), "Nearby Pune sounds lovely!");
  assert.equal(checkOutgoing({ msg: dropQuestion("Which city or destination are you considering?"), lastIn: "x", prev: {}, now: NOW }).action, "skip");
  const { readFileSync } = await import("node:fs");
  const ig = readFileSync(new URL("../netlify/functions/ig-process-background.mjs", import.meta.url), "utf8");
  assert.match(ig, /msg = await dropAnswered\(msg\)/);
  assert.match(ig, /queuedTexts\(sid\)/);
  assert.match(ig, /DEBOUNCE_MS = 8000/);
});
