import { decide, ESCALATION_ACK, MONEY, CLIENT } from "../../lib/rules.mjs";
import { sendSessionMessage, updateContactAttributes, getRecentMessages } from "../../lib/wati.mjs";
import { readChat } from "../../lib/team.mjs";
import { testAllows } from "../../lib/testmode.mjs";
import { draftReply, extractFields } from "../../lib/claude.mjs";
import { lookupContact } from "../../lib/planning-studio.mjs";
import { allow } from "../../lib/state.mjs";
import { getContact, saveContact, AGENT_ECHO_MS } from "../../lib/contacts.mjs";
import { newState, advance } from "../../lib/qualify.mjs";
import { rowFields } from "../../lib/leadfields.mjs";
import { findLead, saveLead, live } from "../../lib/sheet.mjs";
import { GREETING } from "../../lib/rules.mjs";
import { incr } from "../../lib/metrics.mjs";

const HOUR = 3600_000;
// Wati names these inconsistently (sessionMessageSent, templateMessageSent_v2, ...). Delivery/read/replied status
// events (sentMessageDELIVERED_v2 etc.) are NOT a person speaking, so they are deliberately excluded.
const isSentEvent = (t) => /^(session|template)MessageSent(_v\d+)?$/i.test(String(t || ""));
const ok = (b = "ok") => new Response(b, { status: 200 }); // always 200 so Wati doesn't retry-storm

