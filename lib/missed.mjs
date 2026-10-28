// A booked Founders' call that nobody picked up. This file holds the rules only (no network); netlify/functions/missed-calls.mjs sends,
// the WhatsApp handler answers the reply. See docs/LESSONS.md L25.
//
// How it runs (Swati's wording): the first message is a QUESTION ("we could not connect last time, would you like to connect at a different time?").
// New times are offered only after the lead says yes. If there is no answer: a short follow-up a day later, a last note two days after that, then the
// lead is marked cold and the team is told once. Never more than these three messages.
const HOUR = 3600_000;

export const FIRST_AFTER_MS = 45 * 60_000;      // a call is only treated as missed this long after it started
export const TEAM_WAIT_MS = 10 * HOUR;          // the team already messaged about the missed call: give that message about ten hours before we write (a booked call is a hot lead)
export const GAP_MS = { 2: 24 * HOUR, 3: 48 * HOUR }; // from the previous follow-up
export const COLD_AFTER_MS = 48 * HOUR;         // after the last note
export const GIVE_UP_AFTER_MS = 5 * 24 * HOUR;  // a call missed this long ago is left to the team
export const KEEP_CALL_MS = 8 * 24 * HOUR;      // call records are kept this long (they were 36 hours before this feature)
export const SEND_FROM_HOUR = 9, SEND_TO_HOUR = 20; // IST

// What the team says when they could not reach the lead.
export const MISSED_TEXT = new RegExp([
  "\\b(tried|trying|attempted)\\s+(to\\s+)?(call|calling|reach|reaching|connect|connecting|contact|get\\s+through)",
  "\\b(could\\s?n[o']?t|could\\s+not|couldn[’']t|unable\\s+to|wasn[’']t\\s+able\\s+to|not\\s+able\\s+to)\\s+(reach|connect|get\\s+through|get\\s+hold|speak|talk)",
  "\\bno\\s+(answer|response)\\b",
  "\\b(didn[’']?t|did\\s+not|not)\\s+(pick|answer|take|receive)(ed|ing)?\\b",
  "\\bmissed\\s+(you|your|the|our)\\b",
  "\\b(unreachable|not\\s+reachable|switched\\s+off|phone\\s+was\\s+off)\\b",
  "\\bcall\\s+(didn[’']?t|did\\s+not)\\s+(go\\s+through|connect)",
  "\\b(call|phone)\\s+nahi\\s+(utha|uth|laga|lag)",
  "\\bphone\\s+nahi\\s+utha",
].join("|"), "i");

