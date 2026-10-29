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
// "Budget" alone is a detail they volunteer (noted, never questioned); "advance" is money only as a payment ("book in advance" is not).
const HARD = /\b(payments?|pay|invoice|advance (payment|amount|token)|token amount|discounts?|negotiat\w*|contract|agreement|refund)\b|₹|rs\.?\s?\d|कीमत|रेट|पेमेंट/i;
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
    return `Décor & Styling is quoted based on your venue, scale and design, so it is custom for each event. Our Founders will walk you through it on a quick call.\n\nSee what is included: https://saffroncollective.in/services/wedding-decoration`;
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

// "What does 3 lakh include?" / "What's included in ₹3.5 lakh?" / "what are the deliverables": answered from the website's pricing page, word for word
// (https://saffroncollective.in/pricing). Never written by the AI. An amount is never promised to buy anything: only a tier's own published start price is repeated.
const INCL_GENERIC = /\b(inclusions?|deliverables?|what(?:'s|\u2019s|\s+is|\s+are)\s+(?:all\s+)?(?:included|covered)|what\s+(?:do|will|would)\s+(?:i|we)\s+get|what\s+(?:all\s+)?(?:do|does)\s+(?:it|you|your\s+\w+)\s+(?:include|cover))\b|kya\s+(?:kya\s+)?(?:milta|included|include\s+hai)/i;
const INCL_SPECIFIC = /\bwhat\b.{0,40}\b(includ\w*|cover\w*)\b/i;
const TIERS = /\b(full|partial|day[- ]of|coordination|planning|planner|package|tier|plan|d[eé]cor\w*|styling)\b/i;
export const isInclusionsQuestion = (text = "") => {
  const t = String(text);
  return INCL_GENERIC.test(t) || (INCL_SPECIFIC.test(t) && (AMOUNT.test(t) || TIERS.test(t)));
};

const INCL = {
  full: "Full Wedding Planning (starts at ₹3.5 lakh, flat fee) covers all 7 stages, from the first call to the last dance:\n• Budget architecture from day one\n• A single point of contact for the full timeline\n• Venue sourcing, shortlisting and contract negotiation\n• Design direction across every function\n• Everything in Partial Planning and Wedding Day Coordination",
  partial: "Partial Planning (starts at ₹2 lakh, flat fee), from the venue hunt to the wedding day:\n• Vendor shortlisting and vetting across every category\n• Contract negotiation before signing\n• Budget tracking from the point of engagement\n• Everything in Wedding Day Coordination",
  dayof: "Wedding Day Coordination (starts at ₹1 lakh, flat fee):\n• Final vendor confirmations across every function\n• A day-of run sheet and master timeline\n• An on-ground team of 4 from setup through teardown\n• A contract sanity-check before final payments go out",
  decor: "Décor & Styling (custom, based on your requirement):\n• Concept design with mood-boards and 3D venue renderings\n• Floral artistry (installations, mandaps, table-scapes, bouquets)\n• Custom set design, lighting and bespoke fabrication\n• An on-site styling team for last-mile detailing across every function",
};
export function inclusionsAnswer(text = "") {
  const t = String(text);
  const amount = budgetLakhs(t);
  let pick = "";
  if (/\bpartial\b/i.test(t)) pick = "partial";
  else if (/\b(day[- ]of|day coordination|coordination|coordinator)\b/i.test(t) && !/\b(full|end[- ]to[- ]end)\b/i.test(t)) pick = "dayof";
  else if (DECOR.test(t) && !FULL_ONLY.test(t)) pick = "decor";
  else if (/\b(full|end[- ]to[- ]end|complete)\b/i.test(t) || amount === 3.5) pick = "full";
  const closing = "Hospitality is quoted separately from our planning fee.\n\nSee the full details here: https://saffroncollective.in/pricing\n\nOur Founders will walk you through the exact scope on a quick call.";
  if (pick) return `${INCL[pick]}\n\n${closing}`;
  return `Here is what each of our planning options includes:\n\n${INCL.full}\n\n${INCL.partial}\n\n${INCL.dayof}\n\nDécor & Styling is custom for each event and can be added to any of these.\n\n${closing}`;
}

// The site says a typical wedding with us starts around ₹40 lakh total spend. The agent never says this to a lead;
// it only tells the team when a lead mentions less, so a person decides.
export const MIN_BUDGET_LAKHS = 40;
