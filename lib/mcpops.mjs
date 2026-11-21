// The operator as a connector Claude can use ("agent" tools without texting from WhatsApp). Speaks MCP over plain JSON-RPC (one POST, one answer).
// L73 began read-only; L75 adds the write tools the owner asked for (send the approved catch-up, send one message, answer a lead, pause or resume the agent).
// Every write goes through the same gate as the WhatsApp orders (the chat is read and handed to Claude first, lib/presend.mjs), is marked as a write so the client asks the owner before each call,
// and is limited to one message per lead every few minutes.
// The tools are thin on purpose: Claude does the thinking in the chat with the owner; the safety checks stay in the code behind the tools.
import { timingSafeEqual } from "node:crypto";

export const PROTOCOL = "2025-03-26";
const obj = (properties = {}, required = []) => ({ type: "object", properties, required });
const str = (description) => ({ type: "string", description });

const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
export const MCP_TOOLS = [
  { name: "list_chats", annotations: READ, description: "List the chats the agent knows on WhatsApp and Instagram, newest first, with who spoke last and the agent's flags (needs a person, team is in the chat, held, opted out). Use first to see what is waiting.", inputSchema: obj({ channel: { type: "string", enum: ["all", "whatsapp", "instagram"] }, waiting_only: { type: "boolean", description: "Only chats where the lead wrote last and nothing has been sent since" }, limit: { type: "number", description: "At most this many (default 30, max 60)" } }) },
  { name: "read_chat", annotations: READ, description: "Read one chat in full (the real messages, oldest first) with what the agent has saved about the lead (stage, details, flags). Find the lead by name, @instagram handle or phone number.", inputSchema: obj({ who: str("Name, @handle or phone number"), messages: { type: "number", description: "How many recent messages (default 30, max 60)" } }, ["who"]) },
  { name: "catch_up_start", annotations: READ, description: "Start the catch-up review: the agent re-reads recent chats on both channels, finds the ones it handled badly or never answered, and drafts a corrective message for each. It takes a few minutes. Sends NOTHING. Then call catch_up_result.", inputSchema: obj({ channel: { type: "string", enum: ["all", "whatsapp", "instagram"] } }) },
  { name: "catch_up_result", annotations: READ, description: "The preview from catch_up_start: who would be written to, what went wrong, the exact words, who is for the team. Says if it is still running.", inputSchema: obj() },
  { name: "catch_up_send", annotations: WRITE, description: "SENDS the drafts from the last catch-up preview to those leads (WhatsApp and Instagram). Call only after the owner has seen the preview and said to send; the owner may name people to leave out. Each chat is read again first and anyone who wrote since the preview is skipped. The preview expires after 12 hours.", inputSchema: obj({ skip: { type: "array", items: { type: "string" }, description: "Names to leave out, as shown in the preview" } }) },
  { name: "send_message", annotations: WRITE, description: "SENDS one message to one lead now, in the owner's words (or words the owner approved). Refused if it states a price, a promise or a link that is not ours, if their 24-hour window has closed, or if we messaged them in the last few minutes. The chat is read first.", inputSchema: obj({ who: str("Name, @handle or phone number"), text: str("The exact message to send") }, ["who", "text"]) },
  { name: "answer_lead", annotations: WRITE, description: "Releases a WhatsApp chat the agent was holding and lets the agent answer the lead's last unanswered message itself (read first, with the published facts). Refused if the last message is ours or a person on the team has written.", inputSchema: obj({ who: str("Name or phone number") }, ["who"]) },
  { name: "pause_agent", annotations: WRITE, description: "Stops the agent answering a lead (a person will handle them). Sends nothing.", inputSchema: obj({ who: str("Name, @handle or phone number") }, ["who"]) },
  { name: "resume_agent", annotations: WRITE, description: "Lets the agent answer a lead again. Sends nothing.", inputSchema: obj({ who: str("Name, @handle or phone number") }, ["who"]) },
];

