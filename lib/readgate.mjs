// THE ONE RULE: no message goes to a lead unless, in this same run, (1) the real chat was read and (2) Claude was handed that chat.
// (docs/LESSONS.md L35.) This file is the proof, and it is enforced at the only two places a message can leave the system:
// sendSessionMessage / sendTemplateMessage in lib/wati.mjs and sendInstagramText in lib/manychat.mjs. Each calls assertContext() first.
//
//  withChat(fn)         every function that can send (a webhook handler, a scheduled job) runs inside this, so a run has its own record
//  noteRead(id)         the chat of this person was read from Wati / Instagram (getRecentMessages does it for WhatsApp)
//  claudeSaw(history)   Claude was given a chat history and answered (understandChat, routeMessage, contextCheck...). Counts for every chat read so far.
//  assertContext(to)    called by the two exits. Throws ContextNotRead when the chat was not read or Claude never saw it.
//
// Not covered, and said plainly: this proves the chat was read and handed to Claude. It cannot prove Claude judged it well (that is what the tests,
// lib/guard.mjs and your corrections are for). Messages to your own number (alerts, digests, owner replies) are exempt: they are not to a lead.
// CONTEXT_GATE=log only logs a breach; CONTEXT_GATE=off switches the check off (an emergency switch). The default, with nothing set, is to block.
import { AsyncLocalStorage } from "node:async_hooks";

const als = new AsyncLocalStorage();
export class ContextNotRead extends Error {
  constructor(msg, why) { super(msg); this.name = "ContextNotRead"; this.why = why; }
}

export const gateMode = () => {
  const m = String(process.env.CONTEXT_GATE || "enforce").trim().toLowerCase();
  return m === "off" || m === "log" ? m : "enforce";
};

// A phone number becomes digits only; an Instagram id stays as it is.
export const idOf = (x) => { const s = String(x ?? "").trim().replace(/^@/, ""); return /^\+?[\d\s()-]{8,}$/.test(s) ? s.replace(/\D/g, "") : s; };

export function withChat(fn) {
  return als.run({ read: new Set(), understood: new Set(), exempt: new Set(), memo: new Map(), blocked: 0 }, fn);
}
const ctx = () => als.getStore();

export function noteRead(id) { const c = ctx(); if (c && id !== undefined && id !== null && String(id) !== "") c.read.add(idOf(id)); }
// Claude was given a chat history (an array, possibly empty for a brand-new chat) and answered. Every chat read so far counts as understood.
export function claudeSaw(history) {
  const c = ctx();
  if (c && Array.isArray(history)) for (const id of c.read) c.understood.add(id);
}
// Test helpers and similar: this recipient needs no read (named in the structural test, so it cannot spread quietly).
export function exemptFromGate(id) { const c = ctx(); if (c) c.exempt.add(idOf(id)); }
// Remembers a result for the length of this run, so a second look at the same message does not cost a second Claude call.
export async function memoized(key, fn) {
  const c = ctx();
  if (!c) return fn();
  if (!c.memo.has(key)) c.memo.set(key, Promise.resolve().then(fn));
  return c.memo.get(key);
}
export const readState = (id) => { const c = ctx(), i = idOf(id); return { inRun: Boolean(c), read: Boolean(c?.read.has(i)), understood: Boolean(c?.understood.has(i)) }; };

// Messages to your own team or owner (alerts, digests, replies to an order) are not messages to a lead.
export function isInternal(id) {
  const i = idOf(id);
  const own = [process.env.OWNER_NUMBER, process.env.TEAM_ALERT_NUMBER, ...String(process.env.OPERATOR_NUMBERS || "").split(",")].map(idOf).filter(Boolean);
  return own.includes(i);
}

// What the two exits call. Returns { ok: true } or throws (or, in log mode, logs and returns { ok: false, why }).
export function assertContext(to, what = "message") {
  const mode = gateMode();
  if (mode === "off") return { ok: true };
  const i = idOf(to);
  if (isInternal(i)) return { ok: true };
  const c = ctx();
  let why = "";
  if (!c) why = "no-run-context";                        // a send path that was not wrapped in withChat
  else if (c.exempt.has(i)) return { ok: true };
  else if (!c.read.has(i)) why = "chat-not-read";        // the real chat was never read in this run
  else if (!c.understood.has(i)) why = "claude-not-given-the-chat";
  if (!why) return { ok: true };
  if (c) c.blocked++;
  const line = `CONTEXT GATE (${mode}): ${what} to ${i.slice(0, 3)}…${i.slice(-3)} ${mode === "enforce" ? "blocked" : "would be blocked"}: ${why}`;
  console.error(line);
  if (mode === "enforce") throw new ContextNotRead(line, why);
  return { ok: false, why };
}
