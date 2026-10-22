// Claude drafts light replies ONLY after the keyword gate in rules.mjs has already ruled out
// money/date/commitment topics. Even then, Claude's output is checked in code before sending.
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";

// Categories that may be auto-sent. Everything else is escalated to a human.
export const AUTO_OK = new Set(["greeting", "thanks", "ack", "signup_help", "general_info"]);

const SYSTEM = `You write short WhatsApp replies for Saffron Collective, a luxury wedding and event planning firm in Gurugram, India.
You receive the customer's latest message and recent chat history. Reply in the customer's language (English, Hindi or Hinglish), warm and professional, under 60 words, no emojis except at most one.
Classify the message into exactly one category:
- greeting: a hello or opening message
- thanks: thanks / okay / acknowledgement that needs no real answer
- ack: they shared details or asked to be contacted; reassure that a planner will reach out
- signup_help: a vendor asking how to join (the sign-up link is provided to you)
- general_info: simple question about what Saffron does (weddings, event planning, destination weddings, decoration)
- escalate: anything else, including complaints, negotiation, specific requests, anything you are unsure about
HARD RULES: never mention prices, fees, packages, discounts, dates, availability or payment. Never promise anything, never confirm bookings or commitments, never invent facts, venues or vendors. If unsure, use category "escalate".
Respond with ONLY JSON: {"category": "...", "reply": "..."}. For "escalate" use an empty reply.`;

export function checkReply(category, reply) {
  if (!AUTO_OK.has(category)) return { ok: false, why: `category ${category}` };
  if (!reply || reply.length > 600) return { ok: false, why: "bad length" };
  if (/₹|\brs\.?\s?\d|\binr\b|\d+\s?(k|lakh|lac|crore)\b|\bdiscount\b|\bpackage\b/i.test(reply))
    return { ok: false, why: "money language" };
  const urls = reply.match(/https?:\/\/\S+/g) || [];
  if (urls.some((u) => !u.startsWith(process.env.VENDOR_SIGNUP_URL || "https://invalid.invalid")))
    return { ok: false, why: "unexpected url" };
  return { ok: true };
}

export function parseModelJson(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// history: [{from: "customer"|"us", text}] oldest first
export async function draftReply({ text, name, history = [] }) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const convo = history.map((h) => `${h.from === "us" ? "Saffron" : "Customer"}: ${h.text}`).join("\n");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system: SYSTEM + `\nVendor sign-up link (only URL you may use): ${process.env.VENDOR_SIGNUP_URL}`,
      messages: [{
        role: "user",
        content: `Customer name: ${name || "unknown"}\nRecent chat:\n${convo || "(none)"}\n\nLatest customer message:\n${text}`,
      }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const parsed = parseModelJson(data.content?.[0]?.text);
  if (!parsed) return null;
  const verdict = checkReply(parsed.category, parsed.reply);
  return verdict.ok
    ? { category: parsed.category, reply: parsed.reply.trim() }
    : { category: "escalate", reason: `blocked: ${verdict.why}` };
}

// Pulls event details out of a free-text WhatsApp message. Never guesses: absent means null.
export async function extractFields(text, asked) {
  if (!process.env.ANTHROPIC_API_KEY) return {};
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 200,
        system: "Extract event details from a customer's WhatsApp message to a wedding planner. Respond with ONLY JSON: " +
          '{"date": string|null, "location": string|null, "occasion": string|null, "requirement": string|null, "guests": string|null}. ' +
          "date = the event date or month as they wrote it; location = city/venue/destination; occasion = wedding/reception/engagement/etc; " +
          "requirement = planning, decoration, or both; guests = guest count as they wrote it (e.g. 150, around 200). Use null for anything not stated. Never guess. Keep each value under 60 characters, in their words.",
        messages: [{ role: "user", content: `We just asked about: ${asked || "their event"}\nMessage: ${text}` }],
      }),
    });
    if (!res.ok) return {};
    const parsed = parseModelJson((await res.json()).content?.[0]?.text) || {};
    const out = {};
    for (const k of ["date", "location", "occasion", "requirement", "guests"]) {
      if ((typeof parsed[k] === "string" || typeof parsed[k] === "number") && String(parsed[k]).trim() && String(parsed[k]).length <= 80) out[k] = String(parsed[k]).trim();
    }
    return out;
  } catch { return {}; }
}

