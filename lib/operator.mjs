// The operator: Claude reads the whole situation and decides what to do. Code only guards.
//  - routeMessage:  a message that is not part of the question flow (first contact, vendors, thanks, small questions).
//  - ownerCommand:  an order from you or your team on WhatsApp ("agent, resend the vendor link to Tanmay").
//  - reviewChat:    the hourly supervisor looking at a chat that nobody answered.
// Claude can only act through the tools below. It cannot write a price, a link of its own, or a promise: every reply it writes is
// checked in code (safeReply) and anything that fails the check goes to your team instead. Set OPERATOR_MODE=off to switch it all off.
import { vendorWelcome } from "./rules.mjs";

const MODEL = () => process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
export const operatorOn = () => String(process.env.OPERATOR_MODE || "on").trim().toLowerCase() !== "off";

const SITE = "https://saffroncollective.in";
const vendorLink = () => process.env.VENDOR_SIGNUP_URL || "";

// ---------- Claude with tools ----------
export async function callTools({ system, messages, tools, maxTokens = 700 }) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    // This model does not accept a forced tool choice (tool_choice "any" gives a 400), so Claude is told in the prompt to call exactly one tool.
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL(), max_tokens: maxTokens, system, messages, tools, tool_choice: { type: "auto" } }),
    });
    if (!res.ok) { console.error("operator: Claude API", res.status, String(await res.text().catch(() => "")).slice(0, 300)); return null; }
    const body = await res.json();
    const calls = (body.content || []).filter((b) => b.type === "tool_use").map((b) => ({ name: b.name, input: b.input || {} }));
    return calls.length ? calls : null;
  } catch (e) { console.error("operator:", e.message); return null; }
}

// ---------- The guard: what Claude's own words may never contain ----------
const MONEY = /₹|\brs\.?\s?\d|\binr\b|\d[\d,.]*\s?(k|lakhs?|lacs?|crores?)\b|\bdiscounts?\b/i;
const PROMISE = /\b(guarantee[sd]?|we (are|will be) available|you are booked|your booking is|confirmed your|we have blocked|date is (held|reserved))\b/i;
export function safeReply(text, { extraLinks = [] } = {}) {
  const t = String(text ?? "").trim();
  if (!t) return { ok: false, why: "empty" };
  if (t.length > 700) return { ok: false, why: "too long" };
  if (MONEY.test(t)) return { ok: false, why: "money language" };
  if (PROMISE.test(t)) return { ok: false, why: "promise" };
  const allowed = [SITE, vendorLink(), ...extraLinks].filter(Boolean);
  const bad = (t.match(/https?:\/\/[^\s)]+/g) || []).find((u) => !allowed.some((a) => u.startsWith(a)));
  if (bad) return { ok: false, why: "link not ours" };
  return { ok: true, text: t };
}

// ---------- What Claude is told about us ----------
const FACTS = `ABOUT US
Saffron Collective is the client-facing name of Saffron Events, a luxury wedding and event planning firm in Gurugram (Golf Course Extension Road), serving Delhi NCR, pan-India and destination weddings (Jaipur, Udaipur, Goa and more).
Services: full wedding planning, partial planning, wedding day coordination, décor and styling (we have an in-house décor unit), destination weddings. We also keep a network of vendors (photographers, caterers, florists, rental and furniture suppliers and so on) who register on our vendor portal.
Founders walk clients through scope and pricing on a short call. Pricing is never quoted by you; if someone asks for prices use the answer_price_question tool, which sends our fixed wording.
Website: ${SITE}`;

const STYLE = `HOW YOU WRITE
- Warm, polished, human. Like a senior planner at a luxury firm texting on WhatsApp or Instagram, never like a form or a bot.
- SHORT. At most three short sentences, and at most one question. People get overwhelmed by long messages.
- Reply in the language they wrote in (English, Hindi, Hinglish). At most one emoji (🌼).
- Use their first name only if you are sure it is a person's first name (from the message or profile). Never "Hello Dr".
- Use what they actually told you. Never ask for something they already said. Never repeat what the chat already shows.
- Never state or hint at a price, fee, discount, date availability, or promise anything. Never invent facts, venues, people or links. Never write a link yourself.
- Never say "a member of our team will get back to you" unless you truly cannot do better. A vendor who introduces themselves needs the vendor welcome, not a hold message.`;