const text = (t, isError = false) => ({ content: [{ type: "text", text: String(t) }], ...(isError ? { isError: true } : {}) });
const clip = (s, n = 400) => String(s ?? "").slice(0, n);
const ago = (t, now) => { if (!t) return "never"; const h = Math.round((now - t) / 3600_000); return h < 1 ? "under an hour ago" : h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`; };

export const flagsOf = (c = {}) => [c.dnc && "opted out", (c.hold || c.skip) && "held", c.humanSpoke && "team is in the chat", c.esc && !c.humanSpoke && "agent handed to a person", c.kind === "vendor" && "vendor", c.q?.stage && `stage ${c.q.stage}`].filter(Boolean);

// One lead from a name, handle or number: { f } or { err } (a message ready to give back).
async function resolveOne(who, deps) {
  const found = await deps.find(String(who || ""));
  if (!found.length) return { err: `I could not find "${clip(who, 40)}". Try the phone number with country code, or the @handle.` };
  if (found.length > 1) return { err: `More than one match for "${clip(who, 40)}": ${found.slice(0, 6).map((f) => `${f.name || "no name"} (${f.channel} ${f.channel === "WhatsApp" ? "+" + f.id : f.id})`).join(", ")}. Which one?` };
  return { f: found[0] };
}
const labelOf = (f) => `${f.name || "(no name)"} (${f.channel === "WhatsApp" ? "+" + f.id : f.id})`;

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
    const one = await resolveOne(args.who, deps);
    if (one.err) return text(one.err, true);
    const f = one.f;
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
    return text(`Preview made ${ago(s.plan.at, now)}.\n\n${s.text}\n\n(Nothing has been sent. To send these, the owner says so and you call catch_up_send, naming anyone to skip.)`);
  }
  // ---- The write tools. Each is a thin call into the same checked paths the WhatsApp orders use (lib/operatordeps.mjs); the client asks the owner before each call.
  if (name === "catch_up_send") {
    const plan = await deps.catchUpState().then((x) => x.plan);
    if (!plan?.items?.some((i) => i.kind === "send")) return text("There is no preview with messages to send. Call catch_up_start, then catch_up_result, and show the owner the drafts first.", true);
    if (Date.now() - plan.at > 12 * 3600_000) return text("The preview is more than 12 hours old, so nothing was sent. Run catch_up_start again.", true);
    return text(await deps.sendCatchUp(plan, Array.isArray(args.skip) ? args.skip.map(String) : []));
  }
  if (name === "send_message") {
    const one = await resolveOne(args.who, deps);
    if (one.err) return text(one.err, true);
    const r = await deps.sendTo(one.f, String(args.text || ""));
    return text(r.ok ? `Sent to ${labelOf(one.f)}:\n\n${r.text}` : `Not sent to ${labelOf(one.f)}: ${r.why}`, !r.ok);
  }
  if (name === "answer_lead") {
    const one = await resolveOne(args.who, deps);
    if (one.err) return text(one.err, true);
    if (one.f.channel !== "WhatsApp") return text("answer_lead works for WhatsApp chats. For an Instagram chat, use send_message with the words, or catch_up_start.", true);
    const r = await deps.answerLead(one.f.id);
    return text(r.ok ? `${labelOf(one.f)} is released and the agent is answering their message now (it reads the chat first).${r.reopened ? " Their window had closed, so the approved check-in message went instead." : ""}` : `Not done for ${labelOf(one.f)}: ${r.why}`, !r.ok);
  }
  if (name === "pause_agent" || name === "resume_agent") {
    const one = await resolveOne(args.who, deps);
    if (one.err) return text(one.err, true);
    await deps.setPaused(one.f, name === "pause_agent");
    return text(name === "pause_agent" ? `The agent will stay out of the chat with ${labelOf(one.f)}.` : `The agent will answer ${labelOf(one.f)} again.`);
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
    case "initialize": return reply({ protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "saffron-operator", version: "1.0.0" }, instructions: "Saffron Collective's lead agent. Read first (list_chats, read_chat, catch_up_start/result). Sending tools (catch_up_send, send_message, answer_lead) reach real leads: use them only when the owner has said to, after showing the exact words. Never send on your own initiative." });
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
