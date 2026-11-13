// L51: a daily check that the parts a booking depends on still work, so a break is found by us in the morning and not by a lead.
// It sends NOTHING to a lead and calls no paid model. It checks: the question flow answers a new lead, the call hours produce times, the live calendar
// can be read and returns free times, Wati answers, the leads sheet can be read, and the settings the agent relies on are present.
// It cannot prove Claude's wording is good (the tests and your corrections are for that).
import { advance, newState } from "./qualify.mjs";
import { freeSlots, pickOffers } from "./calendar.mjs";

// checks: [{ name, run: async () => string | void }]. A check passes unless it throws (or returns { warn: "..." }).
export async function runChecks(checks) {
  const out = [];
  for (const c of checks) {
    try {
      const r = await c.run();
      out.push(r?.warn ? { name: c.name, ok: true, warn: r.warn } : { name: c.name, ok: true });
    } catch (e) { out.push({ name: c.name, ok: false, why: String(e?.message || e).slice(0, 140) }); }
  }
  return out;
}
export const failures = (results) => results.filter((r) => !r.ok);
export const summary = (results) => {
  const bad = failures(results), warn = results.filter((r) => r.ok && r.warn);
  return `${results.length - bad.length}/${results.length} checks passed` + (bad.length ? `. FAILED: ${bad.map((b) => `${b.name} (${b.why})`).join("; ")}` : "") + (warn.length ? `. Not set: ${warn.map((w) => w.warn).join("; ")}` : "");
};

// The pure checks (no network).
export const pureChecks = (now = Date.now()) => [
  { name: "question flow", run: async () => {
    const r = advance(newState({}, "WhatsApp", "whatsapp"), "Hi, we are planning a wedding", { occasion: "wedding" }, "Test", "", "", "");
    if (!r?.reply || !r?.q) throw new Error("the flow gave no reply for a new lead");
  } },
  { name: "call hours", run: async () => {
    const slots = freeSlots({ now, busy: [], perDay: {} });
    if (slots.length < 10) throw new Error(`only ${slots.length} free times in the next two weeks with an empty calendar`);
    if (pickOffers(slots).length < 3) throw new Error("could not pick three times to offer");
  } },
];
