// Sends a text to an Instagram subscriber through ManyChat's API (Pro plan or higher).
// Only works inside Meta's 24h window after the lead's last message; outside it ManyChat rejects the call
// (it needs a message tag) and the caller falls back to the team's nudge list.
//
// ASSUMPTION TO VERIFY: the request body below follows ManyChat's v2 content format. Check it against
// https://api.manychat.com/swagger (sendContent) with one test subscriber before going live.
export async function sendInstagramText(subscriberId, text) {
  if (process.env.DRY_RUN !== "false") {
    console.log(`[DRY_RUN] ManyChat Instagram -> ${subscriberId}: ${text}`);
    return { dryRun: true };
  }
  const res = await fetch("https://api.manychat.com/fb/sending/sendContent", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.MANYCHAT_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      subscriber_id: Number(subscriberId),
      data: { version: "v2", content: { type: "instagram", messages: [{ type: "text", text }], actions: [], quick_replies: [] } },
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.status === "error") throw new Error(`ManyChat ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

// The lead's latest message, read from ManyChat itself. Used when the External Request does not carry the text
// (ManyChat does not send a request at all when a message with a line break breaks the JSON body), so the body can be just the subscriber id.
// Never throws: an empty string means "could not read it".
export async function getInstagramLastText(subscriberId) { return (await getInstagramInfo(subscriberId)).text; }

// The last thing they typed, and their Instagram-scoped id (what Meta's own API needs to find the chat). Never throws.
export async function getInstagramInfo(subscriberId) {
  const none = { text: "", igId: "" };
  if (process.env.DRY_RUN !== "false" || !process.env.MANYCHAT_API_TOKEN) return none;
  try {
    const res = await fetch(`https://api.manychat.com/fb/subscriber/getInfo?subscriber_id=${encodeURIComponent(subscriberId)}`, {
      headers: { Authorization: `Bearer ${process.env.MANYCHAT_API_TOKEN}`, Accept: "application/json" },
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.status === "error") { console.error("ManyChat getInfo:", res.status); return none; }
    const igId = String(j.data?.ig_id ?? j.data?.instagram_id ?? "").replace(/\D/g, "");
    return { text: String(j.data?.last_input_text ?? "").trim(), igId };
  } catch (e) { console.error("ManyChat getInfo:", e.message); return none; }
}

// Read the request ManyChat sends. Normally it is clean JSON. But ManyChat pastes the customer's words into the body as they are, so a
// message with line breaks or quote marks makes invalid JSON. Because "text" is the last field, we can still take everything between
// its opening quote and the final closing quote as the message. Also accepts ManyChat's "Add Full Contact Data" shape.
export function parseManychatEvent(raw) {
  const body = String(raw ?? "");
  let j = null;
  try { j = JSON.parse(body); } catch { /* repaired below */ }
  if (!j) {
    j = {};
    const grab = (re) => body.match(re)?.[1];
    j.subscriber_id = grab(/"subscriber_id"\s*:\s*"?(\d+)"?/) ?? grab(/"id"\s*:\s*"?(\d+)"?/);
    j.name = grab(/"name"\s*:\s*"([^"\n\r]*)"/);
    j.ig_username = grab(/"ig_username"\s*:\s*"([^"\n\r]*)"/);
    // Our own four-line body: "text" is the last field. ManyChat's full contact data: last_input_text is followed by another field.
    j.text = grab(/"text"\s*:\s*"([\s\S]*)"\s*\}?\s*$/) ?? grab(/"last_input_text"\s*:\s*"([\s\S]*?)"\s*,\s*"[a-z_]+"\s*:/) ?? "";
    if (!j.subscriber_id) return null;
    return j;
  }
  const find = (o, keys, depth = 0) => {
    if (!o || typeof o !== "object" || depth > 4) return undefined;
    for (const k of keys) if (o[k] != null && typeof o[k] !== "object" && String(o[k]) !== "") return o[k];
    for (const v of Object.values(o)) { const r = find(v, keys, depth + 1); if (r !== undefined) return r; }
    return undefined;
  };
  return {
    ...j,
    subscriber_id: j.subscriber_id ?? find(j, ["subscriber_id", "id"]),
    name: j.name ?? find(j, ["name", "full_name"]),
    ig_username: j.ig_username ?? find(j, ["ig_username", "username"]),
    text: j.text ?? find(j, ["last_input_text", "text"]),
  };
}
