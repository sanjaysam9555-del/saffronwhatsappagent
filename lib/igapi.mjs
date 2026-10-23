// Reads the real Instagram conversation through Meta's Instagram API (the app "Saffron Agent"), so Claude sees the whole chat,
// including messages the team typed by hand in Instagram. Read-only: nothing is sent and no webhook is used, so ManyChat is not disturbed.
// Needs INSTAGRAM_ACCESS_TOKEN. Meta only returns the content of the latest 20 messages of a chat. Never throws; null means "could not read it".
const BASE = "https://graph.instagram.com/v24.0";
const tokenOn = () => Boolean(process.env.INSTAGRAM_ACCESS_TOKEN);
export const igApiOn = tokenOn;

async function get(path, params = {}) {
  const url = new URL(`${BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", process.env.INSTAGRAM_ACCESS_TOKEN);
  const res = await fetch(url);
  if (!res.ok) { // Meta's error text never holds the token; it says what is wrong (permission, id, ...)
    const e = (await res.json().catch(() => ({}))).error || {};
    console.error(`instagram api ${path.split("/")[0]}: ${res.status} code=${e.code ?? ""} ${String(e.message ?? "").slice(0, 200)}`);
    return null;
  }
  return res.json();
}

// Oldest first: [{from: "customer"|"us", text}]. Instagram ids differ from app to app (ManyChat's id for a person is not ours), so the
// chat is found by the person's Instagram username in our recent conversations. Meta lists the most recently active chats first, and a
// lead who has just written is at the top.
export async function getInstagramHistory({ username, n = 12 } = {}) {
  const want = String(username || "").replace(/^@/, "").trim().toLowerCase();
  if (!tokenOn() || !want) return null;
  try {
    const list = await get("me/conversations", { platform: "instagram", fields: "participants", limit: "50" });
    let convId = "", theirId = "";
    for (const c of list?.data || []) {
      const p = (c.participants?.data || []).find((x) => String(x.username || "").toLowerCase() === want);
      if (p) { convId = c.id; theirId = String(p.id); break; }
    }
    if (!convId) { console.log(`ig-history: no conversation with that username among ${(list?.data || []).length} recent chats`); return null; }
    const msgsList = await get(convId, { fields: "messages" });
    const ids = (msgsList?.messages?.data || []).slice(0, n).map((m) => m.id); // newest first
    const msgs = (await Promise.all(ids.map((id) => get(id, { fields: "id,created_time,from,message" }).catch(() => null)))).filter((m) => m && m.message);
    msgs.reverse();
    return msgs.map((m) => ({ from: String(m.from?.id) === theirId ? "customer" : "us", text: String(m.message).slice(0, 600) }));
  } catch (e) { console.error("instagram api:", e.message); return null; }
}

// The message(s) being answered right now are already the last entries of the chat; Claude gets them separately, so drop them here.
export function withoutCurrent(history, text) {
  const h = [...(history || [])], t = String(text || "");
  while (h.length && h[h.length - 1].from === "customer" && t.includes(h[h.length - 1].text.slice(0, 600))) h.pop();
  return h;
}

// Test helper ("agenttest igdebug"): asks Meta a few different ways and reports counts and error codes only (never the token, never message text).
export async function debugInstagramApi(username) {
  if (!tokenOn()) return "INSTAGRAM_ACCESS_TOKEN is not set in Netlify.";
  const want = String(username || "").replace(/^@/, "").toLowerCase();
  const probe = async (label, path, params) => {
    try {
      const url = new URL(`${BASE}/${path}`);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      url.searchParams.set("access_token", process.env.INSTAGRAM_ACCESS_TOKEN);
      const res = await fetch(url);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return { line: `${label}: error ${res.status} code=${j.error?.code ?? ""} ${String(j.error?.message ?? "").slice(0, 120)}`, j };
      return { line: `${label}: ok`, j };
    } catch (e) { return { line: `${label}: failed ${String(e.message).slice(0, 80)}`, j: {} }; }
  };
  const lines = [];
  const me = await probe("token owner", "me", { fields: "user_id,username,account_type" });
  lines.push(me.line + (me.j.username ? ` (@${me.j.username}, ${me.j.account_type || "?"})` : ""));
  const a = await probe("chats, platform only", "me/conversations", { platform: "instagram" });
  lines.push(`${a.line}${a.j.data ? `, ${a.j.data.length} chats` : ""}`);
  const b = await probe("chats, with participants", "me/conversations", { platform: "instagram", fields: "participants", limit: "50" });
  const inList = (b.j.data || []).some((c) => (c.participants?.data || []).some((p) => String(p.username || "").toLowerCase() === want));
  lines.push(`${b.line}${b.j.data ? `, ${b.j.data.length} chats, this sender's username found: ${inList}` : ""}`);
  const c = await probe("chats, no platform", "me/conversations", {});
  lines.push(`${c.line}${c.j.data ? `, ${c.j.data.length} chats` : ""}`);
  return lines.join("\n");
}

// For a message ManyChat could not give us as text (a typed phone number that Instagram shows as a "Phone number" card):
// the newest message of the chat, read from Meta, but only if the lead sent it and it is fresh. An older message is never reused.
const parseTime = (t) => { const ms = Date.parse(String(t ?? "").replace(/([+-]\d\d)(\d\d)$/, "$1:$2")); return Number.isFinite(ms) ? ms : 0; };
export async function getLatestCustomerText({ username, withinMs = 3 * 60_000, tries = 3, waitMs = 3000 } = {}) {
  const want = String(username || "").replace(/^@/, "").trim().toLowerCase();
  if (!tokenOn() || !want) return "";
  for (let i = 0; i < tries; i++) { // Meta can take a few seconds to show the newest message
    if (i) await new Promise((r) => setTimeout(r, waitMs));
    const { text, why } = await latestOnce(want, withinMs);
    if (text) return text;
    console.log(`ig-recover: try ${i + 1}/${tries} empty (${why})`);
  }
  return "";
}
async function latestOnce(want, withinMs) {
  try {
    const list = await get("me/conversations", { platform: "instagram", fields: "participants", limit: "50" });
    let convId = "", theirId = "";
    for (const c of list?.data || []) {
      const p = (c.participants?.data || []).find((x) => String(x.username || "").toLowerCase() === want);
      if (p) { convId = c.id; theirId = String(p.id); break; }
    }
    if (!convId) return { text: "", why: "chat not found" };
    const newest = (await get(convId, { fields: "messages" }))?.messages?.data?.[0]; // Meta lists the newest message first
    if (!newest?.id) return { text: "", why: "no messages listed" };
    const m = await get(newest.id, { fields: "id,created_time,from,message" });
    if (!m) return { text: "", why: "message not readable" };
    const mine = String(m.from?.id) === theirId;
    const hasText = Boolean(String(m.message ?? "").trim());
    const at = parseTime(m.created_time), age = at ? Math.round((Date.now() - at) / 1000) : -1;
    if (!mine || !hasText || !at || age * 1000 > withinMs) return { text: "", why: `newest from ${mine ? "lead" : "us"}, text=${hasText}, age=${age}s` };
    return { text: String(m.message).trim().slice(0, 600), why: "" };
  } catch (e) { console.error("instagram api:", e.message); return { text: "", why: "error" }; }
}
