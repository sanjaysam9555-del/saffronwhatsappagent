// The last check before a message leaves the agent (WhatsApp and Instagram). Every rule here comes from a real chat that went wrong
// (see docs/LESSONS.md). The tests and the rules fix each mistake where it is made; this catches the same TYPE of mistake if it slips through.
//
//   checkOutgoing({ msg, lastIn, prev: { lastOutText, lastOut }, now, repeatOk }) ->
//     { action: "send", msg }                  send it (msg may have been repaired)
//     { action: "skip", code, why }            say nothing (it would only repeat what the lead already has)
//     { action: "handover", code, why }        a person takes over (the message is wrong in a way we cannot repair)
import { SHORT_DIGITS, OTHER_TOPIC, REFUSE } from "./qualify.mjs";
import { nearSame } from "./understand.mjs";
import { jobSeeker } from "./rules.mjs";

const HOUR = 3600_000;
const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const paras = (s) => String(s || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

// Text that must never reach a lead: a template that was not filled in, or a value that was missing.
export const PLACEHOLDER = /\bundefined\b|\bNaN\b|\[object [A-Za-z]+\]|\{\{|\}\}|\$\{|\bnull\b/;

// Sentences that only make sense when the lead avoided the number question (Aishvarya: sent after she answered a date and a guest count).
const NUMBER_SPEECH = /^(Happy to continue here\.|A number simply helps our Founders|No problem, we will continue right here\.)/i;
const INCOMPLETE = /^(That number looks incomplete|Note: Please include the country code)/i;
const DATEISH = /\b(january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b|\b20\d\d\b/i;

// Is what the lead just wrote clearly about something other than a mobile number?
export const aboutSomethingElse = (t) => {
  const s = String(t || "").trim();
  if (!s || REFUSE.test(s)) return false;
  return SHORT_DIGITS.test(s) || OTHER_TOPIC.test(s) || DATEISH.test(s);
};

const lastQuestion = (msg) => {
  const ps = paras(msg);
  for (let i = ps.length - 1; i >= 0; i--) if (/\?\s*(?:\u{1F33C})?\s*$/u.test(ps[i])) return { q: ps[i], rest: ps.filter((_, j) => j !== i).join("\n\n") };
  return null;
};

export function checkOutgoing({ msg, lastIn = "", prev = {}, now = Date.now(), repeatOk = false } = {}) {
  let out = String(msg ?? "").trim();
  if (!out) return { action: "skip", code: "empty", why: "nothing to send" };
  // 1. A placeholder or missing value leaked into the message: a person decides what to say.
  if (PLACEHOLDER.test(out)) return { action: "handover", code: "placeholder", why: "the message contained an unfilled value" };

  // 1b. The vendor sign-up link must never go to someone asking for a job or sharing a CV.
  const vurl = process.env.VENDOR_SIGNUP_URL;
  if (vurl && out.includes(vurl) && jobSeeker(lastIn)) return { action: "skip", code: "link-to-job-seeker", why: "they asked about a job, not to join as a vendor" };

  // 2. The number speech or the "incomplete number" text, sent to someone who answered something else: leave those paragraphs out.
  if (aboutSomethingElse(lastIn)) {
    const kept = paras(out).filter((p) => !NUMBER_SPEECH.test(p) && !INCOMPLETE.test(p));
    if (kept.length !== paras(out).length) {
      if (!kept.length) return { action: "handover", code: "number-ask-misplaced", why: `they wrote "${String(lastIn).slice(0, 40)}", not a number` };
      out = kept.join("\n\n");
    }
  }

  if (!repeatOk) {
    const sinceOut = now - (prev.lastOut || 0);
    const last = prev.lastOutText || "";
    // 3. The sign-up link again, right after we sent it.
    const url = process.env.VENDOR_SIGNUP_URL;
    if (url && last && sinceOut < 24 * HOUR && out.includes(url) && last.includes(url)) return { action: "skip", code: "link-twice", why: "the sign-up link was sent a moment ago" };
    // 4. The welcome a second time.
    if (last && sinceOut < 24 * HOUR && /Welcome to Saffron Collective/i.test(out) && /Welcome to Saffron Collective/i.test(last)) return { action: "skip", code: "welcome-twice", why: "already welcomed" };
    // 5. The same question as our last message, with nothing new around it.
    if (last && sinceOut < 3 * HOUR) {
      const a = lastQuestion(out), b = lastQuestion(last);
      if (a && b && a.q.length > 15 && norm(a.q) === norm(b.q) && (!norm(a.rest) || nearSame(a.rest, b.rest))) return { action: "handover", code: "same-question", why: "it asks what we just asked" };
    }
  }
  return { action: "send", msg: out };
}

// The same message without its closing question (a question the lead has already answered in a newer message).
// What is left may be empty: then nothing is sent and the newer message gets the answer.
export function dropQuestion(msg) {
  const ps = paras(msg);
  if (!ps.length) return "";
  const lastIsQ = /\?\s*(?:\u{1F33C})?\s*$/u.test(ps[ps.length - 1]);
  return (lastIsQ ? ps.slice(0, -1) : ps).join("\n\n");
}
