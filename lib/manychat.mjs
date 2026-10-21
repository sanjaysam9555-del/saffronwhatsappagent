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
