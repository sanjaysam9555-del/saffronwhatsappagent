// Reply rules. Edit the wording here. Anything not clearly simple goes to a human.
const SIGNUP_URL = () => process.env.VENDOR_SIGNUP_URL;

// Words that mean money or commitments: never auto-answer these.
// Money only. During the question flow a lead's answer may legitimately contain "date" or "book".
export const MONEY = /\b(price|pricing|cost|rate|rates|quote|quotation|budget|payment|pay|invoice|advance|discount|commission|contract|agreement|refund)\b|₹|rs\.?\s?\d|कीमत|रेट|पेमेंट/i;

export const SENSITIVE = /\b(price|pricing|cost|rate|rates|quote|quotation|budget|payment|pay|invoice|advance|discount|commission|contract|agreement|refund|available|availability|book|booking|dates?)\b|₹|rs\.?\s?\d|कीमत|रेट|पेमेंट/i;

export const OPTOUT = /\b(stop|unsubscribe|not interested|don'?t (message|contact|call)|do not (message|contact|call)|remove me|leave me alone)\b|मत भेजो|बंद करो/i;
export const SIGNUP = /\b(sign\s?up|signup|register|registration|onboard|onboarding|join|listing|list me|empanel|link|planning studio|portal)\b/i;
export const GREETING = /^\s*(hi+|hello+|hey+|namaste|namaskar|good\s(morning|afternoon|evening))\W*$/i;

export function decide(text = "", ctx = {}) {
  const t = text.trim();

  // Always honour opt-outs first, before anything else.
  if (OPTOUT.test(t)) {
    return { action: "optout", text: "Understood, we won't message you again. Thank you for your time." };
  }

  if (SENSITIVE.test(t)) return { action: "escalate", reason: "money-or-commitment" };

  if (SIGNUP.test(t)) {
    return {
      action: "reply",
      intent: "vendor_signup",
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
        : `Hello! Thank you for reaching out to Saffron Collective. Our team will respond to you shortly.`,
    };
  }

  return { action: "escalate", reason: "unclear" };
}

export const ESCALATION_ACK =
  "Thank you for your message. A member of our team will get back to you shortly.";
