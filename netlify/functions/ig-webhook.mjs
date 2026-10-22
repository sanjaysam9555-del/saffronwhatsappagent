// Thin front door for ManyChat. ManyChat's "External Request" waits only a few seconds, so this answers straight away and
// hands the real work to ig-process-background. URL:  https://<site>.netlify.app/.netlify/functions/ig-webhook?key=<WEBHOOK_SECRET>
// Body (JSON): { "subscriber_id": "...", "name": "...", "ig_username": "...", "text": "..." }
export default async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== process.env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
  try {
    const body = await req.text();
    await fetch(`${url.origin}/.netlify/functions/ig-process-background?key=${encodeURIComponent(url.searchParams.get("key"))}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
    });
  } catch (e) { console.error("could not hand off Instagram event:", e.message); }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
};
