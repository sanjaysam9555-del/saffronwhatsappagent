import { decide, ESCALATION_ACK, CLIENT, GREETING, OPTOUT } from "../../lib/rules.mjs";
import { hardMoney, isPriceQuestion, priceAnswer, budgetLakhs, MIN_BUDGET_LAKHS } from "../../lib/facts.mjs";
import { guidesFor, guideText, readingFor } from "../../lib/guides.mjs";
import { extractPhone } from "../../lib/phone.mjs";
import { sendTemplateMessage } from "../../lib/wati.mjs";
import { callBookedParams } from "../../lib/leadfields.mjs";
import { recordQuestion, answerFromPlaybook, logExchange } from "../../lib/playbook.mjs";
import { extractFields, draftOpening, draftAck, draftHold, draftAfter, classifySender } from "../../lib/claude.mjs";
import { newState, advance, pendingQuestion, serviceLine, ORDER, doneContext, applyAfter } from "../../lib/qualify.mjs";
import { calendarEnabled, offerSlots, bookConsult } from "../../lib/calendar.mjs";
import { startConsult, consultTurn, detailsText, fastTrack, wantsCall, extractEmail } from "../../lib/consult.mjs";
import { isMediaOnly, recordMedia, REF_THANKS, REF_NOTE, REF_OPEN } from "../../lib/media.mjs";
import { sendInstagramText, getInstagramLastText } from "../../lib/manychat.mjs";
import { getIg, saveIg, queueMessage, claimQueue, resetIg } from "../../lib/igstate.mjs";
import { upsertInstagramLead } from "../../lib/sheet.mjs";
import { logNeedsTeam } from "../../lib/needsteam.mjs";
import { testAllows } from "../../lib/testmode.mjs";
import { allow } from "../../lib/state.mjs";
import { incr } from "../../lib/metrics.mjs";