// Wati webhook. Subscribe to: Message Received, Session Message Sent, Template Message Sent.
//   https://<site>.netlify.app/.netlify/functions/wati-webhook?key=<WEBHOOK_SECRET>
export default async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== process.env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
  let evt;
  try { evt = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
  if (evt.id && !(await allow(`evt:${evt.eventType}:${evt.id}`, 6 * 3600_000))) return ok("duplicate");
  if (process.env.DEBUG_EVENTS === "true") {
    // Temporary diagnostics: shows how Wati labels each event (team replies vs customer messages).
    const { text, ...rest } = evt;
    console.log("wati evt:", JSON.stringify({ ...rest, textStart: String(text ?? "").slice(0, 25), textLen: String(text ?? "").length }).slice(0, 1500));
  }
  if (!evt.waId) return ok("ignored");
  if (!isSentEvent(evt.eventType) && evt.eventType !== "message") console.log("wati event ignored:", evt.eventType);
  const waId = String(evt.waId);
  if (!testAllows({ waId })) return ok("test mode: ignored");

  // ---- Outbound (our team, the Business App, or the agent) ----
  const isOutbound = isSentEvent(evt.eventType) || (evt.eventType === "message" && evt.owner === true);
  if (isOutbound) {
    const c = await getContact(waId);
    // Shortly after the agent's own send it's the agent echoing; otherwise a person spoke.
    if (Date.now() - (c.agentSent || 0) > AGENT_ECHO_MS) {
      await saveContact(waId, { humanSpoke: true, esc: false, lastOut: Date.now() });
    }
    return ok();
  }

  // ---- Inbound customer text ----
  const incoming = evt.eventType === "message" && evt.owner === false && evt.type === "text";
  if (!incoming || !evt.text) return ok("ignored");
  const text = String(evt.text);
  const name = evt.senderName || "";

  const agentSend = async (msg) => {
    await saveContact(waId, { agentSent: Date.now(), lastOut: Date.now() });
    return sendSessionMessage(waId, msg);
  };
  const toHuman = async (reason, ack = true) => {
    await saveContact(waId, { esc: true, escText: text.slice(0, 160), escAt: Date.now() });
    await updateContactAttributes(waId, { needs_human: "true", needs_human_reason: reason });
    if (ack && (await allow(`ack:${waId}`, 6 * HOUR))) await agentSend(ESCALATION_ACK);
    await incr("escalations");
    console.log(`ESCALATE ${waId} (${reason}): ${text.slice(0, 120)}`);
  };

  try {
    const c = await saveContact(waId, { lastIn: Date.now(), followups: 0, name }); // a reply resets quiet follow-ups
    const contact = await lookupContact(waId); // null until Planning Studio is wired
    const d = decide(text, { name: contact?.name || name, isVendor: contact?.kind === "vendor" });

    // 1. Opt-out always wins.
    if (d.action === "optout") {
      await saveContact(waId, { dnc: true });
      await updateContactAttributes(waId, { do_not_contact: "true" });
      await incr("opt_outs");
      if (await allow(`optout:${waId}`, 24 * HOUR)) await agentSend(d.text);
      return ok();
    }

    // 1b. If your team has already spoken in this chat (Business App, Wati inbox), the agent stays out and a person answers.
    // Wati does not send Business-App messages to the webhook, so this reads the stored chat history instead.
    // If the history cannot be read, the agent fails safe and hands over to the team when live.
    const chat = await readChat(waId, c);
    if (chat?.teamSpoke || (!chat && live())) {
      await saveContact(waId, { humanSpoke: chat?.teamSpoke ? true : c.humanSpoke, ...(chat ? { lastOut: chat.lastOutAt || c.lastOut } : {}) });
      await toHuman(chat ? "team-already-in-chat" : "history-unavailable", false);
      return ok();
    }
    if (!chat) console.warn("chat history unavailable; continuing because DRY_RUN");

    const inFlow = c.q?.stage === "asking" || c.q?.stage === "confirm";
    const isVendor = c.kind === "vendor" || contact?.kind === "vendor";
    const canQualify = !c.humanSpoke && !c.esc && !isVendor && c.q?.stage !== "done";

    // 2. Money is always for a human. (During the question flow only money counts: "date" and "book" are normal words there.)
    // Availability or booking questions are also for a human. A bare "date" is not (new leads say it all the time).
    if (MONEY.test(text) || (!inFlow && /\b(available|availability|book|booking)\b/i.test(text))) {
      await toHuman("money-or-commitment");
      return ok();
    }

    // 2b. Someone who says they are already a client (often writing from another number): a person answers.
    if (CLIENT.test(text)) {
      await toHuman("existing-client");
      return ok();
    }

    // 3. Vendor asking for work: sign-up link. Mid-flow, only an unmistakable offer of services ("I am a photographer",
    // "I want to work with you") switches the chat to the vendor link; ordinary answers like "decoration" never do.
    if (d.intent === "vendor_signup" && (!inFlow || d.strong)) {
      await saveContact(waId, { kind: "vendor", ...(c.q ? { q: { ...c.q, stage: "done" } } : {}) });
      if (await allow(`reply:${waId}:vendor_signup`, 6 * HOUR)) {
        await agentSend(d.text);
        await incr("vendor_links_sent");
      }
      return ok();
    }

    // 4. A lead on WhatsApp: ask the four questions, record the answers, confirm.
    if (canQualify || inFlow) {
      let q = c.q;
      let known = null;
      if (!q) {
        known = await findLead(waId); // did they start on Instagram?
        q = newState(known ? rowFields(known.row) : {}, known ? "Instagram" : "WhatsApp");
        await incr(known ? "wa_continued_from_ig" : "wa_leads_started");
      }
      const extracted = q.stage !== "confirm" && !GREETING.test(text) ? await extractFields(text, q.asked) : {};
      const r = advance(q, text, extracted, name);

      if (r.kind === "escalate") { await toHuman("lead-question"); return ok(); }

      await saveContact(waId, { q: r.q });
      await saveLead(waId, name, r.q, { confirmed: r.kind === "confirmed", notes: r.kind === "addition" ? r.q.notes : undefined });
      await agentSend(r.reply);
      if (r.kind === "summary") await incr("wa_leads_completed");
      if (r.kind === "confirmed") await incr("wa_leads_confirmed");
      if (r.kind === "addition") await toHuman("lead-added-details", false); // a person should read what they added
      return ok();
    }

    // 5. Everyone else: simple rules, then Claude for light replies, otherwise a human.
    let out = d;
    if (d.action === "escalate" && d.reason === "unclear" && process.env.ANTHROPIC_API_KEY) {
      const history = (await getRecentMessages(waId)) || [];
      const cl = await draftReply({ text, name: contact?.name || name, history });
      if (cl?.reply) out = { action: "reply", intent: `claude_${cl.category}`, text: cl.reply };
      else if (cl?.reason) out = { action: "escalate", reason: cl.reason };
    }
    if (out.action === "reply") {
      if (await allow(`reply:${waId}:${out.intent}`, 6 * HOUR)) await agentSend(out.text);
    } else {
      await toHuman(out.reason || "unclear");
    }
  } catch (e) {
    console.error("webhook error", e);
  }
  return ok();
};
