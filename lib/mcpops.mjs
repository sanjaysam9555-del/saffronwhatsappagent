// The operator as a connector Claude can use ("agent" tools without texting from WhatsApp). Speaks MCP over plain JSON-RPC (one POST, one answer).
// Read-only to begin with (L73): list the chats, read one in full, and ask for the catch-up preview. Nothing here sends a message to a lead.
// The tools are thin on purpose: Claude does the thinking in the chat with the owner; the safety checks stay in the code behind the tools.
import { timingSafeEqual } from "node:crypto";

export const PROTOCOL = "2025-03-26";
const obj = (properties = {}, required = []) => ({ type: "object", properties, required });
const str = (description) => ({ type: "string", description });

export const MCP_TOOLS = [
  { name: "list_chats", description: "List the chats the agent knows on WhatsApp and Instagram, newest first, with who spoke last and the agent's flags (needs a person, team is in the chat, held, opted out). Use first to see what is waiting.", inputSchema: obj({ channel: { type: "string", enum: ["all", "whatsapp", "instagram"] }, waiting_only: { type: "boolean", description: "Only chats where the lead wrote last and nothing has been sent since" }, limit: { type: "number", description: "At most this many (default 30, max 60)" } }) },
  { name: "read_chat", description: "Read one chat in full (the real messages, oldest first) with what the agent has saved about the lead (stage, details, flags). Find the lead by name, @instagram handle or phone number.", inputSchema: obj({ who: str("Name, @handle or phone number"), messages: { type: "number", description: "How many recent messages (default 30, max 60)" } }, ["who"]) },
  { name: "catch_up_start", description: "Start the catch-up review: the agent re-reads recent chats on both channels, finds the ones it handled badly or never answered, and drafts a corrective message for each. It takes a few minutes. Sends NOTHING. Then call catch_up_result.", inputSchema: obj({ channel: { type: "string", enum: ["all", "whatsapp", "instagram"] } }) },
  { name: "catch_up_result", description: "The preview from catch_up_start: who would be written to, what went wrong, the exact words, who is for the team. Says if it is still running.", inputSchema: obj() },
];