// A tailored first reply for someone messaging us for the first time. Claude only writes the warm opening (reads what they
// actually said); the next question is added by code. Never quotes money, dates or availability. Null means "use the standard opener".
export async function draftOpening({ text, name, greeted = false }) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 200,
        system: "You write the FIRST WhatsApp reply from Saffron Collective, a luxury wedding and event planning firm in Gurugram, to someone who has just messaged us. " +
          "Read what they actually wrote and respond to it like a warm, polished human planner: greet them by first name, welcome them to Saffron Collective, " +
          "acknowledge their specific situation (e.g. congratulate them if they are getting married), and acknowledge what they asked for. " +
          "If they asked about pricing, say pricing depends on their plans and our planner will walk them through it once we understand what they have in mind. " +
          "If they asked to connect or talk, say our planner will arrange a call. If they asked about availability or dates, say our planner will confirm. " +
          "HARD RULES: never state or hint at any price, fee, package, discount, date, time slot or availability; never say you checked a calendar; never promise anything specific; " +
          "never invent facts. Do NOT ask any question (the next question is added separately). Reply in their language (English, Hindi or Hinglish). " +
          (greeted ? "They were already welcomed a moment ago, so do NOT welcome them again; start by acknowledging what they said. " : "") +
          "Write exactly two short paragraphs separated by one blank line: first a warm greeting that welcomes them and congratulates or acknowledges their situation; second a response to what they asked. Maximum 50 words in total, at most one emoji (🌼). Output only the message text.",
        messages: [{ role: "user", content: `Name: ${name || "unknown"}\nTheir message: ${text}` }],
      }),
    });
    if (!res.ok) return null;
    const out = String((await res.json()).content?.[0]?.text || "").trim();
    if (!out || out.length > 400 || out.includes("?")) return null;
    if (/₹|\brs\.?\s?\d|\binr\b|\d+\s?(k|lakh|lac|crore)\b|\bdiscount\b|\bpackage\b|https?:\/\//i.test(out)) return null;
    return out.replace(/\n{3,}/g, "\n\n");
  } catch { return null; }
}

// A short, human reaction to what a lead just told us during the questions ("Udaipur, lovely choice!"). The next question is added
// by code. Null means "use the plain default". Never comments on price, dates, availability or what we can do.
export async function draftAck({ text, name, kind, asked, fields = {} }) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const known = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("; ") || "nothing yet";
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 120,
        system: "You are a warm, polished wedding planner at Saffron Collective replying on WhatsApp. The lead just answered one of our questions. " +
          "Write ONE short reaction (6 to 18 words) to what they actually said, in their language (English, Hindi or Hinglish), like a thoughtful human: " +
          "for example 'Udaipur, such a beautiful choice!' or 'A December wedding, how lovely!' or 'No problem, an approximate month works too.' " +
          "If their answer is vague or unsure, reassure them kindly. If they added a detail, acknowledge that detail specifically. " +
          "HARD RULES: do NOT ask any question; never mention price, fees, budget, packages, discounts, availability, being free or booked, or any time slot; " +
          "never promise or confirm anything; never invent facts or praise a venue or vendor by name unless they named it; at most one emoji (🌼); no greeting. Output only the sentence.",
        messages: [{ role: "user", content: `Lead name: ${name || "unknown"}\nWe were collecting: ${kind === "confirmed" ? "final confirmation" : kind === "addition" ? "an extra detail they added" : asked || "event details"}\nDetails so far: ${known}\nTheir message: ${text}` }],
      }),
    });
    if (!res.ok) return null;
    const out = String((await res.json()).content?.[0]?.text || "").trim();
    if (!out || out.length > 160 || out.includes("?") || /\n/.test(out)) return null;
    if (/₹|\brs\.?\s?\d|\binr\b|\d+\s?(k|lakh|lac|crore)\b|\bdiscount\b|\bpackage\b|\bavailab|\bbudget\b|https?:\/\//i.test(out)) return null;
    return out;
  } catch { return null; }
}

// The holding reply when a question needs a person (pricing, availability, a specific request). Acknowledges what they actually
// asked instead of a generic line, and hands over to the team. Null means "use the standard holding line".
export async function draftHold({ text, name }) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 150,
        system: "You are a warm, polished planner at Saffron Collective (luxury wedding and event planning, Gurugram) replying on WhatsApp. " +
          "The person asked something that only our team can answer (pricing, availability, a specific request, or a detailed question). " +
          "Write a short reply (max 35 words) in their language (English, Hindi or Hinglish) that shows you understood what they asked and says a member of our team will personally get back to them shortly, as two short lines separated by one blank line (first shows you understood, second says the team will get back). " +
          "HARD RULES: do NOT answer it; never state or hint at any price, fee, package, discount, date, time slot or availability; never say you checked anything; never promise a specific time or outcome; " +
          "never invent facts; do not ask a question; at most one emoji (🌼). Output only the message.",
        messages: [{ role: "user", content: `Name: ${name || "unknown"}\nTheir message: ${text}` }],
      }),
    });
    if (!res.ok) return null;
    let out = String((await res.json()).content?.[0]?.text || "").trim();
    if (!out || out.length > 300 || out.includes("?")) return null;
    out = out.replace(/\n{3,}/g, "\n\n");
    if (/₹|\brs\.?\s?\d|\binr\b|\d+\s?(k|lakh|lac|crore)\b|\bdiscount\b|\bpackage\b|https?:\/\/|\b(we are|we're|is|are) (available|free|booked)\b/i.test(out)) return null;
    return out;
  } catch { return null; }
}

