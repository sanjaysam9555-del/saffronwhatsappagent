// Fixed facts from saffroncollective.in (the source of truth). The agent only ever repeats these, word for word.
// It never writes a price, a total, a discount or availability itself.

// Words that ask about our fee. These get the published answer below.
export const PRICE_Q = /\b(prices?|pricing|costs?|charges?|fees?|quotes?|quotation|rates?|packages?|how much|commission|percentage|percent)\b|₹\s?\d|rs\.?\s?\d|कीमत|रेट/gi;

const AMOUNT = /(?:₹|rs\.?\s?)?\s?(\d+(?:\.\d+)?)\s?(lakhs?|lacs?|l|crores?|cr|k|thousand)\b/i;

// Budget the lead volunteers, in lakhs: "budget 60-70k" -> 0.6, "6 lakh" -> 6, "1.5 cr" -> 150. null if none.
export function budgetLakhs(text = "") {
  const m = String(text).match(AMOUNT);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const u = m[2].toLowerCase();
  if (/^(l|lakh|lakhs|lac|lacs)$/.test(u)) return n;
  if (/^(cr|crore|crores)$/.test(u)) return n * 100;
  return n / 100; // k / thousand
}

// Money words a person must answer (payment, discount, contract...). Asking our fee or volunteering a budget is NOT one of these.
const HARD = /\b(budget|payment|pay|invoice|advance|discount|negotiat\w*|contract|agreement|refund)\b|₹|rs\.?\s?\d|कीमत|रेट|पेमेंट/i;
export function hardMoney(text = "") {
  let t = String(text).replace(PRICE_Q, " ");
  if (budgetLakhs(text) !== null) t = t.replace(AMOUNT, " ").replace(/\bbudget\b/gi, " ").replace(/₹|rs\.?/gi, " ");
  return HARD.test(t);
}
export const isPriceQuestion = (text = "") => { PRICE_Q.lastIndex = 0; return PRICE_Q.test(text); };

const PRICING_LINK = "See what each tier includes: https://saffroncollective.in/pricing";
const DECOR = /\b(d[eé]cor\w*|styling|flowers?|floral|mandap)\b/i;
const FULL_ONLY = /\b(full|end[- ]to[- ]end|complete|planning|planner)\b/i;
const DAYOF = /\b(day[- ]of|day coordination|coordination|coordinator)\b/i;
const PARTIAL = /\bpartial\b/i;

// The published answer. Fixed wording; only the choice of which lines to show depends on what they asked.
export function priceAnswer(text = "") {
  const closing = `Our Founders will walk you through the exact scope on a quick call.\n\n${PRICING_LINK}`;
  if (DECOR.test(text) && !FULL_ONLY.test(text)) {
    return `Décor & Styling is quoted based on your venue, scale and design, so it is custom for each event.\n\nOur Founders will walk you through it on a quick call.\n\nSee what is included: https://saffroncollective.in/services/wedding-decoration`;
  }
  if (PARTIAL.test(text)) return `Our Partial Planning starts at ₹2 lakh, as a flat fee.\n\n${closing}`;
  if (DAYOF.test(text) && !FULL_ONLY.test(text.replace(DAYOF, ""))) return `Our Wedding Day Coordination starts at ₹1 lakh, as a flat fee.\n\n${closing}`;
  return (
    "Our fee is a flat fee, never a percentage of your budget.\n\n" +
    "• Full Wedding Planning: starts at ₹3.5 lakh\n" +
    "• Partial Planning: starts at ₹2 lakh\n" +
    "• Wedding Day Coordination: starts at ₹1 lakh\n" +
    "• Décor & Styling: custom, based on your requirement\n\n" +
    closing
  );
}

// The site says a typical wedding with us starts around ₹40 lakh total spend. The agent never says this to a lead;
// it only tells the team when a lead mentions less, so a person decides.
export const MIN_BUDGET_LAKHS = 40;
