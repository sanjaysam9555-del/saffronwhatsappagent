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
