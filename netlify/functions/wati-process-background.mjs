import { decide, ESCALATION_ACK, CLIENT, vendorWelcome, vendorReminder, jobReply, RESUME_FILE } from "../../lib/rules.mjs";
import { operatorOn, routeMessage, ownerCommand, isOwner, COMMAND_PREFIX } from "../../lib/operator.mjs";
import { ownerDeps } from "../../lib/operatordeps.mjs";
import { hardMoney, isPriceQuestion, priceAnswer, budgetLakhs, MIN_BUDGET_LAKHS } from "../../lib/facts.mjs";
import { guidesFor, guideText } from "../../lib/guides.mjs";
import { logNeedsTeam } from "../../lib/needsteam.mjs";
import { findNameCandidate, classify } from "../../lib/match.mjs";
import { countryOf, extractPhone } from "../../lib/phone.mjs";
import { recordQuestion, answerFromPlaybook, logExchange } from "../../lib/playbook.mjs";
import { sendSessionMessage, updateContactAttributes, getRecentMessages } from "../../lib/wati.mjs";
import { readChat } from "../../lib/team.mjs";
import { testAllows } from "../../lib/testmode.mjs";
import { draftReply, extractFields, understandChat, draftOpening, draftAck, draftHold, draftAfter, classifySenderDetail } from "../../lib/claude.mjs";
import { lookupContact } from "../../lib/planning-studio.mjs";
import { allow } from "../../lib/state.mjs";
import { getContact, saveContact, AGENT_ECHO_MS } from "../../lib/contacts.mjs";
import { holdContact } from "../../lib/qualify.mjs";
import { introReply } from "../../lib/rules.mjs";
import { isRepeatOut, isNearRepeat, oneEmoji, paragraphs } from "../../lib/understand.mjs";
import { checkOutgoing } from "../../lib/guard.mjs";
import { withoutCurrent } from "../../lib/igapi.mjs";
import { newState, advance, pendingQuestion, serviceLine, ORDER, doneContext, applyAfter, CORRECTION } from "../../lib/qualify.mjs";
import { calendarEnabled, offerSlots, bookConsult, moveConsult, addGuest, slotStillFree } from "../../lib/calendar.mjs";
import { recordCall, callRecord, getCall, touchCall } from "../../lib/calls.mjs";
import { missedReply, closeText } from "../../lib/missed.mjs";
import { startConsult, consultTurn, detailsText, fastTrack, wantsCall, extractEmail, wantsReschedule, wantsCancel, startReschedule, addLateContact } from "../../lib/consult.mjs";
import { recordMedia, isMediaOnly, REF_THANKS, REF_NOTE, refOpen, greetingText, skipMediaWelcome } from "../../lib/media.mjs";
import { greetName } from "../../lib/leadfields.mjs";
import { knownType } from "../../lib/known.mjs";
import { rowFields } from "../../lib/leadfields.mjs";
import { findLead, saveLead, live } from "../../lib/sheet.mjs";
import { GREETING } from "../../lib/rules.mjs";
import { incr } from "../../lib/metrics.mjs";
import { acquireLock } from "../../lib/lock.mjs";

const HOUR = 3600_000;
// Wati names these inconsistently (sessionMessageSent, templateMessageSent_v2, ...). Delivery/read/replied status
// events (sentMessageDELIVERED_v2 etc.) are NOT a person speaking, so they are deliberately excluded.
const isSentEvent = (t) => /^(session|template)MessageSent(_v\d+)?$/i.test(String(t || ""));
const ok = (b = "ok") => new Response(b, { status: 200 }); // always 200 so Wati doesn't retry-storm