// Answers Instagram DMs that ManyChat forwards (see ig-webhook). Same rules as WhatsApp, plus the mobile number is asked
// first (we do not have it yet). Replies go back through ManyChat's API, inside Meta's 24h window after their message.
const HOUR = 3600_000;
const DEBOUNCE_MS = 3500;
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
  let evt;
  try { evt = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
  const sid = String(evt.subscriber_id || "").trim();
  const username = String(evt.ig_username || "").replace(/^@/, "");
  const name = cleanName(evt.name);
  // "agenttest" is the keyword that routes test messages in ManyChat; it is never part of what a lead means.
  // The text normally comes in the request. If it is missing (the body may carry only the subscriber id), read it from ManyChat.
  let evtText = String(evt.text ?? "");
  if (!evtText.trim() && sid) evtText = await getInstagramLastText(sid);
  const stripped = String(evtText).replace(/^\s*agenttest\b[\s:,.-]*/i, "").trim();
  const rawText = stripped || (/^\s*agenttest\b/i.test(evtText) ? "Hi" : "") || "[attachment]";
  if (!sid || !testAllows({ mcId: sid })) return ok("ignored");
  if (/^\s*agenttest\s+reset\b/i.test(evtText)) { // test helper: start over
    await resetIg(sid);
    await sendInstagramText(sid, "Test reset done. Send \"agenttest\" followed by your message to start again.");
    return ok("reset");
  }
  if (!(await allow(`igevt:${sid}:${rawText.slice(0, 40)}`, 15_000))) return ok("duplicate"); // ManyChat can fire twice

  // Burst handling: only the last message of a burst answers, to all of them.
  const msgId = await queueMessage(sid, rawText);
  let text = rawText;
  if (msgId) {
    await sleep(DEBOUNCE_MS);
    text = await claimQueue(sid, msgId);
    if (!text) return ok("later message will answer");
  }

  const label = username ? `@${username}` : `ig:${sid}`;
  let pendingAsk = ""; // the question we were waiting for, repeated after a taught answer
  const send = async (msg) => {
    await logExchange({ channel: "Instagram", contact: label, lead: text, agent: msg });
    for (const part of chunk(msg)) { await sendInstagramText(sid, part); await sleep(400); }
    await saveIg(sid, { lastOut: Date.now() });
  };
  const toHuman = async (reason, ack = true) => {
    if (reason === "lead-question") { // an answer you have already taught the agent is used before anyone is bothered
      const taught = await answerFromPlaybook(text);
      if (taught) { await send(pendingAsk ? `${taught}\n\n${pendingAsk}` : taught); await incr("playbook_answers"); return; }
      await recordQuestion({ channel: "Instagram", text });
    }
    await saveIg(sid, { esc: true, escAt: Date.now() });
    if (ack && (await allow(`igack:${sid}`, 6 * HOUR))) await send((await draftHold({ text, name })) || ESCALATION_ACK);
    await incr("ig_escalations");
    console.log(`ESCALATE ig ${sid} (${reason}): ${text.slice(0, 120)}`);
    await logNeedsTeam({ channel: "Instagram", contact: label, name: name || label, reason, lastMsg: text, reply: ack ? "(holding reply sent)" : "" });
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
      await logExchange({ channel: "Instagram", contact: label, lead: "(call booked)", agent: `WhatsApp confirmation sent to +${waId}` });
      return { ...q, waConfirmSent: true };
    } catch (e) {
      console.error("call confirmation on WhatsApp failed:", e.message);
      await logNeedsTeam({ channel: "Instagram", contact: label, name: name || label, reason: "call-confirmation-failed", lastMsg: text }).catch(() => {});
      return q;
    }
  };

  try {
    let c = await saveIg(sid, { lastIn: Date.now(), name: name || undefined, username: username || undefined });
    pendingAsk = c.q?.stage === "asking" ? pendingQuestion(c.q) : "";
    const d = decide(text, { name });

    if (OPTOUT.test(text)) {
      await saveIg(sid, { dnc: true });
      await send("Understood, we won't message you again. Thank you for your time.");
      return ok();
    }
    if (c.dnc) return ok();

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
    if (c.esc || c.q?.stage === "paused" || c.kind === "vendor") return ok("with team"); // after a hand-over the agent stays quiet
    if (mediaCount && !message) {
      if (!c.q) { if (await allow(`igreply:${sid}:open`, 6 * HOUR)) { await saveIg(sid, { greeted: true }); await send(REF_OPEN); } }
      else if (["asking", "confirm", "call", "slots", "email"].includes(c.q.stage) && (await allow(`igmediaack:${sid}`, 10 * 60_000))) {
        const again = c.q.stage === "asking" ? pendingQuestion(c.q) : "";
        await send(again ? `${REF_THANKS}\n\n${again}` : REF_THANKS);
      }
      return ok("media reference");
    }
    if (mediaCount) text = message; // answer the words; the file is noted below

    const inFlow = ["asking", "confirm", "call", "slots", "email"].includes(c.q?.stage);
    const isVendor = c.kind === "vendor";
    const canQualify = !isVendor && c.q?.stage !== "done";
    const priceQ = isPriceQuestion(text);
    const guides = guidesFor(text); // a page on the website answers this in detail: share the link
    const moneyish = (hardMoney(text) && !guides.length) || (!inFlow && /\b(available|availability|book|booking)\b/i.test(text));
    const firstTouch = canQualify && !inFlow && !c.q && !CLIENT.test(text) && d.intent !== "vendor_signup";

    if (moneyish && !firstTouch) { await toHuman("money-or-commitment"); return ok(); }
    if (CLIENT.test(text)) { await toHuman("existing-client"); return ok(); }

    if (d.intent === "vendor_signup" && (!inFlow || d.strong)) {
      await saveIg(sid, { kind: "vendor", ...(c.q ? { q: { ...c.q, stage: "done" } } : {}) });
      if (await allow(`igreply:${sid}:vendor`, 6 * HOUR)) { await send(d.text); await incr("ig_vendor_links_sent"); }
      return ok();
    }

    // The chat is finished (call booked, declined, ...). Whatever they send now is answered in context by Claude, like a person would.
    if (!isVendor && c.q?.stage === "done") {
      const ph = extractPhone(text), em = extractEmail(text);
      const shared = { number: ph.status === "ok" ? `+${ph.number}` : "", email: em };
      const out = await draftAfter({ text, name, context: doneContext(c.q), shared, greeted: true });
      if (!out || out.handover !== "none") { await toHuman(out?.handover === "change" ? "call-time-request" : "lead-question"); return ok(); }
      const nq = applyAfter(c.q, text, { ...shared, fields: out.fields });
      await saveIg(sid, { q: nq });
      await upsertInstagramLead(sid, name || label, nq, { notes: nq.notes, lastMsg: text.slice(0, 200) });
      await send(out.reply);
      if (out.news) await logNeedsTeam({ channel: "Instagram", contact: label, name: name || label, reason: "lead-added-details", lastMsg: text });
      if (shared.number) { const sent = await confirmOnWhatsApp(nq); if (sent.waConfirmSent) await saveIg(sid, { q: sent }); } // their number arrived after the booking
      return ok();
    }
    if (!canQualify && !inFlow) return ok("not a client chat");

    // A bare "Hi": ask how we can help before the questions (could be anyone).
    if (firstTouch && GREETING.test(text)) {
      if (await allow(`igreply:${sid}:open`, 6 * HOUR)) {
        await saveIg(sid, { greeted: true });
        await send("Hello!\n\nThank you for reaching out to Saffron Collective 🌼\n\nHow can we help you today?");
        await incr("ig_open_greetings");
      }
      return ok();
    }
    if (firstTouch) {
      const who = await classifySender({ text, name });
      if (who !== "client") {
        if (who === "vendor") await saveIg(sid, { kind: "vendor" });
        await toHuman(who === "vendor" ? "looks-like-vendor" : "who-is-this");
        return ok();
      }
    }

    let q = c.q || newState({}, "Instagram", "instagram");
    if (c.greeted && !q.greeted) q = { ...q, greeted: true };
    if (c.refShared && !q.refNoted) q = { ...q, refNoted: true, notes: [q.notes, REF_NOTE].filter(Boolean).join(" / ") };
    const asking = q.stage === "new" || q.stage === "asking";
    const ph = extractPhone(text);
    const extracted = asking && !GREETING.test(text) ? await extractFields(text, q.asked === "number" ? null : q.asked) : {};
    delete extracted.number;
    if (ph.status === "ok") extracted.number = `+${ph.number}`;
    if (ph.status === "ambiguous") extracted.numberAmbiguous = true;
    let opener = "";
    if (firstTouch && !GREETING.test(text)) opener = (await draftOpening({ text, name, greeted: c.greeted })) || "";
    const pre = asking ? [priceQ ? priceAnswer(text) : "", guides.length ? guideText(guides) : ""].filter(Boolean).join("\n\n") : "";
    if (guides.length && ["confirm", "call"].includes(q.stage) && (await allow(`igguide:${sid}:${guides[0].url}`, 6 * HOUR))) {
      await send(guideText(guides)); await incr("guide_links_sent"); return ok(); // after the summary: just the link, state unchanged
    }
    // Booking the Founders' call: they choose a time, then give an email, then the event is created.
    const consultDeps = { offer: () => offerSlots(), book: (a) => bookConsult({ ...a, name: name || label, source: "Instagram", details: detailsText(a.fields) }) };
    if (["slots", "email"].includes(q.stage) && calendarEnabled()) {
      const cr = await consultTurn(q, text, consultDeps);
      if (cr) {
        if (cr.kind === "escalate") { await toHuman("lead-question"); return ok(); }
        const nq = cr.booked ? { ...cr.q, notes: [cr.q.notes, `Call booked: ${cr.booked.label} (${cr.q.callPref === "phone" ? "phone" : "Meet"})`].filter(Boolean).join(" / ") } : cr.q;
        await saveIg(sid, { q: nq });
        await upsertInstagramLead(sid, name || label, nq, { notes: nq.notes, lastMsg: text.slice(0, 200), done: true });
        await send(cr.reply);
        if (cr.booked) {
          await incr("calls_booked");
          const sent = await confirmOnWhatsApp(nq);
          if (sent.waConfirmSent) await saveIg(sid, { q: sent });
        }
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
      const ack = await draftAck({ text, name, kind: r.kind, asked: q.asked, fields: r.q.fields });
      if (ack) r = advance(q, text, extracted, name, opener, ack);
    }
    if (r.kind === "escalate") { await toHuman("lead-question"); return ok(); }
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
    if (Object.keys(r.q.fields).length) {
      await upsertInstagramLead(sid, name || label, r.q, {
        notes: r.q.notes, lastMsg: text.slice(0, 200),
        done: ["confirmed", "call-pref", "call-declined"].includes(r.kind), // stops the 5-minute follow-up job from also messaging them
      });
    }
    await send(r.reply);
    if (pre) await incr("price_answers");
    if (r.kind === "summary") await incr("ig_leads_completed");
    if (r.kind === "confirmed") await incr("ig_leads_confirmed");
    if (r.kind === "call-pref") { await incr("calls_requested"); await toHuman("ready-for-call", false); }
    else if (r.kind === "addition") await toHuman("lead-added-details", false);
    else if (firstTouch && moneyish) await toHuman("pricing-or-availability-question", false);
  } catch (e) {
    console.error("ig webhook error", e);
    await logNeedsTeam({ channel: "Instagram", contact: label, name: name || label, reason: "send-failed", lastMsg: text }).catch(() => {});
  }
  return ok();
};
