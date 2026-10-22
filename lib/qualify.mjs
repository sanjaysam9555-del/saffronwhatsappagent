import { GREETING } from "./rules.mjs";
import { firstName } from "./leadfields.mjs";

// WhatsApp question flow for people who message you directly (e.g. from an Instagram ad).
// The number is already known on WhatsApp, so we only ask these, in this order:
// (No contact-number question: on WhatsApp we already have it. No budget question: it puts people off.)
export const ORDER = ["occasion", "date", "location", "guests", "requirement"];
const QUESTION = {
  occasion: "Is this for a wedding, a reception, or another occasion?",
  date: "What date are you planning your event for? An approximate month is fine too.",
  location: "Which city or destination are you considering?",
  guests: "Roughly how many guests are you expecting?",
  requirement: "Would you like help with full planning, decoration only, or both?",
};
const LABEL = { number: "Mobile", occasion: "Occasion", date: "Event date", location: "Location", guests: "Guests", requirement: "Looking for" };

// On Instagram we do not have the number yet, so it is asked first (after answering what they asked).
QUESTION.number = "So our planner can call you with the details, may I have your mobile number? Please include the country code if it is outside India.";
export const pendingQuestion = (q) => (q?.asked && QUESTION[q.asked]) || "";
export const orderOf = (s) => (s.channel === "instagram" ? ["number", ...ORDER] : ORDER);
const PENDING = /^(pending|not shared)$/i;
const REFUSE = /\b(don'?t want|do not want|won'?t|will not|not comfortable|prefer not|no number|privacy|not sharing|can'?t share)\b/i;
export const CALL_INVITE =
  "To help you better and share the right details for your event, we suggest a quick 20-minute call with our Founders. 🌼\n\nWould you prefer a Google Meet video call or a phone call?";
const DECLINE = /^\s*(no|nope|nah|not now|later|maybe later|not interested|skip)\b/i;

const AFFIRM = /^\s*(yes|yep|yeah|yup|correct|right|confirmed?|ok(ay)?|sure|sahi( hai)?|theek( hai)?|haan|ha|done|all good|looks good|perfect)\b/i;
// A lead asking us something is waiting for a person, not for the next question.
const QUESTIONISH = /\?|^\s*(how|what|why|which|where|when|can you|could you|do you|kya|kitna|kitne|kaise|kyun|kaun)\b/i;

export const newState = (fields = {}, source = "WhatsApp", channel = "whatsapp") => ({
  stage: "new", asked: null, source, notes: "", channel,
  fields: Object.fromEntries(["number", ...ORDER].filter((k) => fields[k]).map((k) => [k, fields[k]])),
});

export const confirmText = (name, fields, ack = "") =>
  `${ack || `Thank you${name ? " " + firstName(name) : ""}!`} Here is what we have noted:\n\n` +
  ["number", ...ORDER].filter((k) => fields[k] && !PENDING.test(fields[k])).map((k) => `• ${LABEL[k]}: ${fields[k]}`).join("\n") +
  `\n\nPlease confirm if this is correct, or reply with anything you would like to add.\n\nOur planner will then reach out with the next steps.`;

// One conversation turn. Pure: returns the new state, a reply, and what happened.
// extracted: optional {date, location, occasion, requirement} pulled out of the message by Claude.
// opener: tailored welcome for the first reply. ack: tailored one-line reaction for every later reply. Both optional; plain defaults otherwise.
// pre: a fixed, published answer (e.g. our starting fees) placed before the next question when they asked about price.
export function advance(q, text, extracted = {}, name = "", opener = "", ack = "", pre = "") {
  const t = String(text).trim();
  const s = { ...q, fields: { ...q.fields } };

  if (s.stage === "confirm") {
    if (AFFIRM.test(t)) {
      s.stage = "call";
      return { q: s, kind: "confirmed", reply: `Thank you for confirming!\n\n${CALL_INVITE}` };
    }
    s.notes = [s.notes, t.slice(0, 300)].filter(Boolean).join(" / ");
    return { q: s, kind: "addition", reply: `${ack || "Thank you, we have noted this."}\n\nOur planner will review everything and be in touch shortly.` };
  }

  if (s.stage === "call") {
    if (DECLINE.test(t)) {
      s.stage = "done";
      return { q: s, kind: "call-declined", reply: "No problem at all.\n\nOur planner will be in touch with the next steps. 🌼" };
    }
    const pref = /\b(video|meet|google|online|zoom)\b/i.test(t) ? "meet" : /\b(phone|voice|call me|normal call|regular call|mobile|audio)\b/i.test(t) ? "phone" : null;
    if (pref) {
      s.stage = "done";
      s.callPref = pref;
      return {
        q: s, kind: "call-pref",
        reply: pref === "meet"
          ? "Wonderful!\n\nWe will share a few available times with you shortly, along with the Google Meet link. 🌼"
          : "Wonderful!\n\nWe will share a few available times with you shortly, and our Founders will call you on this number. If you would prefer a different number, just reply with it. 🌼",
      };
    }
    if (QUESTIONISH.test(t)) return { q: s, kind: "escalate" };
    s.callTries = (s.callTries || 0) + 1;
    if (s.callTries >= 2) {
      s.stage = "done";
      s.callPref = "either";
      return { q: s, kind: "call-pref", reply: "Thank you!\n\nOur team will be in touch to arrange a time that suits you. 🌼" };
    }
    return { q: s, kind: "call-ask", reply: "Just to check, would you prefer a Google Meet video call or a phone call?" };
  }

  const firstTurn = s.stage === "new";
  if (!firstTurn && !pre && QUESTIONISH.test(t)) return { q: s, kind: "escalate" };

  const order = orderOf(s);
  // A number shared late (after "later") still counts, wherever in the chat it arrives.
  if (extracted.number && (!s.fields.number || PENDING.test(s.fields.number))) s.fields.number = String(extracted.number).slice(0, 20);
  for (const k of order) if (k !== "number" && extracted[k] && !s.fields[k]) s.fields[k] = String(extracted[k]).slice(0, 80);

  // The mobile number: never taken from free text. Not given yet -> explain once, then move on without pushing.
  let numberNote = "";
  if (!firstTurn && s.asked === "number" && !s.fields.number && !pre) {
    s.numTries = (s.numTries || 0) + 1;
    if (extracted.numberAmbiguous && s.numTries < 2) {
      return { q: s, kind: "ask", reply: "That number looks incomplete. Could you share it with the country code, for example +44 or +91?" };
    }
    if (REFUSE.test(t)) {
      s.fields.number = "Not shared";
      numberNote = "No problem, we will continue right here.";
    } else {
      s.fields.number = "Pending";
      numberNote = "Happy to continue here.\n\nA number simply helps our Founders reach you with exact details. No spam, just one call. You can share it whenever you like. 🌼";
    }
  }
  // Without extraction, a reply to a question we asked is taken as the answer to that question.
  if (!firstTurn && t && !pre && s.asked && s.asked !== "number" && !s.fields[s.asked] && !GREETING.test(t)) s.fields[s.asked] = t.slice(0, 80);

  const next = order.find((k) => !s.fields[k]);
  if (next) {
    s.stage = "asking";
    s.asked = next;
    const answer = pre ? `${pre}\n\n` : "";
    // Already welcomed a moment ago ("Hi" -> "How can we help you today?"): do not welcome them a second time.
    const welcome = opener || (s.greeted ? "" : `Hello${name ? " " + firstName(name) : ""}!\n\nThank you for reaching out to Saffron Collective 🌼`);
    const lead = firstTurn
      ? `${welcome ? welcome + "\n\n" : ""}${answer}To help our planner prepare, I have a few quick questions.\n\n`
      : `${ack ? ack + "\n\n" : ""}${numberNote ? numberNote + "\n\n" : ""}${answer}`; // later questions stand on their own; a short reaction only when one was written
    return { q: s, kind: "ask", reply: lead + QUESTION[next] };
  }
  s.stage = "confirm";
  s.asked = null;
  let reply = confirmText(name, s.fields, ack);
  // If the number is still missing, one last gentle ask, and never again.
  if (s.channel === "instagram" && PENDING.test(s.fields.number || "") && s.fields.number === "Pending" && !s.numLastAsk) {
    s.numLastAsk = true;
    reply = reply.replace("Our planner will then reach out with the next steps.", "If you are comfortable, you can also share your mobile number here, with the country code if it is outside India.\n\nOur planner will then reach out with the next steps.");
  }
  return { q: s, kind: "summary", reply };
}
