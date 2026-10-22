import { decide, ESCALATION_ACK, CLIENT } from "../../lib/rules.mjs";
import { hardMoney, isPriceQuestion, priceAnswer, budgetLakhs, MIN_BUDGET_LAKHS } from "../../lib/facts.mjs";
import { guidesFor, guideText } from "../../lib/guides.mjs";
import { logNeedsTeam } from "../../lib/needsteam.mjs";
import { findNameCandidate, classify } from "../../lib/match.mjs";
import { countryOf } from "../../lib/phone.mjs";
import { sendSessionMessage, updateContactAttributes, getRecentMessages } from "../../lib/wati.mjs";
import { readChat } from "../../lib/team.mjs";
import { testAllows } from "../../lib/testmode.mjs";
import { draftReply, extractFields, draftOpening, draftAck, draftHold, classifySender } from "../../lib/claude.mjs";
import { lookupContact } from "../../lib/planning-studio.mjs";
import { allow } from "../../lib/state.mjs";
import { getContact, saveContact, AGENT_ECHO_MS } from "../../lib/contacts.mjs";
import { newState, advance, pendingQuestion, serviceLine, ORDER } from "../../lib/qualify.mjs";
import { calendarEnabled, offerSlots, bookConsult } from "../../lib/calendar.mjs";
import { startConsult, consultTurn, detailsText, fastTrack, wantsCall } from "../../lib/consult.mjs";
import { recordMedia, isMediaOnly, REF_THANKS, REF_NOTE, REF_OPEN } from "../../lib/media.mjs";
import { knownType } from "../../lib/known.mjs";
import { rowFields } from "../../lib/leadfields.mjs";
import { findLead, saveLead, live } from "../../lib/sheet.mjs";
import { GREETING } from "../../lib/rules.mjs";
import { incr } from "../../lib/metrics.mjs";

const HOUR = 3600_000;
// Wati names these inconsistently (sessionMessageSent, templateMessageSent_v2, ...). Delivery/read/replied status
// events (sentMessageDELIVERED_v2 etc.) are NOT a person speaking, so they are deliberately excluded.
const isSentEvent = (t) => /^(session|template)MessageSent(_v\d+)?$/i.test(String(t || ""));
const ok = (b = "ok") => new Response(b, { status: 200 }); // always 200 so Wati doesn't retry-storm

async function mediaRef(waId, name, label) {
  const c = await getContact(waId);
  if (c.esc || c.humanSpoke || c.kind === "vendor" || c.dnc || c.q?.stage === "done" || c.q?.stage === "paused") return;
  const kn = await knownType(waId);
  if (kn) return;
  const chat = await readChat(waId, c);
  if (chat?.teamSpoke) return;
  const m = recordMedia(c.mediaTimes);
  await saveContact(waId, { mediaTimes: m.times, refShared: true });
  if (m.burst) {
    await saveContact(waId, { ...(c.q ? { q: { ...c.q, stage: "paused" } } : {}), esc: true, escText: `[sent ${label}]`, escAt: Date.now() });
    await updateContactAttributes(waId, { needs_human: "true", needs_human_reason: "media-received" });
    console.log(`ESCALATE ${waId} (media-received): ${label}`);
    await logNeedsTeam({ waId, name: name, reason: "media-received", lastMsg: `[sent several files: ${label}]` });
    return;
  }
  const send = async (msg) => { await saveContact(waId, { agentSent: Date.now(), lastOut: Date.now() }); return sendSessionMessage(waId, msg); };
  if (!c.q) {
    // A photo and a message often arrive together; give the text a few seconds to answer first so the lead never gets two hellos.
    await new Promise((r) => setTimeout(r, 6000));
    const again = await getContact(waId);
    if (again.q || again.greeted || again.esc) return;
    if (await allow(`reply:${waId}:open`, 6 * HOUR)) { await saveContact(waId, { greeted: true }); await send(REF_OPEN); }
  } else if (["asking", "confirm", "call", "slots", "email"].includes(c.q.stage) && (await allow(`mediaack:${waId}`, 10 * 60_000))) {
    const again = c.q.stage === "asking" ? pendingQuestion(c.q) : "";
    await send(again ? `${REF_THANKS}\n\n${again}` : REF_THANKS);
  }
  return;
}