// Who is this person? Decides whether to run the new-client questions. "client" = wants wedding/event services for themselves.
// "vendor" = offers services, supplies, vehicles, venues, or shares a portfolio/rates/photos. "unclear" = anything else.
// Without an API key, or on any error, falls back to "client" (the previous behaviour).
export async function classifySender({ text, name }) {
  if (!process.env.ANTHROPIC_API_KEY) return "client";
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 40,
        system: "A wedding and event planning company received a first WhatsApp message from an unknown number. Decide who is writing. " +
          'Respond with ONLY JSON: {"who": "client" | "vendor" | "unclear"}. ' +
          "client = a person or family planning their own wedding or event who wants planning/decor services. " +
          "vendor = a business or freelancer offering services, vehicles, venues, products, or sharing a portfolio, rates or work photos. " +
          "unclear = anything else, or if you cannot tell. When unsure, answer unclear.",
        messages: [{ role: "user", content: `Profile name: ${name || "unknown"}\nMessage: ${text}` }],
      }),
    });
    if (!res.ok) return "client";
    const who = parseModelJson((await res.json()).content?.[0]?.text)?.who;
    return ["client", "vendor", "unclear"].includes(who) ? who : "client";
  } catch { return "client"; }
}

// The chat is finished (call booked, declined, ...) and the lead writes again. Claude reads the message in context and answers like a
// person would (thanks a number, notes an email, welcomes details, says hello back). Anything needing a person (a question we cannot
// answer from the context, a change to the call, a complaint) comes back as a handover and code sends the holding reply and alerts the team.
// Null means "could not do it safely": the caller hands over too.
export async function draftAfter({ text, name, context = "", shared = {}, greeted = true }) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 300,
        system: "You reply for Saffron Collective, a luxury wedding and event planning firm in Gurugram, on Instagram or WhatsApp. The chat with this lead is already complete; " +
          "what we know and what is booked is given to you. The lead has just written again. Read their message in that context and reply like a warm, polished human planner would, to exactly what they said. " +
          "Examples: if they share a mobile number, thank them and say we have updated it in our records and will use it to reach them if needed. If they share an email, thank them and say it is noted. " +
          "If they thank us, say they are welcome, and only if a call is booked say we look forward to speaking with them. If they add event details (date, city, guests, occasion, what they want), thank them and say we have added it for our Founders. " +
          "If they just say hi, greet them back and ask if there is anything they would like to share. " +
          "HAND OVER instead of replying (handover \"question\") when they ask anything a person must answer: pricing, availability, what we can or cannot do, or anything you cannot answer from the context. " +
          "Use handover \"change\" when they want to reschedule, cancel or change the call. Also hand over when they are upset, complain, or the message is unclear. " +
          "HARD RULES: never state or hint at any price, fee, package, discount, date, time slot or availability, except the booked call time exactly as given in the context; never invent facts; never promise anything beyond the context; ask at most one question; maximum 45 words; at most one emoji (🌼); reply in their language (English, Hindi or Hinglish); do not greet them unless they greeted. " +
          "Output ONLY JSON: {\"handover\":\"none\"|\"question\"|\"change\",\"reply\":\"...\",\"fields\":{\"date\":null,\"location\":null,\"occasion\":null,\"requirement\":null,\"guests\":null},\"news\":true|false}. " +
          "fields holds only event details they stated in THIS message (null otherwise). news is true when the message holds anything new our team should read.",
        messages: [{ role: "user", content: `Name: ${name || "unknown"}\nWhere we stand: ${context}\nNumber they shared now: ${shared.number || "none"}\nEmail they shared now: ${shared.email || "none"}\nTheir message: ${text}` }],
      }),
    });
    if (!res.ok) return null;
    const p = parseModelJson((await res.json()).content?.[0]?.text);
    if (!p || !["none", "question", "change"].includes(p.handover)) return null;
    const fields = {};
    for (const k of ["date", "location", "occasion", "requirement", "guests"]) {
      const v = p.fields?.[k];
      if ((typeof v === "string" || typeof v === "number") && String(v).trim() && String(v).length <= 80) fields[k] = String(v).trim();
    }
    if (p.handover !== "none") return { handover: p.handover, reply: "", fields: {}, news: false };
    const reply = String(p.reply || "").trim();
    if (!reply || reply.length > 400 || (reply.match(/\?/g) || []).length > 1) return null;
    if (/₹|\brs\.?\s?\d|\binr\b|\d+\s?(k|lakh|lac|crore)\b|\bdiscount\b|\bpackage\b|\bavailab|https?:\/\//i.test(reply)) return null;
    return { handover: "none", reply: reply.replace(/\n{3,}/g, "\n\n"), fields, news: !!p.news || Object.keys(fields).length > 0 };
  } catch { return null; }
}