// A photo, reel or link on its own. Every one starts its own background run, so they all race: each one takes the chat's lock, reads the chat
// again and only then decides. A vendor (or anyone already welcomed, handed over or answered) gets nothing from this path.
async function mediaRef(waId, name, label) {
  const first = await getContact(waId);
  if (skipMediaWelcome(first)) return;
  // A photo and a message often arrive together; give the text a few seconds to answer first so the lead never gets two hellos.
  if (!first.q) await new Promise((r) => setTimeout(r, 6000));
  const lock = await acquireLock(`wa:${waId}`);
  try {
    const c = await getContact(waId);
    if (skipMediaWelcome(c)) return; // a vendor, a hand-over, or someone already welcomed or answered: a photo needs no hello
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
    const send = async (msg) => {
      msg = paragraphs(oneEmoji(msg));
      if (isRepeatOut(c.lastOutText, c.lastOut, msg)) { console.log(`${waId}: media reply skipped, it would repeat our last message`); return; }
      await saveContact(waId, { agentSent: Date.now(), lastOut: Date.now(), lastOutText: String(msg).slice(0, 600) });
      return sendSessionMessage(waId, msg);
    };
    if (!c.q) {
      if (await allow(`reply:${waId}:open`, 6 * HOUR)) { await saveContact(waId, { greeted: true }); await send(refOpen(greetName(name))); }
    } else if (["asking", "confirm", "call", "slots", "email"].includes(c.q.stage) && (await allow(`mediaack:${waId}`, 10 * 60_000))) {
      const again = c.q.stage === "asking" ? pendingQuestion(c.q) : "";
      await send(again ? `${REF_THANKS}\n\n${again}` : REF_THANKS);
    }
  } finally { await lock.release(); }
}

