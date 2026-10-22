import { advance, newState } from "./qualify.mjs";
import { localFields } from "./claude.mjs";
import { startConsult, consultTurn, startReschedule, wantsReschedule } from "./consult.mjs";
import { freeSlots, pickFor, pickOffers } from "./calendar.mjs";
import { extractPhone } from "./phone.mjs";

// Replays a scripted chat through the same question flow and call-booking logic the live agent uses, with a pretend calendar
// and without Claude (the plain-code reading of each message stands in for it). Every chat that went wrong in real life can be
// written down as a scenario file in test/scenarios/ and then stays fixed for good. Escalation rules and Claude's written replies
// (openings, reactions) are not part of this; it checks the fixed wording and the flow.
//
// A scenario: { name, channel: "instagram"|"whatsapp", now: ISO time, busy?: [{start,end}], turns: [{ lead, reply?: [regex...], notReply?: [regex...], stage?, fields?: {k: v}, kind? }] }
export async function replay(scenario) {
  const now = Date.parse(scenario.now || "2026-10-22T10:00:00+05:30");
  const channel = scenario.channel || "instagram";
  let n = 0;
  const deps = {
    now: () => now, waId: channel === "whatsapp" ? "919876543210" : undefined,
    offer: async (req) => { const free = freeSlots({ now, busy: scenario.busy || [], from: req?.dayMs || 0 }); return req ? pickFor(free, req) : pickOffers(free); },
    book: async (a) => ({ ok: true, meetLink: "https://meet.google.com/test", start: a.start, eventId: `ev-${++n}` }),
    move: async (a) => ({ ok: true, start: a.start }),
  };
  let q = newState({}, channel === "instagram" ? "Instagram" : "WhatsApp", channel);
  if (channel === "whatsapp") q.fields.number = "+919876543210";
  const transcript = [];
  for (const turn of scenario.turns) {
    const text = turn.lead;
    let r;
    if (["slots", "email"].includes(q.stage)) r = await consultTurn(q, text, deps);
    else if (q.stage === "done" && q.callBooked?.eventId && wantsReschedule(text)) r = await startReschedule(q, text, deps);
    else {
      const asking = q.stage === "new" || q.stage === "asking";
      const extracted = asking ? localFields(text, q.asked === "number" ? null : q.asked) : {};
      delete extracted.number;
      const ph = extractPhone(text);
      if (ph.status === "ok" && channel === "instagram") extracted.number = `+${ph.number}`;
      r = advance(q, text, extracted, turn.name || "");
      if (r.kind === "call-pref") r = (await startConsult({ ...r.q, fields: { ...r.q.fields, number: q.fields.number || r.q.fields.number } }, deps)) || r;
    }
    if (!r) { transcript.push({ lead: text, reply: "", kind: "none", q }); continue; }
    q = r.q || q;
    transcript.push({ lead: text, reply: r.reply || "", kind: r.kind, escalate: r.escalate, q });
  }
  return transcript;
}

// Checks a transcript against the scenario's expectations. Returns a list of problems (empty = passed).
export function check(scenario, transcript) {
  const problems = [];
  scenario.turns.forEach((turn, i) => {
    const got = transcript[i];
    const where = `turn ${i + 1} ("${turn.lead.slice(0, 40)}")`;
    for (const re of turn.reply || []) if (!new RegExp(re, "i").test(got.reply)) problems.push(`${where}: reply should match /${re}/ but was: ${got.reply.slice(0, 160)}`);
    for (const re of turn.notReply || []) if (new RegExp(re, "i").test(got.reply)) problems.push(`${where}: reply should NOT match /${re}/ but was: ${got.reply.slice(0, 160)}`);
    if (turn.kind && got.kind !== turn.kind) problems.push(`${where}: kind should be ${turn.kind} but was ${got.kind}`);
    if (turn.stage && got.q?.stage !== turn.stage) problems.push(`${where}: stage should be ${turn.stage} but was ${got.q?.stage}`);
    for (const [k, v] of Object.entries(turn.fields || {})) if (!new RegExp(`^${v}$`, "i").test(String(got.q?.fields?.[k] ?? ""))) problems.push(`${where}: ${k} should be "${v}" but was "${got.q?.fields?.[k] ?? ""}"`);
  });
  return problems;
}
