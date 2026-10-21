// Lead phone cells are messy ("8287469294, please whatsapp me", "31 Jan", "+15483337252").
// Returns digits with country code (e.g. "919876543210") or null if no confident number.
export function normalizePhone(raw) {
  if (!raw) return null;
  const s = String(raw);

  const intl = s.match(/\+\s?(\d[\d\s-]{8,16}\d)/);
  if (intl) {
    const d = intl[1].replace(/\D/g, "");
    return d.length >= 10 && d.length <= 15 ? d : null;
  }

  const token = s.match(/\d[\d\s-]{8,}\d/);
  if (!token) return null;
  const d = token[0].replace(/\D/g, "");

  if (d.length === 10 && /^[6-9]/.test(d)) return "91" + d;
  if (d.length === 11 && d.startsWith("0") && /^[6-9]/.test(d[1])) return "91" + d.slice(1);
  if (d.length === 12 && d.startsWith("91") && /^[6-9]/.test(d[2])) return d;
  return null; // ambiguous (e.g. 12 digits not starting 91): leave for a human
}

// Webhook waId is digits with country code; compare on last 10 digits.
export const sameNumber = (a, b) => a && b && a.slice(-10) === b.slice(-10);
