// Thin Wati client. Endpoints per https://docs.wati.io (v1 session + v2 template).
const base = () => process.env.WATI_BASE_URL?.replace(/\/$/, "");
const headers = () => ({
  Authorization: `Bearer ${process.env.WATI_API_TOKEN}`,
  "Content-Type": "application/json-patch+json",
});
const dry = () => process.env.DRY_RUN !== "false";

async function call(method, path, body) {
  if (dry()) {
    console.log(`[DRY_RUN] ${method} ${path}`, body ? JSON.stringify(body) : "");
    return { dryRun: true };
  }
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Wati ${res.status} ${path}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
}

// Free-form reply. Only works inside the 24h window after the contact's last message.
export function sendSessionMessage(waId, text) {
  return call("POST", `/api/v1/sendSessionMessage/${waId}?messageText=${encodeURIComponent(text)}`);
}

// Pre-approved template. Needed to start a conversation outside the 24h window.
// parameters: { first_name: "Priya", event_date: "12 Dec" }. Wati templates use NAMED variables ({{first_name}}), and the
// names must match the template exactly. (An array is also accepted and sent as numbered variables 1, 2, ...)
export function sendTemplateMessage(waId, templateName, parameters, broadcastName = "wa-agent") {
  return call("POST", `/api/v2/sendTemplateMessage?whatsappNumber=${waId}`, {
    template_name: templateName,
    broadcast_name: broadcastName,
    ...(process.env.WATI_CHANNEL_NUMBER ? { channel_number: process.env.WATI_CHANNEL_NUMBER.replace(/\D/g, "") } : {}),
    parameters: Array.isArray(parameters)
      ? parameters.map((value, i) => ({ name: String(i + 1), value: String(value) }))
      : Object.entries(parameters).map(([name, value]) => ({ name, value: String(value) })),
  });
}

// Recent chat, oldest first: [{from: "customer"|"us", text, t}]. "us" is anything sent from your number: the Business App,
// Wati's inbox, or this agent. Returns null if Wati could not be read (callers must not treat that as an empty chat).
// Wati's response: { messages: { items: [{ owner: true|false, text, type, created (ISO), timestamp (seconds) }] } }
export async function getRecentMessages(waId, pageSize = 10) {
  try {
    const res = await fetch(`${base()}/api/v1/getMessages/${waId}?pageSize=${pageSize}`, {
      headers: { Authorization: `Bearer ${process.env.WATI_API_TOKEN}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const items = data?.messages?.items;
    if (!Array.isArray(items)) return null;
    return items
      .map((m) => ({
        from: m.owner ? "us" : "customer",
        text: String(m.text ?? "").slice(0, 300) || `[${m.type || "media"}]`,
        t: Date.parse(m.created) || (Number(m.timestamp) ? Number(m.timestamp) * 1000 : 0),
      }))
      .filter((m) => m.t)
      .sort((a, b) => a.t - b.t);
  } catch { return null; }
}

// One page of Wati contacts: [{waId, name, updated}]
export async function getContactsPage(pageNumber = 1, pageSize = 100) {
  try {
    const res = await fetch(`${base()}/api/v1/getContacts?pageSize=${pageSize}&pageNumber=${pageNumber}`, {
      headers: { Authorization: `Bearer ${process.env.WATI_API_TOKEN}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const list = data?.contact_list || data?.contacts || data?.items || [];
    return list.map((c) => ({
      waId: String(c.wAid || c.waId || c.phone || "").replace(/\D/g, ""),
      name: c.fullName || c.firstName || "",
      updated: Date.parse(c.lastUpdated || c.created) || 0,
    })).filter((c) => c.waId);
  } catch { return []; }
}

export function updateContactAttributes(waId, attrs) {
  return call("POST", `/api/v1/updateContactAttributes/${waId}`, {
    customParams: Object.entries(attrs).map(([name, value]) => ({ name, value: String(value) })),
  });
}
