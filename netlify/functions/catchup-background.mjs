import { withChat } from "../../lib/readgate.mjs";
import { ownerDeps } from "../../lib/operatordeps.mjs";
import { getStore } from "@netlify/blobs";

// The catch-up review (L72, L73), run in the background because reading and judging twenty chats takes minutes. It sends nothing: it only stores the preview
// (catchup:plan) and the status. Started by the operator connector (netlify/functions/operator-mcp.mjs).
export default (req) => withChat(async () => {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== process.env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
  const scope = ["whatsapp", "instagram"].includes(url.searchParams.get("scope")) ? url.searchParams.get("scope") : "all";
  const st = getStore("wa-agent");
  const startedAt = Date.now();
  try {
    const r = await ownerDeps.catchUp.plan(scope);
    await st.setJSON("catchup:status", { state: "done", startedAt, doneAt: Date.now(), items: r.plan.items.length });
  } catch (e) {
    console.error("catch-up failed:", e.message);
    await st.setJSON("catchup:status", { state: "failed", startedAt, why: String(e.message).slice(0, 200) });
  }
  return new Response("ok");
});