// Wati webhook. Subscribe to: Message Received, Session Message Sent, Template Message Sent.
//   https://<site>.netlify.app/.netlify/functions/wati-webhook?key=<WEBHOOK_SECRET>
export default async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== process.env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
  let evt;
  try { evt = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
  if (evt.id && !(await allow(`evt:${evt.eventType}:${evt.id}`, 6 * 3600_000))) return ok("duplicate"); // Wati retries
  if (process.env.DEBUG_EVENTS === "true") {
    // Temporary diagnostics: shows how Wati labels each event (team replies vs customer messages).
    const { text, ...rest } = evt;
    console.log("wati evt:", JSON.stringify({ ...rest, textStart: String(text ?? "").slice(0, 25), textLen: String(text ?? "").length }).slice(0, 1500));
  }
  if (!evt.waId) return ok("ignored");
  if (!isSentEvent(evt.eventType) && evt.eventType !== "message") console.log("wati event ignored:", evt.eventType);
  const waId = String(evt.waId);
  // An order from you or your team ("agent, resend the vendor link to Tanmay"): carried out, and the answer comes back to you.
  if (operatorOn() && evt.eventType === "message" && evt.owner === false && evt.type === "text" && isOwner(waId) && COMMAND_PREFIX.test(String(evt.text || ""))) {
    try {
      const answer = await ownerCommand({ text: String(evt.text), deps: ownerDeps });
      await sendSessionMessage(waId, answer);
    } catch (e) { console.error("owner command failed:", e.message); }
    return ok("owner command");
  }
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
  // A file or photo that comes with words (a caption) is read like any other message: the words are what the lead said (Abdur: a resume with
  // "I work as freelancer" got the plain photo welcome). A file named like a CV is noted as "[sent a resume]". Only a file with no words goes to mediaRef.
  if (evt.eventType === "message" && evt.owner === false && evt.type && evt.type !== "text") {
    const caption = String(evt.text || "").trim();
    const fileHint = String(evt.fileName || evt.filename || evt.mediaFileName || evt.data || "");
    const resume = RESUME_FILE.test(fileHint);
    console.log(`wati-media: type=${evt.type} caption=${caption.length} chars, fileName=${fileHint ? "given" : "none"}, resume=${resume}`); // lengths only
    if (caption || resume) evt = { ...evt, type: "text", text: [caption, resume ? "[sent a resume]" : ""].filter(Boolean).join("\n") };
    else { await mediaRef(waId, evt.senderName || "", evt.type); return ok("media"); }
  }

  // ---- Inbound customer text ----
  const incoming = evt.eventType === "message" && evt.owner === false && evt.type === "text";
  if (!incoming || !evt.text) return ok("ignored");
  const text = String(evt.text);
  const name = evt.senderName || "";
  const who = greetName(name); // first name for greetings, only when the profile name looks like a person
  if (isMediaOnly(text)) { await mediaRef(waId, name, "link"); return ok("link reference"); } // a pasted reel or Pinterest link

  let pendingAsk = ""; // the question we were waiting for, repeated after a taught answer
  // Never say the same thing twice in a row: a repeated message means the agent has not understood, so a person takes over instead.
  let stopping = false;
  const agentSend = async (msg, { repeatOk = false, near = false } = {}) => {
    msg = paragraphs(oneEmoji(msg));
    if (!stopping) { // the last check: the same types of mistake Swati has already reported (lib/guard.mjs, docs/LESSONS.md)
      const prev0 = await getContact(waId);
      const g = checkOutgoing({ msg, lastIn: text, prev: prev0, repeatOk });
      if (g.action === "skip") { console.log(`${waId}: guard skipped a message (${g.code}): ${g.why}`); await incr("guard_stopped"); return; }
      if (g.action === "handover") {
        stopping = true;
        await incr("guard_stopped");
        console.log(`${waId}: guard stopped a message (${g.code}): ${g.why}; handing over instead`);
        await toHuman("message-blocked", true);
        return;
      }
      msg = g.msg;
    }
    if (!repeatOk && !stopping) {
      const prev = await getContact(waId);
      // A vendor, or a reply that only rephrases what we just said: skip it quietly, no hand-over message on top.
      if ((vendorChat || near) && (isRepeatOut(prev.lastOutText, prev.lastOut, msg) || isNearRepeat(prev.lastOutText, prev.lastOut, msg))) { console.log(`${waId}: skipped a reply that repeats our last message`); await incr("repeats_stopped"); return; }
      if (isRepeatOut(prev.lastOutText, prev.lastOut, msg)) {
        stopping = true;
        await incr("repeats_stopped");
        console.log(`${waId}: would repeat our last message; handing over instead`);
        await toHuman("repeating-itself", true);
        return;
      }
    }
    await logExchange({ channel: "WhatsApp", contact: `+${waId}`, lead: text, agent: msg });
    await saveContact(waId, { agentSent: Date.now(), lastOut: Date.now(), lastOutText: String(msg).slice(0, 600) });
    return sendSessionMessage(waId, msg);
  };
  const consultDeps = { waId, offer: (req) => offerSlots(req), move: (a) => moveConsult(a), addGuest: (a) => addGuest({ ...a, name }), stillFree: (a) => slotStillFree({ ...a, name }), book: (a) => bookConsult({ ...a, name, source: "WhatsApp", details: detailsText(a.fields) }) };
  // Remember a booked (or moved) call so the lead is reminded. On WhatsApp their number is the chat itself.
  const keepCall = async (q, booked, id) => {
    try { await recordCall(callRecord({ id: id || `wa-${waId}-${booked.start}`, start: booked.start, label: booked.label, name, number: waId, channel: "WhatsApp", pref: q.callPref, meetLink: q.callBooked?.meetLink })); } catch (e) { console.warn("keepCall:", e.message); }
  };
  let vendorChat = false, leadQ = null; // set once the chat is loaded; used to give every real lead a row, even one who asks a question and goes quiet
  const ROW_REASONS = new Set(["lead-question", "money-or-commitment", "pricing-or-availability-question", "call-time-request"]);
  const toHuman = async (reason, ack = true, hold = "") => {
    if (reason === "lead-question") { // an answer you have already taught the agent is used before anyone is bothered
      const taught = await answerFromPlaybook(text);
      if (taught) {
        await agentSend(pendingAsk ? `${taught}\n\n${pendingAsk}` : taught); await incr("playbook_answers"); return;
      }
      await recordQuestion({ channel: "WhatsApp", text });
    }
    await saveContact(waId, { esc: true, escText: text.slice(0, 160), escAt: Date.now() });
    await updateContactAttributes(waId, { needs_human: "true", needs_human_reason: reason });
    if (ack && (await allow(`ack:${waId}`, 6 * HOUR))) await agentSend(hold || (await draftHold({ text, name: who })) || ESCALATION_ACK);
    await incr("escalations");
    console.log(`ESCALATE ${waId} (${reason}): ${text.slice(0, 120)}`);
    await logNeedsTeam({ waId, name, reason, lastMsg: text, reply: ack ? "(holding reply sent)" : "" });
    if (ROW_REASONS.has(reason) && !vendorChat) await saveLead(waId, name, leadQ || { fields: {}, stage: "new" }, { notes: `Asked: ${text.slice(0, 120)}`, country: countryOf(waId).name });
  };

  // What the operator (Claude) decided for a message outside the question flow. Returns true when it has been dealt with.
  const HANDOVER_REASON = { money: "money-or-commitment", existing_client: "existing-client", complaint: "complaint", unclear: "who-is-this", other: "unclear" };
  // A CV or a job enquiry: a fixed thank-you, no vendor link, the team is told, and the chat is left alone afterwards.
  const jobSeekerNow = async (who0) => {
    await saveContact(waId, { kind: "vendor", jobSeeker: true, greeted: true });
    if (await allow(`reply:${waId}:job`, 24 * HOUR)) { await agentSend(jobReply({ name: who0 || who })); await incr("job_enquiries"); }
    await logNeedsTeam({ waId, name, reason: "job-enquiry", lastMsg: text, reply: "(thank-you sent, no link)" });
  };
  const applyRoute = async (act) => {
    if (act.kind === "job") { await jobSeekerNow(act.name); return true; }
    if (act.kind === "vendor") { // a vendor gets a greeting and the sign-up link, like any other vendor
      await saveContact(waId, { kind: "vendor" });
      if (await allow(`reply:${waId}:vendor_signup`, 6 * HOUR)) { await agentSend(vendorWelcome({ name: act.name || who, business: act.business })); await incr("vendor_links_sent"); }
      await logNeedsTeam({ waId, name, reason: "looks-like-vendor", lastMsg: text, reply: "(vendor sign-up link sent)" });
      return true;
    }
    if (act.kind === "intro") { // someone new at a business we probably already work with: a thank-you, no link, and the team updates the vendor record
      await saveContact(waId, { kind: "vendor", greeted: true });
      if (await allow(`reply:${waId}:intro`, 6 * HOUR)) { await agentSend(introReply({ name: act.name || who, business: act.business })); await incr("vendor_intros"); }
      await logNeedsTeam({ waId, name, reason: "vendor-contact-change", lastMsg: text, reply: "(thank-you sent, no link)" });
      return true;
    }
    if (act.kind === "open") { // we cannot tell what they want yet: the fixed welcome asks how we can help
      await saveContact(waId, { greeted: true });
      if (await allow(`reply:${waId}:open`, 6 * HOUR)) { await agentSend(greetingText(who)); await incr("open_greetings"); }
      else await toHuman("who-is-this", false); // still unclear after we asked: a person should look
      return true;
    }
    if (act.kind === "reply") {
      await saveContact(waId, { greeted: true });
      if (await allow(`reply:${waId}:operator`, vendorChat ? 3 * HOUR : 20_000)) { await agentSend(act.text, { near: true }); await incr("operator_replies"); }
      return true;
    }
    if (act.kind === "handover") { await toHuman(HANDOVER_REASON[act.reason] || "unclear", true, act.hold); return true; }
    if (act.kind === "quiet") { console.log(`operator stayed quiet for ${waId}: ${act.why}`); return true; }
    return false;
  };

  const lock = await acquireLock(`wa:${waId}`); // one message at a time per chat; a quick follow-up waits for the one before it
  try {
    const c = await saveContact(waId, { lastIn: Date.now(), followups: 0, nudges: 0, name }); // a reply resets quiet follow-ups and nudges
    pendingAsk = c.q?.stage === "asking" ? pendingQuestion(c.q) : "";
    leadQ = c.q || null;
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
    // A lead answering our missed-call question: we wrote to them, so their answer is read here even though the team wrote in this chat earlier
    // ("tried calling you"). Only if a person has written since our question does the person take over. (lib/missed.mjs, docs/LESSONS.md L25)
    const mc = c.missed;
    const missedOpen = Boolean(mc && ["asked", "offered"].includes(mc.state) && chat && !(chat.lastTeamAt > mc.askedAt));
    if (!missedOpen && (chat?.teamSpoke || (!chat && live()))) {
      await saveContact(waId, { humanSpoke: chat?.teamSpoke ? true : c.humanSpoke, ...(chat ? { lastOut: chat.lastOutAt || c.lastOut } : {}) });
      await toHuman(chat ? "team-already-in-chat" : "history-unavailable", false);
      return ok();
    }
    if (!chat) console.warn("chat history unavailable; continuing because DRY_RUN");
    if (c.jobSeeker) return ok(); // already thanked: a person reads the rest
    if (missedOpen && mc.state === "asked") {
      const r = missedReply(text);
      const call = await getCall(mc.callId);
      const follow = (state) => call ? touchCall(call.id, { follow: { ...(call.follow || {}), state } }) : null;
      if (r === "no") {
        await saveContact(waId, { missed: { ...mc, state: "declined" } });
        await follow("declined");
        await agentSend(closeText(who));
        await incr("missed_declined");
        return ok();
      }
      const eventId = call && !/^(wa|ig)-/.test(call.id) ? call.id : "";
      const base = c.q || newState({}, "WhatsApp");
      const q0 = call ? { ...base, stage: "done", callPref: call.pref || base.callPref || "meet", missedCall: { label: call.label }, fields: { ...(base.fields || {}), ...(base.fields?.number ? {} : { number: `+${waId}` }) }, callBooked: { eventId, start: call.start, label: call.label, meetLink: base.callBooked?.meetLink || "", email: base.callBooked?.email || "", pref: call.pref || "meet" } } : null;
      if (r === "yes" && call && eventId && calendarEnabled()) {
        // The same calendar event is moved to the new time (no second event). A day or time they named is used.
        const rs = await startReschedule(q0, text, consultDeps);
        if (rs) {
          await saveContact(waId, { q: rs.q, humanSpoke: false, missed: { ...mc, state: "offered" } });
          await follow("offered");
          await agentSend(rs.reply);
          await incr("missed_replied_yes");
          return ok();
        }
      }
      if (r === "yes" || !q0) {
        // They want another time but the call cannot be moved from here: a person answers.
        await saveContact(waId, { missed: { ...mc, state: "handed" } });
        await follow("handed");
        await toHuman(r === "yes" ? "call-time-request" : "lead-question");
        return ok();
      }
      // Anything else ("who is this?", "I was travelling, what was it about?"): answered like any finished chat, in context (step 3b below).
      // The chat stays with the agent until a person writes. Their later yes or no is still read here.
      if (!c.q || c.q.stage === "done") { Object.assign(c, { q: q0, humanSpoke: false }); await saveContact(waId, { q: q0, humanSpoke: false }); } // a chat still in the questions carries on as normal
    }
    if (d.intent === "job_seeker") { await jobSeekerNow(); return ok(); }

    const inFlow = ["asking", "confirm", "call", "slots", "email"].includes(c.q?.stage);
    const isVendor = c.kind === "vendor" || contact?.kind === "vendor";
    vendorChat = isVendor;
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
      } else if (await allow(`reply:${waId}:vendor_reminder`, 3 * HOUR)) {
        await agentSend(vendorReminder()); // they wrote the same thing again: answer them, pointing to the link already sent
        await incr("vendor_reminders");
      }
      return ok();
    }

    // 3b. The chat is finished (call booked, declined, ...). Whatever they send now is answered in context by Claude, like a person would.
    if (!c.humanSpoke && !c.esc && !isVendor && c.q?.stage === "done") {
      if (c.q.callBooked?.eventId && calendarEnabled()) {
        if (wantsCancel(text)) { await toHuman("call-cancel-request"); return ok(); }
        if (wantsReschedule(text)) {
          const rs = await startReschedule(c.q, text, consultDeps);
          if (rs) { await saveContact(waId, { q: rs.q }); await agentSend(rs.reply); return ok(); }
        }
      }
      const ph = extractPhone(text), em = extractEmail(text);
      const shared = { number: ph.status === "ok" ? `+${ph.number}` : "", email: em };
      // Their email or number arrives after the call was booked: it goes on the SAME calendar event (never a second one).
      const late = calendarEnabled() ? await addLateContact(c.q, shared, consultDeps) : { q: c.q };
      const out = await draftAfter({ text, name: who, context: doneContext(late.q), shared, greeted: true });
      if (!out || out.handover !== "none") { if (late.q !== c.q) await saveContact(waId, { q: late.q }); await toHuman(out?.handover === "change" ? "call-time-request" : "lead-question"); return ok(); }
      const nq = applyAfter(late.q, text, { ...shared, fields: out.fields });
      await saveContact(waId, { q: nq });
      await saveLead(waId, name, nq, { notes: nq.notes, country: countryOf(waId).name });
      await agentSend(out.reply);
      if (out.news) await logNeedsTeam({ waId, name, reason: "lead-added-details", lastMsg: text });
      return ok();
    }

    // 4. A lead on WhatsApp: ask the four questions, record the answers, confirm.
    if (canQualify || inFlow) {
      // A bare "Hi" from a number we do not know could be a client, a vendor or anyone: ask how we can help first.
      if (firstTouch && GREETING.test(text)) {
        if (await allow(`reply:${waId}:open`, 6 * HOUR)) {
          await saveContact(waId, { greeted: true });
          await agentSend(greetingText(who));
          await incr("open_greetings");
        }
        return ok();
      }
      // First real message: work out who is writing. Only a likely new client gets the questions; vendors and unclear go to a person.
      if (firstTouch) {
        // The operator (Claude) reads the message with the chat history and decides. If it cannot, the older sorter below decides.
        const act = operatorOn() ? await routeMessage({ channel: "WhatsApp", profileName: name, text, history: (await getRecentMessages(waId, 12)) || [], state: { greeted: c.greeted } }) : null;
        if (act) {
          if (await applyRoute(act)) return ok();
        } else {
          const found = await classifySenderDetail({ text, name });
          const sender = found.who;
          if (sender === "vendor") { await applyRoute({ kind: "vendor", name: found.name, business: found.business }); return ok(); }
          if (sender !== "client") { await toHuman("who-is-this"); return ok(); }
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
      // Read first: Claude reads the recent chat, what we hold and the newest message before any rule answers.
      // Short replies in the booking steps ("2", "ok") need no reading.
      let read = null;
      const readable = ["new", "asking", "confirm", "call"].includes(q.stage) || (["slots", "email"].includes(q.stage) && text.trim().split(/\s+/).length > 3);
      if (readable && !GREETING.test(text) && !dupAnswered) {
        const recent = withoutCurrent((await getRecentMessages(waId, 12)) || [], text);
        read = await understandChat({ text, name: who, history: recent, q, asked: q.asked });
      }
      if (read?.complaint && q.stage !== "new") { await toHuman("complaint"); return ok(); }
      const extracted = q.stage === "asking" || q.stage === "new" || (q.stage === "confirm" && (CORRECTION.test(text) || q.fixAsked || read?.intent === "correcting")) ? (!GREETING.test(text) && !dupAnswered ? await extractFields(text, q.asked, read) : {}) : {};
      let opener = "";
      if (firstTouch && !GREETING.test(text)) opener = (await draftOpening({ text, name: who, greeted: c.greeted })) || "";
      const pre = asking && !dupAnswered ? [priceQ ? priceAnswer(text) : "", guides.length ? guideText(guides) : ""].filter(Boolean).join("\n\n") : "";
      if (guides.length && ["confirm", "call"].includes(q.stage) && (await allow(`guide:${waId}:${guides[0].url}`, 6 * HOUR))) {
        await agentSend(guideText(guides)); await incr("guide_links_sent"); return ok(); // after the summary: just the link, state unchanged
      }
      // Booking the Founders' call: they choose a time, then give an email, then the event is created.
      if (["slots", "email"].includes(q.stage) && calendarEnabled()) {
        const cr = await consultTurn(q, text, consultDeps);
        if (cr) {
          if (cr.kind === "escalate") { await saveContact(waId, { q: holdContact(q, { email: extractEmail(text) }) }); await toHuman("lead-question"); return ok(); }
          if (mc?.state === "offered" && cr.q?.stage === "done") { // the new time was chosen (or they dropped it): the missed-call follow-up is finished
            await saveContact(waId, { missed: { ...mc, state: cr.moved ? "booked" : "closed" } });
          }
          const nq = cr.booked ? { ...cr.q, notes: [cr.q.notes, `Call booked: ${cr.booked.label} (${cr.q.callPref === "phone" ? "phone" : "Meet"})`].filter(Boolean).join(" / ") } : cr.q;
          await saveContact(waId, { q: nq });
          await saveLead(waId, name, nq, { notes: nq.notes, country: country.name });
          await agentSend(cr.reply);
          if (cr.booked) { await incr("calls_booked"); await keepCall(nq, cr.booked, cr.booked.eventId); }
          if (cr.moved) { await incr("calls_moved"); await keepCall(nq, cr.moved, cr.moved.eventId); }
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
        const ack = await draftAck({ text, name: who, kind: r.kind, asked: q.asked, fields: r.q.fields });
        if (ack) r = advance(q, text, extracted, name, opener, ack);
      }

      if (r.kind === "escalate") { await saveContact(waId, { q: holdContact(q, { email: extractEmail(text) }) }); await toHuman("lead-question"); return ok(); }
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
      // A quick follow-up that left the same question outstanding (two messages in a row): it is already asked, do not ask twice.
      const alreadyAsked = lock.waited && r.kind === "ask" && q.stage === "asking" && q.asked && r.q.asked === q.asked && Date.now() - (c.lastOut || 0) < 120_000;
      if (alreadyAsked) console.log(`skipped repeating "${q.asked}" question after a quick follow-up`);
      else await agentSend(r.reply);
      if (pre) await incr("price_answers");
      if (r.kind === "summary") await incr("wa_leads_completed");
      if (r.kind === "confirmed") await incr("wa_leads_confirmed");
      if (r.kind === "call-pref") { await incr("calls_requested"); await toHuman("ready-for-call", false); } // the team sends times
      else if (r.kind === "addition") await toHuman("lead-added-details", false); // a person should read what they added
      else if (firstTouch && moneyish) await toHuman("pricing-or-availability-question", false); // flag the team; the flow carries on
      return ok();
    }

    // 5. Everyone else (vendors writing again, and other messages outside the question flow): the operator reads it in context and
    // decides. Chats already handed to the team are left alone unless it is a vendor. If it cannot decide, the older rules below do.
    if (operatorOn() && (isVendor || (!c.esc && !c.humanSpoke))) {
      const act = await routeMessage({ channel: "WhatsApp", profileName: name, text, history: (await getRecentMessages(waId, 12)) || [], state: { kind: isVendor ? "vendor" : c.kind, stage: c.q?.stage, greeted: c.greeted, fields: c.q?.fields } });
      if (act?.kind === "price") { if (await allow(`reply:${waId}:price`, 6 * HOUR)) await agentSend(priceAnswer(text)); return ok(); }
      if (act && act.kind !== "client" && (await applyRoute(act))) return ok();
    }
    // Older rules: simple rules, then Claude for light replies, otherwise a human.
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
    await logNeedsTeam({ waId, name, reason: "agent-error", lastMsg: text }).catch(() => {}); // the lead may be waiting: tell the team
  } finally { await lock.release(); }
  return ok();
};
