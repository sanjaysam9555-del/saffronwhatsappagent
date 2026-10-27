import { decide, ESCALATION_ACK, CLIENT, GREETING, OPTOUT, vendorWelcome, vendorReminder, jobReply } from "../../lib/rules.mjs";
import { hardMoney, isPriceQuestion, priceAnswer, budgetLakhs, MIN_BUDGET_LAKHS } from "../../lib/facts.mjs";
import { guidesFor, guideText, readingFor } from "../../lib/guides.mjs";
import { extractPhone } from "../../lib/phone.mjs";
import { sendTemplateMessage } from "../../lib/wati.mjs";
import { callBookedParams } from "../../lib/leadfields.mjs";
import { recordQuestion, answerFromPlaybook, logExchange } from "../../lib/playbook.mjs";
import { holdContact } from "../../lib/qualify.mjs";
import { extractFields, understandChat, draftOpening, draftAck, draftHold, draftAfter, classifySenderDetail } from "../../lib/claude.mjs";
import { newState, advance, numberInChat, pendingQuestion, serviceLine, ORDER, doneContext, applyAfter, CORRECTION } from "../../lib/qualify.mjs";
import { calendarEnabled, offerSlots, bookConsult, moveConsult, addGuest, slotStillFree } from "../../lib/calendar.mjs";
import { recordCall, callRecord, touchCall } from "../../lib/calls.mjs";
import { startConsult, consultTurn, detailsText, fastTrack, wantsCall, extractEmail, wantsReschedule, wantsCancel, startReschedule, addLateContact } from "../../lib/consult.mjs";
import { isMediaOnly, recordMedia, REF_THANKS, REF_UNSURE, REF_NOTE, refOpen, greetingText } from "../../lib/media.mjs";
import { greetName } from "../../lib/leadfields.mjs";
import { sendInstagramText, getInstagramLastText, parseManychatEvent } from "../../lib/manychat.mjs";
import { getIg, saveIg, queueMessage, claimQueue, queuedTexts, resetIg, addIgHistory, getIgHistory } from "../../lib/igstate.mjs";
import { upsertInstagramLead } from "../../lib/sheet.mjs";
import { logNeedsTeam } from "../../lib/needsteam.mjs";
import { testAllows } from "../../lib/testmode.mjs";
import { allow } from "../../lib/state.mjs";
import { incr } from "../../lib/metrics.mjs";
import { acquireLock } from "../../lib/lock.mjs";
import { operatorOn, routeMessage } from "../../lib/operator.mjs";
import { introReply } from "../../lib/rules.mjs";
import { isRepeatOut, isNearRepeat, oneEmoji, paragraphs, FIELD_KEYS } from "../../lib/understand.mjs";
import { checkOutgoing, dropQuestion } from "../../lib/guard.mjs";
import { igApiOn, getInstagramHistory, getLatestCustomerText, recoverLatest, findNumberInChat, withoutCurrent, debugInstagramApi, mergeHistory } from "../../lib/igapi.mjs";

