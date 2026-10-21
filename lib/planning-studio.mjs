// Planning Studio lookup. NOT WIRED YET.
//
// The Planning Studio connection I used in chat is private to that chat. A deployed
// agent needs its own route in. Options (see README): MCP server URL + token,
// an API key, or a synced Google Sheet.
//
// Contract: given a WhatsApp number, return { kind: "vendor" | "lead", name } or null.
export async function lookupContact(waId) {
  if (!process.env.PLANNING_STUDIO_MCP_URL) return null;
  // TODO: call Planning Studio read-only tools (list_vendors / get_vendor / list_leads)
  // once the MCP URL + auth method are known. Keep it read-only.
  return null;
}