// Wati webhook. Subscribe to: Message Received, Session Message Sent, Template Message Sent.
//   https://<site>.netlify.app/.netlify/functions/wati-webhook?key=<WEBHOOK_SECRET>
export default async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== process.env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
  let evt;
  try { evt = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
  if (evt.id && !(await allow(`evt:${evt.eventType}:${evt.id}`, 6 * 3600_000))) return ok("duplicate"); // Wati retries
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

  // ---- Inbound media (photos, documents, voice notes). A reel or picture is usually a reference ("we want something like this"),
  // so the agent says thank you and carries on. Only a burst of files (a vendor sending a portfolio) pauses the chat for a person.
  if (evt.eventType === "message" && evt.owner === false && evt.type && evt.type !== "text") {
    await mediaRef(waId, evt.senderName || "", evt.type);
    return ok("media");
  }

  // ---- Inbound customer text ----
  const incoming = evt.eventType === "message" && evt.owner === false && evt.type === "text";
  if (!incoming || !evt.text) return ok("ignored");
  const text = String(evt.text);
  const name = evt.senderName || "";
  if (isMediaOnly(text)) { await mediaRef(waId, name, "link"); return ok("link reference"); } // a pasted reel or Pinterest link

  const agentSend = async (msg) => {
    await saveContact(waId, { agentSent: Date.now(), lastOut: Date.now() });
    return sendSessionMessage(waId, msg);
  };
  const toHuman = async (reason, ack = true) => {
    await saveContact(waId, { esc: true, escText: text.slice(0, 160), escAt: Date.now() });
    await updateContactAttributes(waId, { needs_human: "true", needs_human_reason: reason });
    if (ack && (await allow(`ack:${waId}`, 6 * HOUR))) await agentSend((await draftHold({ text, name })) || ESCALATION_ACK);
    await incr("escalations");
    console.log(`ESCALATE ${waId} (${reason}): ${text.slice(0, 120)}`);
    await logNeedsTeam({ waId, name, reason, lastMsg: text, reply: ack ? "(holding reply sent)" : "" });
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

    // 1a. Numbers listed on the "Known Contacts" tab (vendor, client, team, ignore) never get the new-client questions.
    const known = await knownType(waId);
    if (known?.type === "team" || known?.type === "ignore") return ok();
    if (known?.type === "vendor" || known?.type === "client") {
      await saveContact(waId, { humanSpoke: true, ...(known.type === "vendor" ? { kind: "vendor" } : {}) });
      await toHuman(`known-${known.type}`, false);
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

    const inFlow = ["asking", "confirm", "call", "slots", "email"].includes(c.q?.stage);
    const isVendor = c.kind === "vendor" || contact?.kind === "vendor";
    const canQualify = !c.humanSpoke && !c.esc && !isVendor && c.q?.stage !== "done";

    // 2. Money is always for a human. (During the question flow only money counts: "date" and "book" are normal words there.)
    // Availability or booking questions are also for a human. A bare "date" is not (new leads say it all the time).
    // EXCEPTION: a brand-new lead whose first message mentions pricing ("would love to explore planning, can we discuss pricing?")
    // still gets a warm, tailored welcome and the questions; the team is flagged to handle the pricing part.
    // Asking our fee is answered from the website (fixed wording); a volunteered budget is noted. Payment, discount, contract
    // and availability questions are still for a person.
    const priceQ = isPriceQuestion(text);
    const guides = guidesFor(text); // a page on the website answers this in detail: share the link
    const moneyish = (hardMoney(text) && !guides.length) || (!inFlow && /\b(available|availability|book|booking)\b/i.test(text));
    const firstTouch = canQualify && !inFlow && !c.q && !CLIENT.test(text) && d.intent !== "vendor_signup";
    if (moneyish && !firstTouch) {
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
      // A bare "Hi" from a number we do not know could be a client, a vendor or anyone: ask how we can help first.
      if (firstTouch && GREETING.test(text)) {
        if (await allow(`reply:${waId}:open`, 6 * HOUR)) {
          await saveContact(waId, { greeted: true });
          await agentSend("Hello!\n\nThank you for reaching out to Saffron Collective 🌼\n\nHow can we help you today?");
          await incr("open_greetings");
        }
        return ok();
      }
      // First real message: work out who is writing. Only a likely new client gets the questions; vendors and unclear go to a person.
      if (firstTouch) {
        const who = await classifySender({ text, name });
        if (who !== "client") {
          if (who === "vendor") await saveContact(waId, { kind: "vendor" });
          await toHuman(who === "vendor" ? "looks-like-vendor" : "who-is-this");
          return ok();
        }
      }
      const country = countryOf(waId);
      if (!c.country) await saveContact(waId, { country: country.name });
      let q = c.q;
      let known = null;
      if (!q) {
        known = await findLead(waId); // did they start on Instagram? (same number: certain)
        q = newState(known ? rowFields(known.row) : {}, known ? "Instagram" : "WhatsApp");
        if (!known) {
          const cand = await findNameCandidate(name); // same name on Instagram: only a hint until the lead confirms
          if (cand) q.cand = cand;
        }
        await incr(known ? "wa_continued_from_ig" : "wa_leads_started");
      }

      if (c.refShared && !q.refNoted) { q = { ...q, refNoted: true, notes: [q.notes, REF_NOTE].filter(Boolean).join(" / ") }; }
      if (c.greeted && !q.greeted) q = { ...q, greeted: true };

      // Answer to "Have you been in touch with us on Instagram before?"
      let dupAnswered = false;
      if (q.dupAsk) {
        const yes = /^\s*(yes|yeah|yep|yup|haan|ha|i did|we did|i have|we have|sure)\b/i.test(text);
        const no = /^\s*(no|nope|nahi|first time|not before)\b/i.test(text);
        q = { ...q, dupAsk: false };
        if (yes && q.cand) {
          for (const k of Object.keys(q.cand.fields || {})) if (q.cand.fields[k] && !q.fields[k]) q.fields[k] = q.cand.fields[k];
          q.source = "Instagram";
          q.notes = [q.notes, `Same person as Instagram row ${q.cand.rowNumber} (confirmed by lead)`].filter(Boolean).join(" / ");
        }
        if (yes || no) { q.dupResolved = true; delete q.cand; dupAnswered = true; }
      }

      const asking = q.stage === "new" || q.stage === "asking";
      const extracted = q.stage === "asking" || q.stage === "new" ? (!GREETING.test(text) && !dupAnswered ? await extractFields(text, q.asked) : {}) : {};
      let opener = "";
      if (firstTouch && !GREETING.test(text)) opener = (await draftOpening({ text, name, greeted: c.greeted })) || "";
      const pre = asking && !dupAnswered ? [priceQ ? priceAnswer(text) : "", guides.length ? guideText(guides) : ""].filter(Boolean).join("\n\n") : "";
      if (guides.length && ["confirm", "call"].includes(q.stage) && (await allow(`guide:${waId}:${guides[0].url}`, 6 * HOUR))) {
        await agentSend(guideText(guides)); await incr("guide_links_sent"); return ok(); // after the summary: just the link, state unchanged
      }
      // Booking the Founders' call: they choose a time, then give an email, then the event is created.
      const consultDeps = { waId, offer: () => offerSlots(), book: (a) => bookConsult({ ...a, name, source: "WhatsApp", details: detailsText(a.fields) }) };
      if (["slots", "email"].includes(q.stage) && calendarEnabled()) {
        const cr = await consultTurn(q, text, consultDeps);
        if (cr) {
          if (cr.kind === "escalate") { await toHuman("lead-question"); return ok(); }
          const nq = cr.booked ? { ...cr.q, notes: [cr.q.notes, `Call booked: ${cr.booked.label} (${cr.q.callPref === "phone" ? "phone" : "Meet"})`].filter(Boolean).join(" / ") } : cr.q;
          await saveContact(waId, { q: nq });
          await saveLead(waId, name, nq, { notes: nq.notes, country: country.name });
          await agentSend(cr.reply);
          if (cr.booked) await incr("calls_booked");
          if (cr.escalate) await toHuman(cr.escalate, false);
          return ok();
        }
      }
      // They opened by asking to talk: offer times straight away (no questions, no price list), the way a person would.
      if (firstTouch && !dupAnswered && calendarEnabled() && wantsCall(text) && !GREETING.test(text)) {
        try {
          const fields = { ...q.fields, number: `+${waId}` };
          for (const k of ORDER) if (extracted[k]) fields[k] = String(extracted[k]).slice(0, 80);
          const ft = await fastTrack({ ...q, fields }, { name, svc: serviceLine(text), deps: consultDeps });
          if (ft) {
            const nq = { ...ft.q, notes: [ft.q.notes, "Asked for a call in their first message"].filter(Boolean).join(" / ") };
            await saveContact(waId, { q: nq });
            await saveLead(waId, name, nq, { notes: nq.notes, country: country.name });
            await agentSend(ft.reply);
            await incr("calls_requested");
            return ok();
          }
        } catch (e) { console.error("fast-track call offer failed:", e.message); }
      }
      let r = advance(q, dupAnswered ? "" : text, extracted, name, opener, "", pre);
      // A personal reaction only where it adds something: their location, an extra detail they added, or a vague/unsure answer.
      // Everywhere else the next question simply follows, so it never feels over-done.
      const worthReacting = q.asked === "location" || r.kind === "addition" || /\b(not sure|don'?t know|maybe|undecided|tbd|haven'?t decided|pata nahi|abhi nahi)\b/i.test(text);
      if (!firstTouch && !dupAnswered && !pre && worthReacting && ["ask", "summary", "addition"].includes(r.kind) && !GREETING.test(text)) {
        const ack = await draftAck({ text, name, kind: r.kind, asked: q.asked, fields: r.q.fields });
        if (ack) r = advance(q, text, extracted, name, opener, ack);
      }

      if (r.kind === "escalate") { await toHuman("lead-question"); return ok(); }
      if (r.kind === "call-pref" && calendarEnabled()) { // offer real times; if that fails the team does it by hand, as before
        try {
          const sc = await startConsult({ ...r.q, fields: { ...r.q.fields, number: `+${waId}` } }, consultDeps);
          if (sc) { r = sc; await incr("calls_requested"); }
        } catch (e) { console.error("offering call times failed:", e.message); }
      }

      // Same name as an Instagram lead plus the same date or city: ask the person, never assume.
      if (r.q.cand && !r.q.dupResolved) {
        const level = classify(name, r.q.fields, r.q.cand);
        if (level === "probable" && !r.q.dupAsked && r.kind === "ask") {
          r = { q: { ...r.q, dupAsk: true, dupAsked: true }, kind: "dup-ask", reply: "Have you been in touch with us on Instagram before?" };
        } else if (r.kind === "summary" && level !== "none") {
          await logNeedsTeam({ waId, name, reason: "possible-duplicate", lastMsg: `Instagram row ${r.q.cand.rowNumber}: ${r.q.cand.name}` });
          r.q.notes = [r.q.notes, `Possible duplicate of Instagram row ${r.q.cand.rowNumber}`].filter(Boolean).join(" / ");
          r.q.dupResolved = true;
        }
      }

      // A budget they mention is noted, never questioned. Under about ₹40 lakh is flagged quietly for your team; the lead is not told.
      const amount = budgetLakhs(text);
      if (amount !== null && (await allow(`budget:${waId}`, 24 * HOUR))) {
        r.q.notes = [r.q.notes, `Budget mentioned: ${text.slice(0, 80)}`].filter(Boolean).join(" / ");
        if (amount < MIN_BUDGET_LAKHS) await logNeedsTeam({ waId, name, reason: "budget-under-40L", lastMsg: text });
      }

      await saveContact(waId, { q: r.q });
      await saveLead(waId, name, r.q, { confirmed: r.kind === "confirmed", notes: r.kind === "addition" || r.q.notes ? r.q.notes : undefined, country: country.name });
      await agentSend(r.reply);
      if (pre) await incr("price_answers");
      if (r.kind === "summary") await incr("wa_leads_completed");
      if (r.kind === "confirmed") await incr("wa_leads_confirmed");
      if (r.kind === "call-pref") { await incr("calls_requested"); await toHuman("ready-for-call", false); } // the team sends times
      else if (r.kind === "addition") await toHuman("lead-added-details", false); // a person should read what they added
      else if (firstTouch && moneyish) await toHuman("pricing-or-availability-question", false); // flag the team; the flow carries on
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