// Answers Instagram DMs that ManyChat forwards (see ig-webhook). Same rules as WhatsApp, plus the mobile number is asked
// first (we do not have it yet). Replies go back through ManyChat's API, inside Meta's 24h window after their message.
const HOUR = 3600_000;
const DEBOUNCE_MS = 8000; // messages typed this close together are answered as one
const ok = (b = "ok") => new Response(b, { status: 200 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ManyChat gives the Instagram profile name, which is often an emoji or a handle. Use it only if it looks like a name.
export const cleanName = (n = "") => {
  if (/\d|_/.test(String(n))) return ""; // "user12345", "riya_2025": a handle, not a name
  const s = String(n).normalize("NFKC").replace(/[^\p{L}\s.'-]/gu, " ").replace(/\s+/g, " ").trim();
  return (s.match(/\p{L}/gu) || []).length >= 2 && !/\d/.test(s) ? s.slice(0, 40) : "";
};
// Instagram allows about 1000 characters per message; split on paragraph breaks.
export function chunk(text, max = 900) {
  const out = []; let cur = "";
  for (const p of String(text).split("\n\n")) {
    if (cur && (cur + "\n\n" + p).length > max) { out.push(cur); cur = p; } else cur = cur ? cur + "\n\n" + p : p;
  }
  if (cur) out.push(cur);
  return out;
}

export default async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== process.env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
  const rawBody = await req.text().catch(() => "");
  const evt = parseManychatEvent(rawBody);
  if (!evt) { console.error(`ig-in: could not read the request (${rawBody.length} chars)`); return new Response("bad json", { status: 400 }); }
  const sid = String(evt.subscriber_id || "").trim();
  const username = String(evt.ig_username || "").replace(/^@/, "");
  const name = cleanName(evt.name);
  const who = greetName(name); // first name for greetings, only when the profile name looks like a person
  // "agenttest" is the keyword that routes test messages in ManyChat; it is never part of what a lead means.
  // The text normally comes in the request. If it is missing (the body may carry only the subscriber id), read it from ManyChat.
  let evtText = String(evt.text ?? "");
  const sentLen = evtText.trim().length;
  // ManyChat may not have stored the message yet (a phone number can take a moment), so look a few times before giving up.
  for (let i = 0; i < 3 && !evtText.trim() && sid; i++) { if (i) await sleep(1500); evtText = await getInstagramLastText(sid); }
  // Still nothing (Instagram shows a typed phone number as a card, and ManyChat gives no text for it): read the newest message from Instagram itself.
  let recovered = 0;
  // A typed message with a number in it is followed at once by a text-less "Phone number" card, so what they wrote is read from just before the card.
  let alreadyAnswered = false, recoveredId = "";
  if (!evtText.trim() && igApiOn() && username) { const r = await recoverLatest({ username }); evtText = r.text; recovered = evtText.trim().length; alreadyAnswered = !r.text && r.answered; recoveredId = r.ids?.[0] || ""; }
  console.log(`ig-in: recoveredFromInstagram=${recovered} chars`);
  console.log(`ig-in: fields=${Object.keys(evt).join(",")} textFromManyChat=${sentLen} chars, afterApiLookup=${String(evtText).trim().length} chars`); // lengths only, never the message itself
  const stripped = String(evtText).replace(/^\s*agenttest\b[\s:,.-]*/i, "").trim();
  const blankText = !String(evtText).trim(); // nothing readable arrived: a photo, or a typed message that did not come through
  const rawText = stripped || (/^\s*agenttest\b/i.test(evtText) ? "Hi" : "") || "[attachment]";
  if (!sid || !testAllows({ mcId: sid })) return ok("ignored");
  if (/^\s*agenttest\s+reset\b/i.test(evtText)) { // test helper: start over
    await resetIg(sid);
    await sendInstagramText(sid, "Test reset done. Send \"agenttest\" followed by your message to start again.");
    return ok("reset");
  }
  if (/^\s*agenttest\s+igdebug\b/i.test(evtText)) { // test helper: what does Meta's Instagram API say?
    await sendInstagramText(sid, await debugInstagramApi(username));
    return ok("igdebug");
  }
  if (blankText && alreadyAnswered) return ok("nothing new from them: our message is the newest"); // e.g. the phone card that came with a message we already answered
  if (recoveredId && !(await allow(`igmid:${sid}:${recoveredId}`, 24 * HOUR))) return ok("that message was already answered"); // the message and its card each start a run
  if (!(await allow(`igevt:${sid}:${rawText.slice(0, 40)}`, recoveredId ? 60_000 : 15_000))) return ok("duplicate"); // ManyChat can fire twice

  // Burst handling: only the last message of a burst answers, to all of them.
  const msgId = await queueMessage(sid, rawText);
  let text = rawText;
  if (msgId) {
    await sleep(DEBOUNCE_MS);
    text = await claimQueue(sid, msgId);
    if (!text) return ok("later message will answer");
  }

  if (!blankText) await addIgHistory(sid, "customer", text); // the chat so far, for Claude
  const label = username ? `@${username}` : `ig:${sid}`;
  let pendingAsk = ""; // the question we were waiting for, repeated after a taught answer
  let vendorChat = false, leadQ = null; // set once the chat is loaded; used to give every real lead a row, even one who asks a question and goes quiet
  const ROW_REASONS = new Set(["lead-question", "money-or-commitment", "pricing-or-availability-question", "call-time-request"]);
  const HANDOVER_REASON_IG = { money: "money-or-commitment", existing_client: "existing-client", complaint: "complaint", unclear: "who-is-this", other: "unclear" };
  // Never say the same thing twice in a row: a repeated message means the agent has not understood, so a person takes over instead.
  let stopping = false;
  // Our reply is written from what the lead had sent when we started. If she has since sent something that already answers the question
  // we are about to ask (Tulsi: her city, while we were noting her number), that question is left out and her newer message gets the next one.
  const dropAnswered = async (msg) => {
    try {
      const queued = await queuedTexts(sid);
      if (!queued.length) return msg;
      const cur = await getIg(sid), asked = cur.q?.asked;
      if (!asked || !FIELD_KEYS.includes(asked) || cur.q?.stage !== "asking") return msg;
      const read = await understandChat({ text: queued.join("\n"), name: who, history: await getIgHistory(sid), q: cur.q, asked });
      if (!read?.fields?.[asked]) return msg;
      console.log(`ig ${sid}: a newer message already answers "${asked}"; the question is left out of this reply`);
      await incr("answered_questions_dropped");
      return dropQuestion(msg);
    } catch (e) { console.warn("dropAnswered:", e.message); return msg; }
  };
  const send = async (msg, { repeatOk = false, near = false } = {}) => {
    msg = paragraphs(oneEmoji(msg));
    if (!repeatOk && !stopping) msg = await dropAnswered(msg);
    if (!stopping) { // the last check: the same types of mistake Swati has already reported (lib/guard.mjs, docs/LESSONS.md)
      const prev0 = await getIg(sid);
      const g = checkOutgoing({ msg, lastIn: text, prev: prev0, repeatOk });
      if (g.action === "skip") { console.log(`ig ${sid}: guard skipped a message (${g.code}): ${g.why}`); await incr("guard_stopped"); return; }
      if (g.action === "handover") {
        stopping = true;
        await incr("guard_stopped");
        console.log(`ig ${sid}: guard stopped a message (${g.code}): ${g.why}; handing over instead`);
        await toHuman("message-blocked", true);
        return;
      }
      msg = g.msg;
    }
    if (!repeatOk && !stopping) {
      const prev = await getIg(sid);
      // A vendor, or a reply that only rephrases what we just said: skip it quietly, no hand-over message on top.
      if ((vendorChat || near) && (isRepeatOut(prev.lastOutText, prev.lastOut, msg) || isNearRepeat(prev.lastOutText, prev.lastOut, msg))) { console.log(`ig ${sid}: skipped a reply that repeats our last message`); await incr("repeats_stopped"); return; }
      if (isRepeatOut(prev.lastOutText, prev.lastOut, msg)) {
        stopping = true;
        await incr("repeats_stopped");
        console.log(`ig ${sid}: would repeat our last message; handing over instead`);
        await toHuman("repeating-itself", true);
        return;
      }
    }
    await logExchange({ channel: "Instagram", contact: label, lead: text, agent: msg });
    await addIgHistory(sid, "us", msg);
    for (const part of chunk(msg)) { await sendInstagramText(sid, part); await sleep(400); }
    await saveIg(sid, { lastOut: Date.now(), lastOutText: String(msg).slice(0, 600) });
  };
  // The recent chat, as Instagram holds it (it includes what the team typed by hand); our own record when Instagram cannot be read.
  const chatHistory = async (current) => {
    let real = null;
    if (igApiOn() && username) { const r = await getInstagramHistory({ username }); real = r && r.length ? withoutCurrent(r, current) : null; }
    const own = await getIgHistory(sid, { skipNewest: current });
    const h = mergeHistory(real, own);
    console.log(`ig-read: chat given to Claude = ${h.length} messages (Instagram ${real ? real.length : 0}, our record ${own.length})`); // counts only, never the text
    return h;
  };
  const toHuman = async (reason, ack = true, hold = "") => {
    if (reason === "lead-question") { // an answer you have already taught the agent is used before anyone is bothered
      const taught = await answerFromPlaybook(text);
      if (taught) { await send(pendingAsk ? `${taught}\n\n${pendingAsk}` : taught); await incr("playbook_answers"); return; }
      await recordQuestion({ channel: "Instagram", text });
    }
    await saveIg(sid, { esc: true, escAt: Date.now() });
    if (ack && (await allow(`igack:${sid}`, 6 * HOUR))) await send(hold || (await draftHold({ text, name: who })) || ESCALATION_ACK);
    await incr("ig_escalations");
    console.log(`ESCALATE ig ${sid} (${reason}): ${text.slice(0, 120)}`);
    await logNeedsTeam({ channel: "Instagram", contact: label, name: name || label, reason, lastMsg: text, reply: ack ? "(holding reply sent)" : "" });
    if (ROW_REASONS.has(reason) && !vendorChat) await upsertInstagramLead(sid, name || label, leadQ || { fields: {}, stage: "new" }, { notes: `Asked: ${text.slice(0, 120)}`, lastMsg: text.slice(0, 200) });
  };

  // Once a call is booked and we hold their number: a WhatsApp with what they told us, the call time and one page to read.
  // Needs the approved template named in CALL_TEMPLATE_NAME; without it nothing is sent. Sent once per lead. Never throws.
  const confirmOnWhatsApp = async (q) => {
    try {
      const tpl = process.env.CALL_TEMPLATE_NAME;
      const num = String(q?.fields?.number || "");
      const waId = /pending|not shared/i.test(num) ? "" : num.replace(/\D/g, "");
      if (!tpl || !q?.callBooked || q.waConfirmSent || waId.length < 8 || waId.length > 15) return q;
      await sendTemplateMessage(waId, tpl, callBookedParams(name, q.fields, q.callBooked.label, readingFor(q.fields)), "call-confirmation");
      await incr("call_confirmations_sent");
      if (q.callBooked.eventId) await touchCall(q.callBooked.eventId, { confirmedAt: Date.now() });
      await logExchange({ channel: "Instagram", contact: label, lead: "(call booked)", agent: `WhatsApp confirmation sent to +${waId}` });
      return { ...q, waConfirmSent: true };
    } catch (e) {
      console.error("call confirmation on WhatsApp failed:", e.message);
      await logNeedsTeam({ channel: "Instagram", contact: label, name: name || label, reason: "call-confirmation-failed", lastMsg: text }).catch(() => {});
      return q;
    }
  };

  const consultDeps = { offer: (req) => offerSlots(req), move: (a) => moveConsult(a), addGuest: (a) => addGuest({ ...a, name: name || label }), stillFree: (a) => slotStillFree({ ...a, name: name || label }), book: (a) => bookConsult({ ...a, name: name || label, source: "Instagram", details: detailsText(a.fields) }) };
  // Remember a booked (or moved) call so the lead is reminded on WhatsApp. Needs their number; without one there is nobody to remind.
  const keepCall = async (q, booked, id) => {
    try { await recordCall(callRecord({ id: id || `ig-${sid}-${booked.start}`, start: booked.start, label: booked.label, name, number: q.fields?.number, channel: "Instagram", pref: q.callPref, meetLink: q.callBooked?.meetLink })); } catch (e) { console.warn("keepCall:", e.message); }
  };

  // The number is "Shared in this chat" when Instagram showed it as a phone card we could not read. The real chat still holds it: read it
  // from there and put it in the lead's details. If the chat was read and holds no number, it was not actually shared: the number is
  // marked "Pending", so the one gentle ask towards the end of the chat applies. If the chat could not be read, nothing is assumed.
  // Only ever replaces that placeholder (or "Pending" from a card), never a number someone gave properly.
  const PLACEHOLDER = "Shared in this chat";
  const fillNumberFromChat = async (tries = 4, waitMs = 8000) => {
    if (!igApiOn() || !username) return false;
    let readable = false;
    for (let i = 0; i < tries; i++) {
      if (i) await sleep(waitMs);
      const num = await findNumberInChat({ username });
      if (num === null) continue; // could not read the chat this time
      readable = true;
      if (!num) continue; // read, no number yet (it can take a moment to appear)
      const cur = await getIg(sid);
      if (!cur.q?.numCard || ![PLACEHOLDER, "Pending"].includes(cur.q.fields?.number)) return false;
      const q2 = { ...cur.q, numCard: false, fields: { ...cur.q.fields, number: num } };
      await saveIg(sid, { q: q2 });
      await upsertInstagramLead(sid, name || label, q2, { notes: q2.notes, lastMsg: "(number read from the Instagram chat)" });
      await incr("ig_numbers_recovered");
      console.log("ig-number: read from the Instagram chat");
      return true;
    }
    if (readable) { // the chat holds no number: it was not shared after all, so it is asked for once, towards the end
      const cur = await getIg(sid);
      if (cur.q?.numCard && cur.q.fields?.number === PLACEHOLDER) {
        await saveIg(sid, { q: { ...cur.q, fields: { ...cur.q.fields, number: "Pending" } } });
        await logNeedsTeam({ channel: "Instagram", contact: label, name: name || label, reason: "unreadable-message", lastMsg: "(a phone card was sent, but no number is in the chat: it will be asked for again towards the end)" });
      }
      console.log("ig-number: no number in the chat");
    } else console.log("ig-number: chat could not be read");
    return false;
  };

  // A CV or a job enquiry: a fixed thank-you, no vendor link, the team is told, and the chat is left alone afterwards.
  const jobSeekerNow = async (who0) => {
    await saveIg(sid, { kind: "vendor", jobSeeker: true, greeted: true });
    if (await allow(`igreply:${sid}:job`, 24 * HOUR)) { await send(jobReply({ name: who0 || who })); await incr("job_enquiries"); }
    await logNeedsTeam({ channel: "Instagram", contact: label, name: name || label, reason: "job-enquiry", lastMsg: text, reply: "(thank-you sent, no link)" });
  };
  const lock = await acquireLock(`ig:${sid}`); // one message at a time per chat; a quick follow-up waits for the one before it
  try {
    let c = await saveIg(sid, { lastIn: Date.now(), name: name || undefined, username: username || undefined });
    if (c.q?.numCard && [PLACEHOLDER, "Pending"].includes(c.q.fields?.number) && (await fillNumberFromChat(1))) c = await getIg(sid); // still unread from an earlier turn: check the chat once more
    pendingAsk = c.q?.stage === "asking" ? pendingQuestion(c.q) : "";
    leadQ = c.q || null;
    const d = decide(text, { name });

    if (OPTOUT.test(text)) {
      await saveIg(sid, { dnc: true });
      await send("Understood, we won't message you again. Thank you for your time.");
      return ok();
    }
    if (c.dnc) return ok();
    if (c.jobSeeker) return ok("job seeker: a person reads the rest"); // already thanked
    if (d.intent === "job_seeker") { await jobSeekerNow(); return ok(); }

      // Photos, reels and links. Shared on their own they are references ("we want something like this"): say thank you and carry on.
    // Several in a row (a portfolio) pause the chat for a person. A file sent together with a message is just noted.
    const lines = text.split("\n");
    const mediaCount = lines.filter((l) => isMediaOnly(l)).length;
    const message = lines.filter((l) => !isMediaOnly(l)).join("\n").trim();
    if (mediaCount) {
      let times = c.mediaTimes || [], burst = false;
      for (let i = 0; i < mediaCount; i++) ({ times, burst } = recordMedia(times));
      c = await saveIg(sid, { mediaTimes: times, refShared: true });
      if (burst && !c.esc) {
        await saveIg(sid, { esc: true, ...(c.q ? { q: { ...c.q, stage: "paused" } } : {}) });
        await logNeedsTeam({ channel: "Instagram", contact: label, name: name || label, reason: "media-received", lastMsg: "[sent several files or links]" });
        return ok("media burst");
      }
    }
    if (c.esc || c.q?.stage === "paused" || (c.kind === "vendor" && mediaCount && !message)) {
      // Quiet after a hand-over, but a number or email they send is still kept for the team.
      const p0 = extractPhone(text), e0 = extractEmail(text);
      if (c.q && c.kind !== "vendor" && (p0.status === "ok" || e0)) await saveIg(sid, { q: holdContact(c.q, { number: p0.status === "ok" ? `+${p0.number}` : "", email: e0 }) });
      return ok("with team");
    } // after a hand-over the agent stays quiet (and a vendor's portfolio files need no reply)
    if (mediaCount && !message && blankText && c.q?.stage === "asking" && c.q.asked === "number" && !c.q.fields?.number) {
      // They were asked for their number and Instagram sent it as a phone card with no readable text: do not ask again, carry on.
      const r = numberInChat(c.q, who);
      await saveIg(sid, { q: r.q });
      await upsertInstagramLead(sid, name || label, r.q, { notes: r.q.notes, lastMsg: "(number sent as an Instagram phone card)" });
      await send(r.reply);
      await logNeedsTeam({ channel: "Instagram", contact: label, name: name || label, reason: "unreadable-message", lastMsg: "(probably their number, sent as a phone card: please read it in the Instagram chat)" });
      await incr("ig_number_cards");
      await fillNumberFromChat(); // the lead is already answered; now read the real number from the Instagram chat and fill it in
      return ok("number card");
    }
    if (mediaCount && !message) {
      if (!c.q) { if (await allow(`igreply:${sid}:open`, 6 * HOUR)) { await saveIg(sid, { greeted: true }); await send(refOpen(who)); } }
      else if (["asking", "confirm", "call", "slots", "email"].includes(c.q.stage) && (await allow(`igmediaack:${sid}`, blankText ? 90_000 : 10 * 60_000))) {
        const again = c.q.stage === "asking" ? pendingQuestion(c.q) : "";
        const thanks = blankText ? REF_UNSURE : REF_THANKS; // blank text: it may have been their answer, so ask again instead of just thanking
        await send(again ? `${thanks}\n\n${again}` : thanks);
      }
      if (blankText && c.q && (await allow(`igblankteam:${sid}`, HOUR))) await logNeedsTeam({ channel: "Instagram", contact: label, name: name || label, reason: "unreadable-message", lastMsg: "(a message with no readable text)" });
      return ok("media reference");
    }
    if (mediaCount) text = message; // answer the words; the file is noted below

    const inFlow = ["asking", "confirm", "call", "slots", "email"].includes(c.q?.stage);
    const isVendor = c.kind === "vendor";
    vendorChat = isVendor;
    const canQualify = !isVendor && c.q?.stage !== "done";
    const priceQ = isPriceQuestion(text);
    const guides = guidesFor(text); // a page on the website answers this in detail: share the link
    const moneyish = (hardMoney(text) && !guides.length) || (!inFlow && /\b(available|availability|book|booking)\b/i.test(text));
    const firstTouch = canQualify && !inFlow && !c.q && !CLIENT.test(text) && d.intent !== "vendor_signup";

    // A vendor who already has the link writes again: read it in context and answer. Never ignore them.
    if (isVendor) {
      const remind = async () => { if (await allow(`igreply:${sid}:vendor_reminder`, 3 * HOUR)) { await send(vendorReminder()); await incr("ig_vendor_reminders"); } };
      if (d.intent === "vendor_signup") { await remind(); return ok(); } // the same pitch again: point them to the link above
      let vh = null;
      if (operatorOn() && igApiOn()) { const real = await getInstagramHistory({ username }); vh = real && real.length ? withoutCurrent(real, text) : null; }
      if (!vh) vh = await getIgHistory(sid, { skipNewest: text });
      const act = operatorOn() ? await routeMessage({ channel: "Instagram", profileName: name || username, text, history: vh, state: { kind: "vendor", greeted: true } }) : null;
      if (act?.kind === "reply") { if (await allow(`igreply:${sid}:vendor_op`, 3 * HOUR)) { await send(act.text, { near: true }); await incr("operator_replies"); } }
      else if (act?.kind === "handover") await toHuman(HANDOVER_REASON_IG[act.reason] || "unclear", true, act.hold);
      else if (act?.kind === "quiet") console.log(`operator stayed quiet for ig vendor ${sid}: ${act.why}`);
      else await remind();
      return ok();
    }

    if (moneyish && !firstTouch) { await toHuman("money-or-commitment"); return ok(); }
    if (CLIENT.test(text)) { await toHuman("existing-client"); return ok(); }

    if (d.intent === "vendor_signup" && (!inFlow || d.strong)) {
      await saveIg(sid, { kind: "vendor", ...(c.q ? { q: { ...c.q, stage: "done" } } : {}) });
      if (await allow(`igreply:${sid}:vendor`, 6 * HOUR)) { await send(d.text); await incr("ig_vendor_links_sent"); }
      else if (await allow(`igreply:${sid}:vendor_reminder`, 3 * HOUR)) { await send(vendorReminder()); await incr("ig_vendor_reminders"); } // sent twice in a row: answer, do not ignore
      return ok();
    }

    // The chat is finished (call booked, declined, ...). Whatever they send now is answered in context by Claude, like a person would.
    if (!isVendor && c.q?.stage === "done") {
      if (c.q.callBooked?.eventId && calendarEnabled()) {
        if (wantsCancel(text)) { await toHuman("call-cancel-request"); return ok(); }
        if (wantsReschedule(text)) {
          const rs = await startReschedule(c.q, text, consultDeps);
          if (rs) { await saveIg(sid, { q: rs.q }); await send(rs.reply); return ok(); }
        }
      }
      const ph = extractPhone(text), em = extractEmail(text);
      const shared = { number: ph.status === "ok" ? `+${ph.number}` : "", email: em };
      // Their email or number arrives after the call was booked: it goes on the SAME calendar event (never a second one).
      const late = calendarEnabled() ? await addLateContact(c.q, shared, consultDeps) : { q: c.q };
      const out = await draftAfter({ text, name: who, context: doneContext(late.q), shared, greeted: true });
      if (!out || out.handover !== "none") { if (late.q !== c.q) await saveIg(sid, { q: late.q }); await toHuman(out?.handover === "change" ? "call-time-request" : "lead-question"); return ok(); }
      const nq = applyAfter(late.q, text, { ...shared, fields: out.fields });
      await saveIg(sid, { q: nq });
      await upsertInstagramLead(sid, name || label, nq, { notes: nq.notes, lastMsg: text.slice(0, 200) });
      await send(out.reply);
      if (out.news) await logNeedsTeam({ channel: "Instagram", contact: label, name: name || label, reason: "lead-added-details", lastMsg: text });
      if (shared.number || shared.email) { const sent = await confirmOnWhatsApp(nq); if (sent.waConfirmSent) await saveIg(sid, { q: sent }); } // their number arrived after the booking
      return ok();
    }
    if (!canQualify && !inFlow) return ok("not a client chat");

    // A bare "Hi": ask how we can help before the questions (could be anyone).
    if (firstTouch && GREETING.test(text)) {
      if (await allow(`igreply:${sid}:open`, 6 * HOUR)) {
        await saveIg(sid, { greeted: true });
        await send(greetingText(who));
        await incr("ig_open_greetings");
      }
      return ok();
    }
    if (firstTouch) {
      // The operator (Claude) reads the message and decides; if it cannot, the older sorter decides.
      const vendorWelcomeNow = async (v) => {
        await saveIg(sid, { kind: "vendor" });
        if (await allow(`igreply:${sid}:vendor_signup`, 6 * HOUR)) { await send(vendorWelcome({ name: v.name || who, business: v.business })); await incr("vendor_links_sent"); }
        await logNeedsTeam({ channel: "Instagram", contact: label, name: name || label, reason: "looks-like-vendor", lastMsg: text });
      };
      const HANDOVER_REASON = HANDOVER_REASON_IG;
      // The real chat from Instagram when it can be read (it includes what the team typed by hand); otherwise our own rolling record.
      let real = null;
      if (operatorOn() && igApiOn()) {
        const r = await getInstagramHistory({ username });
        real = r && r.length ? withoutCurrent(r, text) : null;
        console.log(`ig-history: usernameKnown=${Boolean(username)} fromInstagram=${r ? r.length : "none"}`);
      }
      const history = mergeHistory(real, await getIgHistory(sid, { skipNewest: text }));
      const act = operatorOn() ? await routeMessage({ channel: "Instagram", profileName: name || username, text, history, state: { greeted: c.greeted } }) : null;
      if (act?.kind === "vendor") { await vendorWelcomeNow(act); return ok(); }
      if (act?.kind === "job") { await jobSeekerNow(act.name); return ok(); }
      if (act?.kind === "intro") { // someone new at a business we probably already work with: a thank-you, no link, and the team updates the vendor record
        await saveIg(sid, { kind: "vendor", greeted: true });
        if (await allow(`igreply:${sid}:intro`, 6 * HOUR)) { await send(introReply({ name: act.name || who, business: act.business })); await incr("vendor_intros"); }
        await logNeedsTeam({ channel: "Instagram", contact: label, name: name || label, reason: "vendor-contact-change", lastMsg: text, reply: "(thank-you sent, no link)" });
        return ok();
      }
      if (act?.kind === "open") { // we cannot tell what they want yet: the fixed welcome asks, and their answer decides what happens next
        await saveIg(sid, { greeted: true });
        if (await allow(`igreply:${sid}:open`, 6 * HOUR)) { await send(greetingText(who)); await incr("ig_open_greetings"); }
        else await toHuman("who-is-this", false); // still unclear after we asked: a person should look
        return ok();
      }
      if (act?.kind === "reply") { await saveIg(sid, { greeted: true }); if (await allow(`igreply:${sid}:operator`, 20_000)) { await send(act.text, { near: true }); await incr("operator_replies"); } return ok(); }
      if (act?.kind === "handover") { await toHuman(HANDOVER_REASON[act.reason] || "unclear", true, act.hold); return ok(); }
      if (act?.kind === "quiet") { console.log(`operator stayed quiet for ig ${sid}: ${act.why}`); return ok(); }
      if (!act) {
        const found = await classifySenderDetail({ text, name });
        if (found.who === "vendor") { await vendorWelcomeNow(found); return ok(); }
        if (found.who !== "client") { await toHuman("who-is-this"); return ok(); }
      }
      // act.kind "client" or "price" falls through to the question flow, which answers prices itself
    }

    let q = c.q || newState({}, "Instagram", "instagram");
    if (c.greeted && !q.greeted) q = { ...q, greeted: true };
    if (c.refShared && !q.refNoted) q = { ...q, refNoted: true, notes: [q.notes, REF_NOTE].filter(Boolean).join(" / ") };
    const asking = q.stage === "new" || q.stage === "asking";
    const ph = extractPhone(text);
    // Read first: Claude reads the recent chat, what we hold and the newest message before any rule answers.
    // Short replies in the booking steps ("2", "ok") need no reading.
    let read = null;
    const readable = ["new", "asking", "confirm", "call"].includes(q.stage) || (["slots", "email"].includes(q.stage) && text.trim().split(/\s+/).length > 3);
    if (readable && !GREETING.test(text)) read = await understandChat({ text, name: who, history: await chatHistory(text), q, asked: q.asked });
    if (read?.complaint && q.stage !== "new") { await toHuman("complaint"); return ok(); }
    const extracted = (asking || (q.stage === "confirm" && (CORRECTION.test(text) || q.fixAsked || read?.intent === "correcting"))) && !GREETING.test(text) ? await extractFields(text, q.asked === "number" ? null : q.asked, read) : {};
    delete extracted.number;
    if (ph.status === "ok") extracted.number = `+${ph.number}`;
    if (ph.status === "ambiguous") extracted.numberAmbiguous = true;
    let opener = "";
    if (firstTouch && !GREETING.test(text)) opener = (await draftOpening({ text, name: who, greeted: c.greeted })) || "";
    const pre = asking ? [priceQ ? priceAnswer(text) : "", guides.length ? guideText(guides) : ""].filter(Boolean).join("\n\n") : "";
    if (guides.length && ["confirm", "call"].includes(q.stage) && (await allow(`igguide:${sid}:${guides[0].url}`, 6 * HOUR))) {
      await send(guideText(guides)); await incr("guide_links_sent"); return ok(); // after the summary: just the link, state unchanged
    }
    // Booking the Founders' call: they choose a time, then give an email, then the event is created.
    if (["slots", "email"].includes(q.stage) && calendarEnabled()) {
      const cr = await consultTurn(q, text, consultDeps);
      if (cr) {
        if (cr.kind === "escalate") { await saveIg(sid, { q: holdContact(q, { number: ph.status === "ok" ? `+${ph.number}` : "", email: extractEmail(text) }) }); await toHuman("lead-question"); return ok(); }
        const nq = cr.booked ? { ...cr.q, notes: [cr.q.notes, `Call booked: ${cr.booked.label} (${cr.q.callPref === "phone" ? "phone" : "Meet"})`].filter(Boolean).join(" / ") } : cr.q;
        await saveIg(sid, { q: nq });
        await upsertInstagramLead(sid, name || label, nq, { notes: nq.notes, lastMsg: text.slice(0, 200), done: true });
        await send(cr.reply, { repeatOk: cr.kind === "slots-info" });
        if (cr.booked) {
          await incr("calls_booked");
          await keepCall(nq, cr.booked, cr.booked.eventId);
          const sent = await confirmOnWhatsApp(nq);
          if (sent.waConfirmSent) await saveIg(sid, { q: sent });
        }
        if (cr.moved) { await incr("calls_moved"); await keepCall(nq, cr.moved, cr.moved.eventId); }
        if (cr.escalate) await toHuman(cr.escalate, false);
        return ok();
      }
    }
    // They opened by asking to talk: offer times straight away (no questions, no price list), the way a person would.
    if (firstTouch && calendarEnabled() && wantsCall(text) && !GREETING.test(text)) {
      try {
        const fields = { ...q.fields };
        for (const k of ["number", ...ORDER]) if (extracted[k]) fields[k] = String(extracted[k]).slice(0, 80);
        const ft = await fastTrack({ ...q, fields }, { name: name || label, svc: serviceLine(text), deps: consultDeps });
        if (ft) {
          const nq = { ...ft.q, notes: [ft.q.notes, "Asked for a call in their first message"].filter(Boolean).join(" / ") };
          await saveIg(sid, { q: nq });
          await upsertInstagramLead(sid, name || label, nq, { notes: nq.notes, lastMsg: text.slice(0, 200) });
          await send(ft.reply);
          await incr("calls_requested");
          return ok();
        }
      } catch (e) { console.error("fast-track call offer failed:", e.message); }
    }
    let r = advance(q, text, extracted, name, opener, "", pre);
    const worthReacting = q.asked === "location" || r.kind === "addition" || /\b(not sure|don'?t know|maybe|undecided|tbd|haven'?t decided)\b/i.test(text);
    if (!firstTouch && !pre && worthReacting && ["ask", "summary", "addition"].includes(r.kind) && !GREETING.test(text)) {
      const ack = await draftAck({ text, name: who, kind: r.kind, asked: q.asked, fields: r.q.fields });
      if (ack) r = advance(q, text, extracted, name, opener, ack);
    }
    if (r.kind === "escalate") { await saveIg(sid, { q: holdContact(q, { number: ph.status === "ok" ? `+${ph.number}` : "", email: extractEmail(text) }) }); await toHuman("lead-question"); return ok(); }
    if (r.kind === "call-pref" && calendarEnabled()) { // offer real times; if that fails the team does it by hand, as before
      try {
        const sc = await startConsult(r.q, consultDeps);
        if (sc) { r = sc; await incr("calls_requested"); }
      } catch (e) { console.error("offering call times failed:", e.message); }
    }

    const amount = budgetLakhs(text);
    if (amount !== null && (await allow(`igbudget:${sid}`, 24 * HOUR))) {
      r.q.notes = [r.q.notes, `Budget mentioned: ${text.slice(0, 80)}`].filter(Boolean).join(" / ");
      if (amount < MIN_BUDGET_LAKHS) await logNeedsTeam({ channel: "Instagram", contact: label, name: name || label, reason: "budget-under-40L", lastMsg: text });
    }

    await saveIg(sid, { q: r.q });
    { // every real lead gets a row, even one who has not answered a question yet
      await upsertInstagramLead(sid, name || label, r.q, {
        notes: r.q.notes, lastMsg: text.slice(0, 200),
        done: ["confirmed", "call-pref", "call-declined"].includes(r.kind), // stops the 5-minute follow-up job from also messaging them
      });
    }
    // A quick follow-up that left the same question outstanding (the lead sent two messages in a row): it is already asked, do not ask twice.
    const alreadyAsked = lock.waited && r.kind === "ask" && q.stage === "asking" && q.asked && r.q.asked === q.asked && Date.now() - (c.lastOut || 0) < 120_000;
    if (alreadyAsked) console.log(`ig: skipped repeating "${q.asked}" question after a quick follow-up`);
    else await send(r.reply);
    if (pre) await incr("price_answers");
    if (r.kind === "summary") await incr("ig_leads_completed");
    if (r.kind === "confirmed") await incr("ig_leads_confirmed");
    if (r.kind === "call-pref") { await incr("calls_requested"); await toHuman("ready-for-call", false); }
    else if (r.kind === "addition") await toHuman("lead-added-details", false);
    else if (firstTouch && moneyish) await toHuman("pricing-or-availability-question", false);
  } catch (e) {
    console.error("ig webhook error", e);
    await logNeedsTeam({ channel: "Instagram", contact: label, name: name || label, reason: "send-failed", lastMsg: text }).catch(() => {});
  } finally { await lock.release(); }
  return ok();
};
