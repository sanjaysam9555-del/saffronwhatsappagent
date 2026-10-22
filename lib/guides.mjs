// Pages on saffroncollective.in that answer common questions in detail. When a lead's question matches one, the agent says so and
// shares the link (fixed wording, fixed URLs; the AI never writes a link), then carries on with the questions.
const SITE = "https://saffroncollective.in";
const G = (path, title, pattern) => ({ url: SITE + path, title, pattern });

export const GUIDES = [
  G("/delhi-ncr-wedding-cost-guide", "How Much Does a Wedding in Delhi NCR Actually Cost in 2026?",
    /\b(how much (does|will|would) (a |an |the |our )?(wedding|delhi wedding|function)s? cost|(cost|budget) of (a |an |the )?(delhi |ncr )?wedding|wedding (cost|costs|budget)s? (in|for) (delhi|ncr|gurgaon|gurugram)|average (wedding )?(cost|budget))\b/i),
  G("/destination-vs-home-city-wedding-cost-guide", "Destination Wedding vs. Home-City Wedding: The Real Cost Difference",
    /\b(destination (wedding )?(vs|versus|or|compared)|(cheaper|costlier|more expensive).{0,25}destination|destination.{0,25}(cheaper|costlier|more expensive|cost difference)|home[- ]city)\b/i),
  G("/wedding-planning-timeline-guide", "The Wedding Planning Timeline: What to Book When",
    /\b(when (should|do|to) (we|i) (start|begin|book)|how (early|far in advance)|what to book when|planning (timeline|checklist)|wedding (timeline|checklist)|how many months (before|in advance))\b/i),
  G("/what-does-a-wedding-planner-do-guide", "What a Wedding Planner Actually Does (and Where the Job Ends)",
    /\b(what (does|do) (a |the )?(wedding )?planners? (actually )?do|do (i|we) (really )?need a (wedding )?planner|why (hire|need|should i hire|should we hire) (a |the )?(wedding )?planner|is a (wedding )?planner worth)\b/i),
  G("/wedding-venue-questions-guide", "Questions to Ask Before You Book a Wedding Venue",
    /\b(questions to ask.{0,25}venue|what (should|do) (we|i) ask.{0,25}venue|how to (choose|pick|select|shortlist|finalise|finalize) (a |the )?venue|venue (checklist|tips))\b/i),
  G("/wedding-hospitality-cost-guide", "Why Wedding Planner Fees Vary (₹3L vs ₹10L) and the Hidden Hospitality Cost",
    /\b(why (do |are )?(wedding )?planners?'? (fees?|charges|costs?) (vary|differ|so different|so high)|(fees?|charges) (vary|differ)|hospitality (team|cost|charges)|other planners?.{0,20}(cheaper|less|more))\b/i),
  G("/family-contribution-budgeting-guide", "Budgeting When Your Families Are Contributing Differently",
    /\b((bride|groom)'?s? (side|family).{0,30}(contribut|share|split|pay)|(both|two) families.{0,30}(contribut|split|share|pay)|split(ting)? (the )?(wedding )?(cost|expenses|budget)|who pays for what)\b/i),
  G("/questions-to-ask", "10 Questions to Ask Any Wedding Planner",
    /\b((questions|what) (should|do|to) (we|i)? ?ask (a |any |the )?(wedding )?planner|how (to|do i|do we) (choose|pick|select|hire|compare) (a |the )?(wedding )?planners?)\b/i),
  G("/calculators", "Wedding Budget Calculators",
    /\b(budget (calculator|planner|breakdown|template)|how (should|do) (i|we) (split|allocate|divide) (our |the )?budget|calculator)\b/i),
  G("/planning-process", "Our Planning Process",
    /\b(how (does|do) (it|you|this) work|your (planning )?process|what is your process|how do (we|i) (start|get started|begin)|what are the steps)\b/i),
  G("/wedding-services", "Wedding Planning Services & Inclusions",
    /\b(what('s| is| are) (included|covered|the inclusions)|inclusions?|deliverables?|what (all )?(do|does) (it|you|your (planning|package)) (include|cover|handle)|what (all )?services (do|does) you)\b/i),
  G("/services/wedding-decoration", "Wedding Decoration & Styling",
    /\b(d[eé]cor (services?|options?|packages?|ideas|themes|styling)|do you (do|offer|provide) (wedding )?d[eé]cor\w*|only d[eé]cor\w*|d[eé]cor only)\b/i),
  G("/services/day-of-coordination", "Wedding Day Coordination",
    /\b(day[- ]of (coordination|coordinator|planning)|wedding day coordination|only (the )?(day|wedding day) (coordination|management))\b/i),
  G("/services/partial-planning", "Partial Wedding Planning",
    /\b(partial (wedding )?planning|already (booked|finalised|finalized|fixed) (the |our )?(venue|vendors?))\b/i),
  G("/portfolio", "Our Work: Weddings by Saffron Collective",
    /\b((show|see|share|send).{0,25}(your )?(portfolio|work|past weddings|previous (work|weddings)|photos of your)|portfolio|your (past|previous) work)\b/i),
  G("/real-weddings", "Real Weddings, Real Words",
    /\b(reviews?|testimonials?|references?|feedback from (couples|clients)|past (couples|clients))\b/i),
];

// Up to two matching pages, best first.
export function guidesFor(text = "") {
  const t = String(text);
  return GUIDES.filter((g) => g.pattern.test(t)).slice(0, 2);
}
export const guideText = (guides) =>
  guides.length
    ? `What you are asking is explained in detail here:\n\n${guides.map((g) => `${g.title}\n${g.url}`).join("\n\n")}`
    : "";
export const PRICING_PAGE = `${SITE}/pricing`;
