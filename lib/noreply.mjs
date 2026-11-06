// L46: every inbound lead message that ends a run without a reply leaves one line in the Agent Log, with the reason.
// The Netlify logs only last 24 hours; this does not. Never throws, never blocks the run.
import { runTrace } from "./readgate.mjs";
import { logExchange } from "./playbook.mjs";

export const noReplyLine = (trace, commit = process.env.COMMIT_REF || "") => {
  if (!trace?.inbound || trace.sent > 0) return "";
  const why = trace.why || "ended with no reason recorded";
  return `(no reply: ${why}${commit ? ` · build ${String(commit).slice(0, 7)}` : ""})`;
};

export async function logNoReply(extraWhy = "") {
  try {
    const t = runTrace();
    if (extraWhy) t.why = extraWhy;
    const line = noReplyLine(t);
    if (!line) return;
    await logExchange({ channel: t.inbound.channel, contact: t.inbound.contact, lead: t.inbound.text, agent: line });
  } catch (e) { console.error("logNoReply:", e.message); }
}
