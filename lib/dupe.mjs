// The same message handled twice (ManyChat can fire twice, from a few seconds to about 40 seconds apart). The second run must never read the same words as a
// NEW message: the chat has moved on, so it would answer the NEXT question with them (L37, L66).
// `before` is the chat's state as the run before left it; `real` is Instagram's own list of the chat (oldest first), or null when it cannot be read.
export const DUP_WINDOW_MS = 120_000;
export function isRepeatRun({ before = {}, text = "", now = Date.now(), real = null } = {}) {
  const key = String(text).trim().slice(0, 120);
  if (!key || before.lastInKey !== key) return false;
  if (now - (before.lastIn || 0) >= DUP_WINDOW_MS) return false;
  if (!((before.lastOut || 0) > (before.lastIn || 0))) return false; // we have not answered it yet: a run still in flight is held by the lock
  // A real second message with the same words ("Yes", "Ok") arrives after our reply: Instagram shows the lead's message as the newest one, after one of ours.
  if (Array.isArray(real) && real.length && real.at(-1).from === "customer" && real.some((m) => m.from === "us")) return false;
  return true;
}

// A newer message from the lead that asks something ("Can you share details of both Delhi and Rishikesh ?") is answered by its own run (a taught answer, a facts answer or a
// hold). The older run, still writing its reply, must not add the NEXT flow question on top, or she gets "how many guests?" and "the team will get back to you" together (Paavni, L69).
export const hasWaitingQuestion = (texts = []) => texts.some((t) => /\?/.test(String(t || "")));

