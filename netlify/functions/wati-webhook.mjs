export default async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== process.env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
  try {
    const body = await req.text();
    await fetch(`${url.origin}/.netlify/functions/wati-process-background?key=${encodeURIComponent(url.searchParams.get("key"))}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
    });
  } catch (e) { console.error("could not hand off event:", e.message); }
  return new Response("ok", { status: 200 });
};
