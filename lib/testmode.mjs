import { sameNumber } from "./phone.mjs";

// First live run safety switch. While TEST_ONLY_NUMBERS and/or TEST_ONLY_MC_IDS are set, the agent acts ONLY on those
// WhatsApp numbers and ManyChat ids and ignores everyone else. Leave both empty to run for everyone.
const list = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);

export const testMode = () => list(process.env.TEST_ONLY_NUMBERS).length > 0 || list(process.env.TEST_ONLY_MC_IDS).length > 0;

export function testAllows({ waId, mcId } = {}) {
  if (!testMode()) return true;
  const numbers = list(process.env.TEST_ONLY_NUMBERS).map((n) => n.replace(/\D/g, "")), mcIds = list(process.env.TEST_ONLY_MC_IDS);
  if (waId && numbers.some((n) => sameNumber(n, String(waId).replace(/\D/g, "")))) return true;
  if (mcId && mcIds.includes(String(mcId))) return true;
  return false;
}
