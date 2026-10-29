// Reply rules. Edit the wording here. Anything not clearly simple goes to a human.
const SIGNUP_URL = () => process.env.VENDOR_SIGNUP_URL;

// Words that mean money or commitments: never auto-answer these.
// Money only. During the question flow a lead's answer may legitimately contain "date" or "book".
export const MONEY = /\b(price|pricing|cost|rate|rates|quote|quotation|budget|payment|pay|invoice|advance|discount|commission|contract|agreement|refund)\b|₹|rs\.?\s?\d|कीमत|रेट|पेमेंट/i;

export const SENSITIVE = /\b(price|pricing|cost|rate|rates|quote|quotation|budget|payment|pay|invoice|advance|discount|commission|contract|agreement|refund|available|availability|book|booking|dates?)\b|₹|rs\.?\s?\d|कीमत|रेट|पेमेंट/i;

export const OPTOUT = /\b(stop|unsubscribe|not interested|don'?t (message|contact|call)|do not (message|contact|call)|remove me|leave me alone)\b|मत भेजो|बंद करो/i;
// A real "stop" is short and stands on its own. Words like "not interested" or "don't call" inside a longer message are usually about something else
// ("not interested in a video call, phone please", "don't call me today, call Friday") and must never put a lead on the do-not-contact list on a single word.
const CONTINUES = /\b(but|instead|only|however|except|rather|prefer|please call|call (me|us) (on|at|after|before|back)|call back|whatsapp me|message me on|tomorrow|today|tonight|later|after|before|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|evening|afternoon|video|meet|decor|decoration|planning|wedding|package|venue|date|time|number)\b/i;
export const isOptOut = (t = "") => OPTOUT.test(t) && String(t).trim().split(/\s+/).length <= 8 && !CONTINUES.test(t);
export const maybeOptOut = (t = "") => OPTOUT.test(t) && !isOptOut(t); // has the words, but a person should read it: no do-not-contact flag, no automatic reply
export const SIGNUP = /\b(sign\s?up|signup|register|registration|onboard|onboarding|join|listing|list me|empanel|link|planning studio|portal)\b/i;

// Vendors (people offering services) vs clients (people wanting services). A role word alone ("photographer") is NOT enough:
// clients say "we need a photographer". It takes an explicit offer to work with us, or "I am / we are a <role>".
const ROLES = "photograph\\w*|videograph\\w*|cinematograph\\w*|decorat\\w*|florist|caterer|catering|make-?up|mua|dj|band|mehn?di|choreograph\\w*|anchor|emcee|tent|sound|lighting|stylist|designer";
const VENDOR_WORK = /\b(vendors?|collaborat\w*|empanel\w*|work with (you|us|saffron)|looking for work|work opportunit\w*|associate with (you|us)|partner with (you|us)|list (me|us|my)|add (me|us|my)|our services|my services|portfolio)\b/i;
const VENDOR_SELF = new RegExp(`\\b(i am|i'm|we are|we're|i work as)\\s+(a\\s+|an\\s+)?(\\w+\\s+){0,2}?(${ROLES})\\b`, "i");
// Someone asking for a job or sharing a CV is not a vendor and not a client: no sign-up link, no questions. (A word like "resume" or "opening" alone is not enough: clients say "can we resume tomorrow", "any openings on 12 Dec".)
export const JOB_SEEKER = /\b(c\.?v|curriculum vitae|careers?|internships?|my resume|resume (?:attached|below|enclosed|here)|attached (?:my )?resume|job (?:openings?|opportunit\w*|applications?|vacanc\w*)|(?:relevant|suitable) (?:openings?|positions?|vacanc\w*)|open positions?|appl(?:y|ying) for (?:a |the )?(?:job|position|role|post|internship)|looking for (?:a )?(?:job|position|employment|internship)|seeking (?:a )?(?:job|position|employment))\b/i;
// A file named like a CV ("Resume .pdf", "Rahul_CV_2026.pdf"). The agent adds "[sent a resume]" to the message when one arrives.
export const RESUME_FILE = /(?:^|[^a-z])(?:cv|resume|curriculum[\s_-]*vitae)(?:[^a-z]|$)/i;
export const jobSeeker = (t = "") => JOB_SEEKER.test(t) || /\[sent a resume\]/i.test(t);
export const jobReply = ({ name = "" } = {}) =>
  `${name ? `Hello ${name}!\n\n` : ""}Thank you for your interest in working with Saffron Collective, and for sharing your details.\n\nOur team will go through your message and be in touch if there is a suitable opening.`;
export const vendorStrong = (t = "") => VENDOR_WORK.test(t) || VENDOR_SELF.test(t);

// Existing clients write from other numbers too. A person must answer these, not the lead questions.
export const CLIENT = /\b(already (booked|signed|paid)\s+(with|through)\s+(you|us|saffron)|already (booked|signed|paid)\s+(you|us)|already an?\s+(existing\s+)?(client|customer)|existing client|booked with you|my (wedding|event) with you|our (wedding|event) with you|my planner|our planner|my coordinator|assigned (planner|coordinator)|advance (paid|payment)|paid the (advance|balance|booking|token|final)|final payment)\b/i;

export const GREETING = /^\s*(hi+|hello+|hey+|namaste|namaskar|good\s(morning|afternoon|evening))\W*$/i;

export function decide(text = "", ctx = {}) {
  const t = text.trim();

  // Always honour opt-outs first, before anything else.
  if (isOptOut(t)) {
    return { action: "optout", text: "Understood, we won't message you again. Thank you for your time." };
  }

  // A CV or a job enquiry: a fixed thank-you, never the vendor link (it is checked before money words: a CV may mention pay or salary).
  if (jobSeeker(t)) return { action: "reply", intent: "job_seeker", text: jobReply({ name: ctx.name }) };

  if (SENSITIVE.test(t)) return { action: "escalate", reason: "money-or-commitment" };

  if (SIGNUP.test(t) || vendorStrong(t)) {
    return {
      action: "reply",
      intent: "vendor_signup",
      strong: vendorStrong(t),
      text: vendorLinkText(),
    };
  }

  if (GREETING.test(t)) {
    return {
      action: "reply",
      intent: "greeting",
      text: ctx.isVendor
        ? `Hello${ctx.name ? " " + ctx.name : ""}! This is Saffron Collective. How can we help you today?`
        : `Hello!\n\nThank you for reaching out to Saffron Collective.\n\nOur team will respond to you shortly.`,
    };
  }

  return { action: "escalate", reason: "unclear" };
}

// The vendor sign-up message. Line breaks matter: link on its own line, and the two closing sentences on separate lines.
function vendorLinkText() {
  return `Thank you for your interest in working with Saffron Collective! 🌼\n\n` +
    `Please create your vendor profile here:\n${SIGNUP_URL()}\n\n` +
    `It takes a few minutes.\nOnce you are registered, our team will review your profile and be in touch.`;
}

// A vendor who introduces themselves (catalogue, rentals, portfolio...): greet them by name, say we noted their business, send the sign-up link.
export const vendorWelcome = ({ name = "", business = "" } = {}) =>
  `${name ? `Hello ${name}!\n\n` : ""}${business ? `Thank you for introducing ${business} to us.\n\n` : ""}${vendorLinkText()}`;

// Someone from a business we may already work with says they have joined it (a new sales manager at a venue, say): a thank-you only. No sign-up link, no onboarding.
export const introReply = ({ name = "", business = "" } = {}) =>
  `${name ? `Hello ${name}!\n\n` : ""}Thank you for the introduction${business ? `, and congratulations on joining ${business}` : ""}.\n\nWe will keep your contact and be in touch when there is a requirement.`;

// A vendor writes again (the same pitch, or "hello?") after the link was already sent: acknowledge, and point them to the link above.
export const vendorReminder = () =>
  `Thank you for getting in touch! 🌼\n\nPlease complete your onboarding using the vendor profile link shared above.\nOnce you are registered, our team will review your profile and be in touch.`;

export const ESCALATION_ACK =
  "Thank you for your message.\n\nA member of our team will get back to you shortly.";
