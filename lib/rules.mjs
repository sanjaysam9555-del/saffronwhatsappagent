// Reply rules. Edit the wording here. Anything not clearly simple goes to a human.
const SIGNUP_URL = () => process.env.VENDOR_SIGNUP_URL;

// Words that mean money or commitments: never auto-answer these.
// Money only. During the question flow a lead's answer may legitimately contain "date" or "book".
export const MONEY = /\b(price|pricing|cost|rate|rates|quote|quotation|budget|payment|pay|invoice|advance|discount|commission|contract|agreement|refund)\b|₹|rs\.?\s?\d|कीमत|रेट|पेमेंट/i;

export const SENSITIVE = /\b(price|pricing|cost|rate|rates|quote|quotation|budget|payment|pay|invoice|advance|discount|commission|contract|agreement|refund|available|availability|book|booking|dates?)\b|₹|rs\.?\s?\d|कीमत|रेट|पेमेंट/i;

export const OPTOUT = /\b(stop|unsubscribe|not interested|don'?t (message|contact|call)|do not (message|contact|call)|remove me|leave me alone)\b|मत भेजो|बंद करो/i;
export const SIGNUP = /\b(sign\s?up|signup|register|registration|onboard|onboarding|join|listing|list me|empanel|link|planning studio|portal)\b/i;

// Vendors (people offering services) vs clients (people wanting services). A role word alone ("photographer") is NOT enough:
// clients say "we need a photographer". It takes an explicit offer to work with us, or "I am / we are a <role>".
const ROLES = "photograph\\w*|videograph\\w*|cinematograph\\w*|decorat\\w*|florist|caterer|catering|make-?up|mua|dj|band|mehn?di|choreograph\\w*|anchor|emcee|tent|sound|lighting|stylist|designer";
const VENDOR_WORK = /\b(vendors?|collaborat\w*|empanel\w*|work with (you|us|saffron)|looking for work|work opportunit\w*|associate with (you|us)|partner with (you|us)|list (me|us|my)|add (me|us|my)|our services|my services|portfolio)\b/i;
const VENDOR_SELF = new RegExp(`\\b(i am|i'm|we are|we're|i work as)\\s+(a\\s+|an\\s+)?(\\w+\\s+){0,2}?(${ROLES})\\b`, "i");
export const vendorStrong = (t = "") => VENDOR_WORK.test(t) || VENDOR_SELF.test(t);

// Existing clients write from other numbers too. A person must answer these, not the lead questions.
export const CLIENT = /\b(already (booked|a client|signed|paid)|existing client|booked with you|my (wedding|event) with you|our (wedding|event) with you|my planner|our planner|my coordinator|assigned (planner|coordinator)|advance (paid|payment)|paid the|final payment)\b/i;

export const GREETING = /^\s*(hi+|hello+|hey+|namaste|namaskar|good\s(morning|afternoon|evening))\W*$/i;

export function decide(text = "", ctx = {}) {
  const t = text.trim();

  // Always honour opt-outs first, before anything else.
  if (OPTOUT.test(t)) {
    return { action: "optout", text: "Understood, we won't message you again. Thank you for your time." };
  }

  if (SENSITIVE.test(t)) return { action: "escalate", reason: "money-or-commitment" };

  if (SIGNUP.test(t) || vendorStrong(t)) {
    return {
      action: "reply",
      intent: "vendor_signup",
      strong: vendorStrong(t),
      text:
        `Thank you for your interest in working with Saffron Collective! 🌼\n\n` +
        `Please create your vendor profile here: ${SIGNUP_URL()}\n\n` +
        `It takes a few minutes. Once you are registered, our team will review your profile and be in touch.`,
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

export const ESCALATION_ACK =
  "Thank you for your message.\n\nA member of our team will get back to you shortly.";
