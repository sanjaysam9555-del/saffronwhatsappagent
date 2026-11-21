import { withChat } from "../../lib/readgate.mjs";
import { handleRpc, keyOk } from "../../lib/mcpops.mjs";
import { listContacts } from "../../lib/contacts.mjs";
import { listIgContacts } from "../../lib/igstate.mjs";
import { ownerDeps, igRead } from "../../lib/operatordeps.mjs";
import { previewText } from "../../lib/catchup.mjs";
import { getStore } from "@netlify/blobs";

// The operator as a connector (L73). Add in Claude: Settings > Connectors > Add custom connector, address
//   https://<site>.netlify.app/.netlify/functions/operator-mcp?key=<OPERATOR_MCP_KEY>
// OPERATOR_MCP_KEY must be set in Netlify (16+ characters); without it this answers 503. Read-only: no tool here sends a message to a lead.
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const last10 = (v) => String(v || "").replace(/\D/g, "").slice(-10);

const deps = {
  wa: () => listContacts(),
  ig: () => listIgContacts(),
  find: async (who) => {
    const q = String(who || "").trim().replace(/^@/, "").replace(/^ig:/, "").toLowerCase();
    if (!q) return [];
    const digits = q.replace(/\D/g, "");
    const out = [];
    for (const [id, c] of await listContacts()) if ((digits.length >= 7 && last10(id) === digits.slice(-10)) || (digits.length < 7 && String(c.name || "").toLowerCase().includes(q))) out.push({ channel: "WhatsApp", id, name: c.name || "", c });
    for (const c of await listIgContacts()) if (c.sid === q || String(c.username || "").toLowerCase() === q || (digits.length < 7 && String(c.name || "").toLowerCase().includes(q))) out.push({ channel: "Instagram", id: c.sid, name: c.name || (c.username ? `@${c.username}` : ""), c });
    return out;
  },
  read: (channel, id, c) => igRead(channel, id, c),
  startCatchUp: async (scope) => {
    const origin = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL;
    if (!origin) return { ok: false, why: "the site address is not known here" };
    const st = getStore("wa-agent");
    await st.setJSON("catchup:status", { state: "running", startedAt: Date.now(), scope });
    const res = await fetch(`${origin}/.netlify/functions/catchup-background?key=${encodeURIComponent(process.env.WEBHOOK_SECRET || "")}&scope=${scope}`, { method: "POST" });
    if (!res.ok) { await st.setJSON("catchup:status", { state: "failed", startedAt: Date.now() }); return { ok: false, why: `the review job answered ${res.status}` }; }
    return { ok: true };
  },
  catchUpState: async () => {
    const st = getStore("wa-agent");
    const [status, plan] = await Promise.all([st.get("catchup:status", { type: "json" }).catch(() => null), ownerDeps.catchUp.load()]);
    return { status, plan, text: plan ? previewText(plan) : "" };
  },
};

export default (req) => withChat(async () => {
  const url = new URL(req.url);
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const want = process.env.OPERATOR_MCP_KEY;
  if (!want) return new Response("not set up", { status: 503 });
  if (!keyOk(url.searchParams.get("key") || bearer, want)) return new Response("forbidden", { status: 403 });
  if (req.method !== "POST") return new Response("POST only", { status: 405, headers: { allow: "POST" } });
  let msg;
  try { msg = await req.json(); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }
  if (Array.isArray(msg)) { const out = (await Promise.all(msg.map((m) => handleRpc(m, deps)))).filter(Boolean); return out.length ? json(out) : new Response(null, { status: 202 }); }
  const out = await handleRpc(msg, deps);
  return out ? json(out) : new Response(null, { status: 202 });
});