const text = (t, isError = false) => ({ content: [{ type: "text", text: String(t) }], ...(isError ? { isError: true } : {}) });
const clip = (s, n = 400) => String(s ?? "").slice(0, n);
const ago = (t, now) => { if (!t) return "never"; const h = Math.round((now - t) / 3600_000); return h < 1 ? "under an hour ago" : h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`; };

export const flagsOf = (c = {}) => [c.dnc && "opted out", (c.hold || c.skip) && "held", c.humanSpoke && "team is in the chat", c.esc && !c.humanSpoke && "agent handed to a person", c.kind === "vendor" && "vendor", c.q?.stage && `stage ${c.q.stage}`].filter(Boolean);

// deps: { wa(): [[id, c]], ig(): [{sid, ...c}], find(who): [{channel,id,name,c}], read(channel,id,c): msgs|null, startCatchUp(scope), catchUpState(): {status, plan}, now() }
export async function callTool(name, args = {}, deps) {
  const now = deps.now ? deps.now() : Date.now();
  if (name === "list_chats") {
    const scope = ["whatsapp", "instagram"].includes(args.channel) ? args.channel : "all";
    const rows = [];
    if (scope !== "instagram") for (const [id, c] of await deps.wa()) rows.push({ channel: "WhatsApp", id: `+${id}`, name: c.name || "", c });
    if (scope !== "whatsapp") for (const c of await deps.ig()) rows.push({ channel: "Instagram", id: c.username ? `@${c.username}` : `ig:${c.sid}`, name: c.name || "", c });
    const waiting = (c) => (c.lastIn || 0) > (c.lastOut || 0);
    const list = rows.filter((r) => r.c.lastIn).filter((r) => !args.waiting_only || waiting(r.c)).sort((a, b) => b.c.lastIn - a.c.lastIn).slice(0, Math.min(Number(args.limit) || 30, 60));
    if (!list.length) return text("No chats match.");
    return text(list.map((r) => `${r.name || "(no name)"} | ${r.channel} ${r.id} | lead wrote ${ago(r.c.lastIn, now)}, we wrote ${ago(r.c.lastOut, now)} | ${waiting(r.c) ? "WAITING for us" : "we spoke last"}${flagsOf(r.c).length ? " | " + flagsOf(r.c).join(", ") : ""}`).join("\n"));
  }
  if (name === "read_chat") {
    const found = await deps.find(String(args.who || ""));
    if (!found.length) return text(`I could not find "${clip(args.who, 40)}". Try the phone number with country code, or the @handle.`, true);
    if (found.length > 1) return text(`More than one match for "${clip(args.who, 40)}": ${found.slice(0, 6).map((f) => `${f.name || "no name"} (${f.channel} ${f.channel === "WhatsApp" ? "+" + f.id : f.id})`).join(", ")}. Which one?`, true);
    const f = found[0];
    const msgs = await deps.read(f.channel, f.id, f.c);
    if (!Array.isArray(msgs) || !msgs.length) return text(`I could not read the chat with ${f.name || f.id} just now.`, true);
    const n = Math.min(Number(args.messages) || 30, 60);
    const body = msgs.slice(-n).map((m) => `${m.from === "customer" ? "THEM" : "US"}${m.t ? " [" + new Date(m.t).toISOString().slice(0, 16).replace("T", " ") + " UTC]" : ""}: ${clip(m.text, 600)}`).join("\n");
    const fields = Object.entries(f.c.q?.fields || {}).filter(([, v]) => v && v !== "Pending").map(([k, v]) => `${k}=${clip(v, 60)}`).join(", ");
    return text(`${f.name || "(no name)"} | ${f.channel} ${f.channel === "WhatsApp" ? "+" + f.id : f.id}\nLead last wrote ${ago(f.c.lastIn, now)}; we last wrote ${ago(f.c.lastOut, now)}.\nFlags: ${flagsOf(f.c).join(", ") || "none"}\nSaved details: ${fields || "none"}\n\n${body}`);
  }
  if (name === "catch_up_start") {
    const scope = ["whatsapp", "instagram"].includes(args.channel) ? args.channel : "all";
    const r = await deps.startCatchUp(scope);
    return text(r.ok ? "Started. The agent is re-reading the chats; this takes a few minutes. Nothing is sent. Call catch_up_result in a few minutes." : `Could not start: ${r.why}`, !r.ok);
  }
  if (name === "catch_up_result") {
    const s = await deps.catchUpState();
    if (s.status?.state === "running" && Date.now() - s.status.startedAt < 20 * 60_000) return text("Still running. Ask again in a minute or two.");
    if (!s.plan) return text("There is no preview yet. Call catch_up_start first.");
    return text(`Preview made ${ago(s.plan.at, now)}.\n\n${s.text}\n\n(Nothing has been sent. Sending is done by the owner's order "agent, catch up send" on WhatsApp for now.)`);
  }
  return text(`Unknown tool ${name}`, true);
}

// One JSON-RPC message in, the answer (or null for a notification) out.
export async function handleRpc(msg, deps) {
  const id = msg?.id;
  const reply = (result) => ({ jsonrpc: "2.0", id, result });
  const fail = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(-32600, "Invalid request");
  if (id === undefined || String(msg.method).startsWith("notifications/")) return null;
  switch (msg.method) {
    case "initialize": return reply({ protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "saffron-operator", version: "1.0.0" }, instructions: "Saffron Collective's lead agent. Read-only: list chats, read a chat, review pending chats. Never send anything from here; sends need the owner's order." });
    case "ping": return reply({});
    case "tools/list": return reply({ tools: MCP_TOOLS });
    case "tools/call": {
      const t = MCP_TOOLS.find((x) => x.name === msg.params?.name);
      if (!t) return fail(-32602, "Unknown tool");
      try { return reply(await callTool(t.name, msg.params?.arguments || {}, deps)); }
      catch (e) { return reply(text(`That did not work: ${clip(e.message, 200)}`, true)); }
    }
    default: return fail(-32601, "Method not found");
  }
}

// The key arrives in the address (?key=) because Claude's connector form takes only an address, or as a Bearer token. Compared in constant time.
export function keyOk(given, want) {
  const a = Buffer.from(String(given || "")), b = Buffer.from(String(want || ""));
  return b.length >= 16 && a.length === b.length && timingSafeEqual(a, b);
}
