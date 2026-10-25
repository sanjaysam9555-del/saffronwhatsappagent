// Reads the real Instagram conversation through Meta's Instagram API (the app "Saffron Agent"), so Claude sees the whole chat,
// including messages the team typed by hand in Instagram. Read-only: nothing is sent and no webhook is used, so ManyChat is not disturbed.
// Needs INSTAGRAM_ACCESS_TOKEN. Meta only returns the content of the latest 20 messages of a chat. Never throws; null means "could not read it".
import { extractPhone } from "./phone.mjs";
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

// For a message ManyChat could not give us as text. A typed message that holds a phone number is followed at once by a "Phone number"
// card (no text), so the NEWEST message is the card and the typed words sit just before it. Walk back from the newest message, skip
// cards and photos, and collect what the lead wrote since our last message (never anything older, and never from before the window).
// Returns { text, answered, ids }: answered is true when our own message is the newest (there is nothing from them left to answer).
const parseTime = (t) => { const ms = Date.parse(String(t ?? "").replace(/([+-]\d\d)(\d\d)$/, "$1:$2")); return Number.isFinite(ms) ? ms : 0; };
export async function recoverLatest({ username, withinMs = 3 * 60_000, tries = 3, waitMs = 3000 } = {}) {
  const want = String(username || "").replace(/^@/, "").trim().toLowerCase();
  if (!tokenOn() || !want) return { text: "", answered: false, ids: [] };
  let last = { text: "", answered: false, ids: [] };
  for (let i = 0; i < tries; i++) { // Meta can take a few seconds to show the newest message
    if (i) await new Promise((r) => setTimeout(r, waitMs));
    const r = await latestOnce(want, withinMs);
    last = r;
    if (r.text || r.answered) return r;
    console.log(`ig-recover: try ${i + 1}/${tries} empty (${r.why})`);
  }
  return last;
}
export async function getLatestCustomerText(opts = {}) { return (await recoverLatest(opts)).text; }
async function latestOnce(want, withinMs) {
  const none = (why, extra = {}) => ({ text: "", answered: false, ids: [], why, ...extra });
  try {
    const list = await get("me/conversations", { platform: "instagram", fields: "participants", limit: "50" });
    let convId = "", theirId = "";
    for (const c of list?.data || []) {
      const p = (c.participants?.data || []).find((x) => String(x.username || "").toLowerCase() === want);
      if (p) { convId = c.id; theirId = String(p.id); break; }
    }
    if (!convId) return none("chat not found");
    const ids = ((await get(convId, { fields: "messages" }))?.messages?.data || []).slice(0, 6).map((m) => m.id).filter(Boolean); // newest first
    if (!ids.length) return none("no messages listed");
    const msgs = await Promise.all(ids.map((id) => get(id, { fields: "id,created_time,from,message" }).catch(() => null)));
    if (!msgs[0]) return none("message not readable");
    const texts = [], used = [];
    let answered = false, seen = "";
    for (const m of msgs) {
      if (!m) break;
      const mine = String(m.from?.id) === theirId;
      if (!mine) { answered = !texts.length && !used.length && m === msgs[0]; break; } // our own message: everything before it was answered
      const at = parseTime(m.created_time), age = at ? Math.round((Date.now() - at) / 1000) : -1;
      if (!at || age * 1000 > withinMs) break;
      used.push(m.id);
      const t = String(m.message ?? "").trim();
      if (t) texts.unshift(t); // a card or photo has no text: skipped, the words before it still count
      else seen = `card/photo ${age}s ago`;
    }
    if (!texts.length) return none(answered ? "newest is from us" : `no words from the lead since our last message${seen ? ` (${seen})` : ""}`, { answered });
    return { text: texts.join("\n").slice(0, 600), answered: false, ids: used, why: "" };
  } catch (e) { console.error("instagram api:", e.message); return none("error"); }
}

// Looks through the lead's recent messages in the real chat for a phone number, newest first. Used after a number arrived as an
// unreadable phone card: the chat itself still holds it. Returns "+91..." when found, "" when the chat was read and holds no number,
// and null when the chat could not be read at all (so "no number" is never guessed from a failed lookup).
export async function findNumberInChat({ username } = {}) {
  const history = await getInstagramHistory({ username, n: 20 });
  if (!history) return null;
  for (const m of [...history].reverse()) {
    if (m.from !== "customer") continue;
    const ph = extractPhone(m.text);
    if (ph.status === "ok") return `+${ph.number}`;
  }
  return "";
}