const toolDef = (name, description, properties = {}, required = []) => ({ name, description, input_schema: { type: "object", properties, required } });
const str = (description) => ({ type: "string", description });

// ---------- 1. Routing one incoming message ----------
const ROUTE_TOOLS = [
  toolDef("start_client_questions", "The writer is a person planning their own wedding or event (or asking about our services as a client). Our standard conversation takes over: it greets them, answers what they asked, and asks one question at a time."),
  toolDef("send_vendor_welcome", "The writer is a business or freelancer offering services, rentals, products, a venue, or sharing a catalogue or portfolio (or an existing vendor asking how to join). Greets them and sends our vendor sign-up link.", {
    name: str("Their first name if they gave it, else empty"), business: str("Their business name as they wrote it, else empty"),
  }),
  toolDef("reply", "Send a short written reply yourself: for a greeting, thanks, a vendor follow-up, or a simple question you can answer from ABOUT US. Never prices, availability, promises or links.", { text: str("The message to send") }, ["text"]),
  toolDef("answer_price_question", "They asked about price, cost or packages. Sends our fixed pricing wording."),
  toolDef("hand_to_team", "A person on the team must handle this: money or discounts, existing clients, complaints, negotiations, anything you cannot safely answer. Also send a short holding message that fits the situation.", {
    reason: { type: "string", enum: ["money", "existing_client", "complaint", "unclear", "other"] },
    hold_text: str("A short, specific holding message that shows you read what they said"),
  }, ["reason"]),
  toolDef("stay_quiet", "Nothing should be sent (spam, an automated message, a plain acknowledgement that needs no reply).", { why: str("One short reason") }, ["why"]),
];

const clip = (s, n = 400) => String(s ?? "").slice(0, n);
const historyText = (history = []) => history.length
  ? history.slice(-12).map((m) => `${m.from === "customer" ? "THEM" : "US"}: ${clip(m.text, 300)}`).join("\n")
  : "(no earlier messages)";
const stateText = (s = {}) => [
  s.kind ? `We already know this contact as: ${s.kind}.` : "",
  s.stage ? `Conversation stage: ${s.stage}.` : "",
  s.greeted ? "They have already been greeted." : "",
  s.fields && Object.keys(s.fields).length ? `Details already collected: ${Object.entries(s.fields).filter(([, v]) => v && v !== "Pending").map(([k, v]) => `${k}=${v}`).join(", ")}` : "",
].filter(Boolean).join("\n") || "A contact we have not spoken to before.";

