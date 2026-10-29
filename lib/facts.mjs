// Fixed facts from saffroncollective.in (the source of truth). The agent only ever repeats these, word for word.
// It never writes a price, a total, a discount or availability itself. ONE exception, given by Swati (L40): a question about the TOTAL cost of a wedding
// ("what's your starting budget, inclusive of all costs") or whether we can do it within a budget is answered by Claude in its own words from BUDGET_FACTS
// below, with every figure checked by checkBudgetText; if Claude cannot be used or says anything else, the fixed text (budgetFallback) is sent.

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

// ---- The total wedding budget (Swati, L40). Context for Claude, not a script. ----
export const BUDGET_FACTS = [
  "Our planning fee is a flat fee, never a percentage of the budget. Full Wedding Planning starts at 3.5 lakh rupees.",
  "The wedding budget itself is entirely the client's choice. It depends on the venue, the number of guests and their preferences, from the venue to the guest count.",
  "As an idea only: a whole wedding can range from about 30 lakh rupees for 100 guests to about 60 lakh rupees for 250 guests.",
  "The prices go up and down with the choice of venue: for example a 3-star venue can cost around 40% less than a 5-star, and so on.",
  "Invite them to share how, when and where they envision their wedding, and say we will take care of everything that comes with it.",
  "If they ask whether we can do it within a budget, for a particular style, or something similar: say we can certainly get it done and it entirely depends on their preferences. No figures.",
].join("\n");

// Asks for the TOTAL cost of a wedding (not our fee), or whether it can be done within a budget.
const TOTAL_Q = new RegExp([
  "\\b(starting|minimum|average|typical|ballpark|rough)\\s+(budget|cost|spend)\\b",
  "\\b(total|overall|all[- ]in|all[- ]inclusive|inclusive of (all )?costs?|including (all )?costs?|all costs|entire|whole|complete|end[- ]to[- ]end)\\b.{0,50}\\b(costs?|budget|spend|expenses?|charges)\\b",
  "\\b(costs?|budget|spend|expenses?)\\b.{0,40}\\b(of|for)\\s+(a|an|the|my|our|full|complete|end[- ]to[- ]end)?\\s*(destination\\s+)?(wedding|shaadi|event|function)\\b",
  "\\bhow much\\b.{0,40}\\b(wedding|shaadi|event)\\b.{0,20}\\b(cost|costs|come|be)\\b",
  "\\bper\\s+(guest|plate|head)\\b",
].join("|"), "i");
const WITHIN_Q = /\?|\b(can you|could you|will you|possible|manage|do it|can it|within|under|upto|up to|max(imum)?)\b/i;
// "total" | "within" | "" (neither: our fee question keeps its published answer).
export function budgetQuestionKind(text = "") {
  const t = String(text);
  if (TOTAL_Q.test(t)) return "total";
  if (budgetLakhs(t) !== null && WITHIN_Q.test(t)) return "within";
  return "";
}

// Every figure in Claude's wording must be one we gave it. Anything else, a discount, a promise or a long answer means the fixed text is used instead.
const ALLOWED_MONEY = new Set(["3.5 lakh", "2 lakh", "1 lakh", "30 lakh", "60 lakh", "40%"]);
export function checkBudgetText(text = "") {
  const t = String(text).trim();
  if (!t || t.length > 700 || t.includes("?")) return false;
  if (/https?:\/\//i.test(t)) return false;
  if (/\b(discounts?|negotiat\w*|guarantee\w*|free of charge|exact (price|quote|cost|amount)|per\s+(plate|guest|head)|percentage of)\b/i.test(t.replace(/never a percentage of/i, ""))) return false;
  const money = t.match(/(?:₹|rs\.?\s?)?\s?\d+(?:\.\d+)?\s?(?:lakhs?|lacs?|crores?|cr\b|k\b|thousand|%)/gi) || [];
  for (const m of money) {
    const n = m.replace(/₹|rs\.?/gi, "").replace(/\s+/g, " ").trim().toLowerCase().replace(/lakhs?|lacs?/, "lakh").replace(/\s?%/, "%");
    const norm = n.replace(/^(\d+(?:\.\d+)?)\s?(lakh)$/, "$1 lakh");
    if (!ALLOWED_MONEY.has(norm)) return false;
  }
  if (/₹\s?\d[\d,]*(?!\s?(lakh|lac|%))/i.test(t.replace(/₹\s?\d+(?:\.\d+)?\s?(lakhs?|lacs?)/gi, ""))) return false; // a bare rupee amount
  const guests = [...t.matchAll(/\b(\d{2,4})\s+(guests?|people|persons?|pax)\b/gi)].map((m) => m[1]);
  return guests.every((g) => g === "100" || g === "250");
}

// The words used when Claude cannot be used or its answer failed the check above (Swati's own answer, shortened). The greeting comes from the welcome.
export const budgetFallback = (kind = "total") => kind === "within"
  ? "We can certainly get it done. It entirely depends on your preferences, and our Founders will walk you through the options on a quick call."
  : "Our planning fee starts at ₹3.5 lakh. The wedding budget itself is entirely up to you, and it comes down to your venue, guest count and preferences.\n\n" +
    "As an idea, it can range from about ₹30 lakh for 100 guests to about ₹60 lakh for 250 guests. The venue makes a big difference: a 3-star can cost around 40% less than a 5-star.\n\n" +
    "Tell us how, when and where you envision your wedding, and we will take care of everything that comes with it.";
// After the context, never before it (Swati): the invitation to walk through the process comes with the next question.
export const BUDGET_BRIDGE = "We would love to walk you through the entire process and a couple of venue options.";
