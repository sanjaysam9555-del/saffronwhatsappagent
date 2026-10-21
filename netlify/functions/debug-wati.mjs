export default async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== process.env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
  const waId = (url.searchParams.get("waId") || "").replace(/\D/g, "");
  const base = (process.env.WATI_BASE_URL || "").replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${process.env.WATI_API_TOKEN}` };
  const out = {};
  for (const [name, path] of [
    ["messages", `/api/v1/getMessages/${waId}?pageSize=10`],
    ["contacts", `/api/v1/getContacts?pageSize=1&pageNumber=1`],
  ]) {
    try {
      const r = await fetch(base + path, { headers });
      out[name] = { status: r.status, body: (await r.text()).slice(0, 6000) };
    } catch (e) { out[name] = { error: String(e) }; }
  }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json" } });
};