// Returns one of: {kind:"client"} {kind:"vendor",name,business} {kind:"reply",text} {kind:"price"} {kind:"handover",reason,hold} {kind:"quiet"} or null (could not decide: use the old rules).
export async function routeMessage({ channel, profileName = "", text, history = [], state = {} }) {
  const calls = await callTools({
    system: `You are the operator at the front desk of Saffron Collective. A message has come in on ${channel}. Decide what to do with it by calling exactly one tool.\n\n${FACTS}\n\n${STYLE}`,
    messages: [{ role: "user", content: `Profile name: ${profileName || "unknown"}\n\nWhat we know:\n${stateText(state)}\n\nChat so far:\n${historyText(history)}\n\nTHEIR NEW MESSAGE:\n${clip(text, 1500)}` }],
    tools: ROUTE_TOOLS,
  });
  const c = calls?.[0];
  if (!c) return null;
  const i = c.input;
  switch (c.name) {
    case "start_client_questions": return { kind: "client" };
    case "send_vendor_welcome": return { kind: "vendor", name: tidyName(i.name), business: tidyBusiness(i.business) };
    case "answer_price_question": return { kind: "price" };
    case "stay_quiet": return { kind: "quiet", why: clip(i.why, 100) };
    case "reply": {
      const v = safeReply(i.text);
      return v.ok ? { kind: "reply", text: v.text } : { kind: "handover", reason: "unclear", hold: "", rejected: v.why };
    }
    case "hand_to_team": {
      const v = i.hold_text ? safeReply(i.hold_text) : { ok: false };
      return { kind: "handover", reason: i.reason || "unclear", hold: v.ok ? v.text : "" };
    }
    default: return null;
  }
}
export const tidyName = (v) => String(v ?? "").replace(/[^\p{L}'’-]/gu, " ").trim().split(/\s+/)[0].slice(0, 20);
export const tidyBusiness = (v) => String(v ?? "").replace(/[^\p{L}\p{N} .&'’()-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 40);

// ---------- 2. Orders from you and your team ----------
export const COMMAND_PREFIX = /^\s*(agent|claude)\b\s*[,:\-–]?\s*/i;
export const isOwner = (waId) => {
  const digits = (v) => String(v || "").replace(/\D/g, "");
  const list = [process.env.OWNER_NUMBER, process.env.TEAM_ALERT_NUMBER, ...(process.env.OPERATOR_NUMBERS || "").split(",")].map(digits).filter(Boolean);
  const w = digits(waId);
  return Boolean(w) && list.some((n) => n === w || (n.length >= 10 && w.length >= 10 && n.slice(-10) === w.slice(-10)));
};

const OWNER_TOOLS = [
  toolDef("send_vendor_link", "Send the vendor welcome and sign-up link to a contact.", { to: str("Their WhatsApp number (digits) or their name as the owner said it") }, ["to"]),
  toolDef("send_message", "Send a WhatsApp message to a contact, written by you from the owner's instruction and the chat so far. Warm and short, in the style described.", { to: str("Number or name"), text: str("The message to send") }, ["to", "text"]),
  toolDef("show_chat", "Show the owner the recent chat with a contact and what the agent has done there.", { to: str("Number or name") }, ["to"]),
  toolDef("pause_agent", "Stop the agent answering a contact (a person will handle them).", { to: str("Number or name") }, ["to"]),
  toolDef("resume_agent", "Let the agent answer a contact again.", { to: str("Number or name") }, ["to"]),
  toolDef("tell_owner", "Just answer the owner in text: a question, a clarification you need, or when you cannot do what was asked.", { text: str("Your message to the owner") }, ["text"]),
];

// deps: { find(query) -> [{waId,name}], history(waId) -> msgs, send(waId,text), setFlags(waId,patch), now() }
export async function ownerCommand({ text, deps }) {
  const cmd = String(text).replace(COMMAND_PREFIX, "").trim();
  if (!cmd) return "Tell me what to do, for example: agent, resend the vendor link to Tanmay.";
  const calls = await callTools({
    system: `You are the operator of Saffron Collective's WhatsApp agent. The owner or a team member is giving you an order by message. Do exactly what they ask using one tool; if the order is unclear or the contact cannot be identified, use tell_owner and ask one short question. You can only reach WhatsApp contacts.\n\n${FACTS}\n\n${STYLE}`,
    messages: [{ role: "user", content: `ORDER: ${clip(cmd, 1200)}` }],
    tools: OWNER_TOOLS,
    maxTokens: 900,
  });
  const c = calls?.[0];
  if (!c) return "I could not work out what to do just now. Please say it again, or check that the Claude key is working.";
  const i = c.input;
  if (c.name === "tell_owner") return clip(i.text, 900);

  const found = await deps.find(String(i.to || ""));
  if (!found.length) return `I could not find "${clip(i.to, 40)}" in the chats I know. Send me their number with the country code.`;
  if (found.length > 1) return `More than one match for "${clip(i.to, 40)}": ${found.slice(0, 4).map((f) => `${f.name || "no name"} (+${f.waId})`).join(", ")}. Which one?`;
  const who = found[0], label = `${who.name || "contact"} (+${who.waId})`;

  if (c.name === "pause_agent") { await deps.setFlags(who.waId, { esc: true }); return `Done. The agent will stay out of the chat with ${label}.`; }
  if (c.name === "resume_agent") { await deps.setFlags(who.waId, { esc: false, humanSpoke: false }); return `Done. The agent will answer ${label} again.`; }
  if (c.name === "show_chat") {
    const msgs = (await deps.history(who.waId)) || [];
    if (!msgs.length) return `I could not read the chat with ${label}.`;
    return `Chat with ${label}:\n\n${msgs.slice(-8).map((m) => `${m.from === "customer" ? "Them" : "Us"}: ${clip(m.text, 200)}`).join("\n")}`;
  }
  let message = "";
  if (c.name === "send_vendor_link") {
    if (!vendorLink()) return "The vendor sign-up link is not set in Netlify (VENDOR_SIGNUP_URL), so I cannot send it.";
    message = vendorWelcome({ name: tidyName(who.name) });
  } else if (c.name === "send_message") {
    const v = safeReply(i.text, { extraLinks: [] });
    if (!v.ok) return `I did not send it, because the message I wrote broke a safety rule (${v.why}). Tell me the exact wording and I will send that.`;
    message = v.text;
  } else return "I could not do that.";
  if (deps.windowClosed && (await deps.windowClosed(who.waId))) return `Their 24-hour WhatsApp window with ${label} has closed, so a free message cannot be sent. A template message is needed.`;
  try { await deps.send(who.waId, message); } catch (e) { return `The message to ${label} did not go through: ${clip(e.message, 120)}`; }
  return `Sent to ${label}:\n\n${message}`;
}

// ---------- The vendor welcome lives in rules.mjs ----------
export { vendorWelcome };

// ---------- 3. The hourly supervisor looks at one unanswered chat ----------
const REVIEW_TOOLS = [
  toolDef("send_vendor_welcome", "They are a vendor and never got the sign-up link. Sends the welcome with the link.", { name: str("First name if known"), business: str("Business name if known") }),
  toolDef("reply", "Send a short reply that answers their last message in context (never prices, availability, promises or links).", { text: str("The message to send") }, ["text"]),
  toolDef("flag_for_team", "A person needs to look at this chat.", { why: str("One short reason for the team") }, ["why"]),
  toolDef("nothing_needed", "The chat is fine: it was answered, or needs no answer.", { why: str("One short reason") }, ["why"]),
];
// Returns {kind: "vendor"|"reply"|"flag"|"fine", ...} or null.
export async function reviewChat({ channel = "WhatsApp", profileName = "", history = [], state = {} }) {
  const calls = await callTools({
    system: `You are the supervisor of Saffron Collective's front desk. Look at this chat, where the latest message from the person has not been answered. Decide the best next step and call exactly one tool. Fix it yourself only when it is clearly safe and obviously right; otherwise flag it for the team.\n\n${FACTS}\n\n${STYLE}`,
    messages: [{ role: "user", content: `Channel: ${channel}\nProfile name: ${profileName || "unknown"}\n\nWhat we know:\n${stateText(state)}\n\nChat so far (oldest first):\n${historyText(history)}` }],
    tools: REVIEW_TOOLS,
  });
  const c = calls?.[0];
  if (!c) return null;
  const i = c.input;
  if (c.name === "send_vendor_welcome") return { kind: "vendor", name: tidyName(i.name), business: tidyBusiness(i.business) };
  if (c.name === "reply") { const v = safeReply(i.text); return v.ok ? { kind: "reply", text: v.text } : { kind: "flag", why: `Draft reply was blocked (${v.why})` }; }
  if (c.name === "flag_for_team") return { kind: "flag", why: clip(i.why, 160) };
  return { kind: "fine", why: clip(i.why, 100) };
}
