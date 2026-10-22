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
export async function getInstagramLastText(subscriberId) {
  if (process.env.DRY_RUN !== "false" || !process.env.MANYCHAT_API_TOKEN) return "";
  try {
    const res = await fetch(`https://api.manychat.com/fb/subscriber/getInfo?subscriber_id=${encodeURIComponent(subscriberId)}`, {
      headers: { Authorization: `Bearer ${process.env.MANYCHAT_API_TOKEN}`, Accept: "application/json" },
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.status === "error") { console.error("ManyChat getInfo:", res.status); return ""; }
    return String(j.data?.last_input_text ?? "").trim();
  } catch (e) { console.error("ManyChat getInfo:", e.message); return ""; }
}
