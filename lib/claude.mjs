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
          '{"date": string|null, "location": string|null, "occasion": string|null, "requirement": string|null}. ' +
          "date = the event date or month as they wrote it; location = city/venue/destination; occasion = wedding/reception/engagement/etc; " +
          "requirement = planning, decoration, or both. Use null for anything not stated. Never guess. Keep each value under 60 characters, in their words.",
        messages: [{ role: "user", content: `We just asked about: ${asked || "their event"}\nMessage: ${text}` }],
      }),
    });
    if (!res.ok) return {};
    const parsed = parseModelJson((await res.json()).content?.[0]?.text) || {};
    const out = {};
    for (const k of ["date", "location", "occasion", "requirement"]) {
      if (typeof parsed[k] === "string" && parsed[k].trim() && parsed[k].length <= 80) out[k] = parsed[k].trim();
    }
    return out;
  } catch { return {}; }
}