const firstName = (name) => String(name || "").trim().split(/\s+/)[0].replace(/[^\p{L}'’-]/gu, "") || "";
const hello = (name) => { const f = firstName(name); return f ? `Hi ${f}!` : "Hi!"; };

// The three messages. One flower at most, and none in the question itself.
export const missedText = (step, name) => {
  const h = hello(name);
  if (step === 1) return `${h} We tried to reach you for our call but could not connect last time.\n\nWould you like to connect at a different time? We would love to take this conversation ahead.`;
  if (step === 2) return `${h} Just checking in. Would you like us to set up a new time for the call with our Founders? Reply "yes" and we will share a few options.`;
  return `${h} We do not want to keep bothering you. Whenever you would like to talk, just reply here and we will find a time that suits you. 🌼`;
};
// Template variable for the approved templates: only the first name.
export const missedParams = (name) => ({ first_name: firstName(name) || "there" });
export const stepTemplate = (step, env = process.env) => String((step === 1 ? env.CALL_MISSED_TEMPLATE : step === 2 ? env.CALL_MISSED_FOLLOWUP_TEMPLATE : env.CALL_MISSED_LAST_TEMPLATE) || "").trim();

// ---- what the lead says back ----
const STRONG_NO = /\b(not interested|no longer interested|don[’']?t (call|contact|message|want|need)|do not (call|contact|message)|stop (calling|messaging)|no need|not required|already (done|booked|got|found|hired|finalised|finalized)|cancel|nahi chahiye|zaroorat nahi|mat karo)\b/i;
const BARE_NO = /^\s*(no|nope|nah|nahi|nahin|not now|no thanks?|no thank you)\b/i;
const YES = /^\s*(yes|yeah|yep|yup|yea|sure|ok(ay)?|please|pls|haan|han|ha|ji|ji haan|theek hai|thik hai|definitely|of course|absolutely|sounds good|go ahead|why not|certainly|alright)\b/i;
const YES_PHRASE = /\b(would like|i[’']?d like|we[’']?d like|happy to|can we|could we|let[’']?s|lets|share (the |some |a few )?(times|slots|options)|send (me )?(the |some |a few )?(times|slots|options)|reschedule|another time|different time|new time|other time|connect again|call (me|us)? ?(again|back))\b/i;
const WHEN = /\b(today|tomorrow|tmrw|tonight|kal|aaj|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|next week|this week|morning|afternoon|evening)\b|\b\d{1,2}\s?(am|pm)\b|\b\d{1,2}:\d{2}\b/i;

// "yes" (they want another time; a day or time they name is used), "no" (polite close), or "other" (anything else: the normal flow reads it).
export function missedReply(text) {
  const t = String(text || "").trim();
  if (!t) return "other";
  if (STRONG_NO.test(t)) return "no";
  if (BARE_NO.test(t) && !YES_PHRASE.test(t) && !WHEN.test(t)) return "no"; // "no, tomorrow is better" names another time: that is a yes
  if (YES.test(t) || YES_PHRASE.test(t)) return "yes";
  if (WHEN.test(t) && t.split(/\s+/).length <= 14) return "yes"; // "tomorrow evening works", "can do Friday after 5"
  return "other";
}

export const closeText = (name) => `${hello(name)} No problem at all. Whenever you would like to talk, just message us here and we will be happy to arrange a time. 🌼`;

// ---- reading the chat after the call time ----
// msgs: [{ from: "us"|"customer", text, t }]. agentSends: times the agent itself sent something (so only the team's own messages count as the team).
export function afterCall(msgs, call, agentSends = []) {
  const ours = (t) => agentSends.some((s) => Math.abs(s - t) <= 150_000);
  const after = (msgs || []).filter((m) => m.t > call.start);
  const team = after.filter((m) => m.from !== "customer" && !ours(m.t));
  const customer = after.filter((m) => m.from === "customer");
  // The team's "tried calling" counts only while it is the team's LAST word: if they wrote anything else to the lead afterwards
  // (a link, "as we discussed on call", a portfolio), they got through and the call did happen (Meghna, L31).
  const lastMissedAt = team.filter((m) => MISSED_TEXT.test(m.text || "")).reduce((a, m) => Math.max(a, m.t), 0);
  const spokeSince = (t) => team.some((m) => m.t > t && !MISSED_TEXT.test(m.text || ""));
  return {
    team, customer, spokeSince,
    teamSaysMissed: lastMissedAt > 0 && !spokeSince(lastMissedAt),
    lastTeamAt: team.reduce((a, m) => Math.max(a, m.t), 0),
    lastCustomerAt: (msgs || []).filter((m) => m.from === "customer").reduce((a, m) => Math.max(a, m.t), 0),
  };
}

// Is this call one to follow up, and when? Returns { do: "wait" | "send" | "ask-team" | "skip", why, at? }
// call: the saved call record ({ start, waId, follow, missedFlag, teamAsked }). Nothing here sends anything.
export function assess(call, read, now = Date.now()) {
  if (!call?.waId) return { do: "skip", why: "no WhatsApp number" };
  if (call.follow?.step) return { do: "skip", why: "already following up" };
  if (!call.start || now < call.start + FIRST_AFTER_MS) return { do: "wait", why: "call has not finished" };
  if (now > call.start + GIVE_UP_AFTER_MS) return { do: "skip", why: "too long ago" };
  if (read.customer.length) return { do: "skip", why: "the lead wrote after the call time, so a person reads it" };
  const flagged = Number(call.missedFlag) || 0;
  // Either way, a team message that is not about a missed call, written after the flag or after the "tried calling" text, means they are in touch.
  if (flagged && read.spokeSince?.(flagged)) return { do: "skip", why: "the team has been in touch since the call was flagged" };
  if (!flagged && !read.teamSaysMissed) {
    // Nobody has said what happened. If the team wrote nothing at all after the call, ask them once whether it was missed.
    if (!read.team.length && now > call.start + 3 * HOUR && !call.teamAsked) return { do: "ask-team", why: "nobody has said whether the call happened" };
    return { do: "skip", why: read.team.length ? "the team is in touch (the call was not missed, or they reached the lead since)" : "waiting for the team to say" };
  }
  // The owner said so: write as soon as the call is over. The team's own message about it: let that message breathe for ten hours.
  const at = flagged ? Math.max(call.start + FIRST_AFTER_MS, flagged) : Math.max(call.start + FIRST_AFTER_MS, read.lastTeamAt + TEAM_WAIT_MS);
  return now >= at ? { do: "send", step: 1, at } : { do: "wait", why: "giving the team's message ten hours", at };
}

// After the first message: what is due next? `lastCustomerAt` is the newest message from the lead in the chat.
export function nextStep(call, lastCustomerAt, now = Date.now()) {
  const f = call?.follow;
  if (!f?.step || f.state !== "asked") return { do: "none" };
  if (lastCustomerAt && lastCustomerAt > f.at) return { do: "none", why: "replied" };
  if (f.step < 3) return now >= f.at + GAP_MS[f.step + 1] ? { do: "send", step: f.step + 1 } : { do: "wait" };
  return now >= f.at + COLD_AFTER_MS ? { do: "cold" } : { do: "wait" };
}

export const istHour = (ms = Date.now()) => new Date(ms + 5.5 * HOUR).getUTCHours();
export const inSendingHours = (ms = Date.now()) => istHour(ms) >= SEND_FROM_HOUR && istHour(ms) < SEND_TO_HOUR;
// A message to the lead may go as a plain chat message only while their 24-hour window is open (they wrote within 23 hours).
export const windowOpen = (lastCustomerAt, now = Date.now()) => Boolean(lastCustomerAt) && now - lastCustomerAt < 23 * HOUR;
