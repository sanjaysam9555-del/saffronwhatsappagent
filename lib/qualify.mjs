import { GREETING } from "./rules.mjs";
import { FLOW, firstName } from "./leadfields.mjs";

// WhatsApp question flow for people who message you directly (e.g. from an Instagram ad).
// The number is already known on WhatsApp, so we only ask these, in this order:
export const ORDER = ["date", "location", "occasion", "requirement"];
const QUESTION = Object.fromEntries(FLOW.map((f) => [f.key, f.q]));
const LABEL = { date: "Event date", location: "Location", occasion: "Occasion", requirement: "Looking for" };

const AFFIRM = /^\s*(yes|yep|yeah|yup|correct|right|confirmed?|ok(ay)?|sure|sahi( hai)?|theek( hai)?|haan|ha|done|all good|looks good|perfect)\b/i;
// A lead asking us something is waiting for a person, not for the next question.
const QUESTIONISH = /\?|^\s*(how|what|why|which|where|when|can you|could you|do you|kya|kitna|kitne|kaise|kyun|kaun)\b/i;

export const newState = (fields = {}, source = "WhatsApp") => ({
  stage: "new", asked: null, source, notes: "",
  fields: Object.fromEntries(ORDER.filter((k) => fields[k]).map((k) => [k, fields[k]])),
});

export const confirmText = (name, fields) =>
  `Thank you${name ? " " + firstName(name) : ""}! Here is what we have noted:\n` +
  ORDER.filter((k) => fields[k]).map((k) => `• ${LABEL[k]}: ${fields[k]}`).join("\n") +
  `\n\nPlease confirm if this is correct, or reply with anything you would like to add. Our planner will then reach out with the next steps.`;

// One conversation turn. Pure: returns the new state, a reply, and what happened.
// extracted: optional {date, location, occasion, requirement} pulled out of the message by Claude.
export function advance(q, text, extracted = {}, name = "") {
  const t = String(text).trim();
  const s = { ...q, fields: { ...q.fields } };

  if (s.stage === "confirm") {
    if (AFFIRM.test(t)) {
      s.stage = "done";
      return { q: s, kind: "confirmed", reply: "Thank you for confirming! Our planner will be in touch with you shortly. 🌼" };
    }
    s.notes = [s.notes, t.slice(0, 300)].filter(Boolean).join(" / ");
    return { q: s, kind: "addition", reply: "Thank you, we have noted this. Our planner will review everything and be in touch shortly." };
  }

  const firstTurn = s.stage === "new";
  if (!firstTurn && QUESTIONISH.test(t)) return { q: s, kind: "escalate" };

  for (const k of ORDER) if (extracted[k] && !s.fields[k]) s.fields[k] = String(extracted[k]).slice(0, 80);
  // Without extraction, a reply to a question we asked is taken as the answer to that question.
  if (!firstTurn && s.asked && !s.fields[s.asked] && !GREETING.test(t)) s.fields[s.asked] = t.slice(0, 80);

  const next = ORDER.find((k) => !s.fields[k]);
  if (next) {
    s.stage = "asking";
    s.asked = next;
    const lead = firstTurn
      ? `Hello${name ? " " + firstName(name) : ""}! Thank you for reaching out to Saffron Collective 🌼 To help our planner prepare, I have a few quick questions. `
      : "Thank you! ";
    return { q: s, kind: "ask", reply: lead + QUESTION[next] };
  }
  s.stage = "confirm";
  s.asked = null;
  return { q: s, kind: "summary", reply: confirmText(name, s.fields) };
}
