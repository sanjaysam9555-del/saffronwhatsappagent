// Hindi / Hinglish for the fixed wording (questions, summary, call times). Claude's own written replies already follow the lead's language.
// Hinglish in Roman letters is used for both Hindi and Hinglish leads: it is what people actually type on Instagram and WhatsApp.
// The language is remembered once seen (q.lang): short answers like "Delhi" or "200" never flip it back.
const DEVANAGARI = /[ऀ-ॿ]/;
const MARKERS = /\b(hai|hain|hoga|hogi|honge|chahiye|chahie|chahte|chahta|chahti|karna|karni|karwana|karwani|nahi|nahin|mujhe|humein|hamein|hume|aap|aapka|aapke|aapko|batao|bataiye|bataye|kitna|kitne|kitni|kya|kab|kahan|kaha|mera|meri|mere|hamara|hamari|hamare|rahe|raha|rahi|wala|wali|karenge|krenge|shaadi ka|shadi ka|bhi|aur|lekin|abhi|pata|dekhna|dekhni|sakte|sakta|sakti|dijiye|kijiye|bhejiye|ji)\b/gi;
export function detectLang(text = "", prev = "") {
  const t = String(text || "");
  if (DEVANAGARI.test(t)) return "hi";
  const hits = new Set((t.toLowerCase().match(MARKERS) || []).map((m) => m.toLowerCase()));
  hits.delete("ji"); hits.delete("bhi"); hits.delete("aur"); // too common in English-with-Hindi-sprinkles on their own
  const words = t.trim().split(/\s+/).filter(Boolean).length;
  if (hits.size >= 2 || (hits.size === 1 && words <= 4 && /\b(hai|nahi|nahin|chahiye|kya|kitna|kitne|kab|kahan)\b/i.test(t))) return "hi";
  if (prev === "hi" && words >= 5 && hits.size === 0) return "en"; // a whole English sentence: they have switched
  return prev || "en";
}

export const HI = {
  intro: "Hamare planner ko taiyaari mein madad ke liye, mujhe kuch chhote sawaal poochne hain.",
  welcome: (name) => `Namaste${name ? " " + name : ""}!\n\nSaffron Collective se sampark karne ke liye shukriya 🌼`,
  q: {
    occasion: "Yeh shaadi ke liye hai, reception ke liye, ya kisi aur occasion ke liye?",
    date: "Aap apna event kis date par plan kar rahe hain? Approximate mahina bhi chalega.",
    location: "Aap kaunsa city ya destination soch rahe hain?",
    guests: "Lagbhag kitne guests expect kar rahe hain?",
    requirement: "Aapko full planning chahiye, sirf decoration, ya dono?",
    number: "Kya aap apna mobile number share kar sakte hain? Agar India ke bahar ka hai to country code zaroor likhiye.\n\nYeh isliye zaroori hai taaki hum quote/design share karne se pehle kuch details jaldi confirm kar saken.",
  },
  dateRetry: "Theek hai! Approximate mahina bhi kaafi hai, jaise \"November\". Aap kaunse mahine ke aaspaas soch rahe hain?",
  callInvite: "Aapko behtar madad karne aur aapke event ke liye sahi details share karne ke liye, hum Founders ke saath ek chhoti 20 minute ki call suggest karte hain. 🌼\n\nAapko Google Meet video call prefer hogi ya phone call?",
  callAsk: "Bas confirm karna tha, aapko Google Meet video call prefer hogi ya phone call?",
  confirmed: "Confirm karne ke liye shukriya!",
  label: { number: "Mobile", occasion: "Occasion", date: "Event ki date", location: "Location", guests: "Guests", requirement: "Aapko chahiye" },
  service: { "Planning + Decoration": "Planning aur Decoration", "Only Decoration": "Sirf Decoration", Planning: "Planning" },
  confirmHead: (name) => `Shukriya${name ? " " + name : ""}! Humne yeh details note ki hain:`,
  confirmTail: "Kripya confirm kijiye ki yeh sahi hai, ya kuch add karna ho to bata dijiye.\n\nHamare planner phir aapse agle steps ke saath sampark karenge.",
  addition: "Shukriya, humne yeh note kar liya hai.\n\nHamare planner sab kuch dekhkar jald hi aapse sampark karenge.",
  declined: "Koi baat nahi.\n\nHamare planner agle steps ke saath aapse sampark karenge. 🌼",
  nudgeConfirm: "Agar humne jo details note ki hain wo sahi hain to bas \"yes\" likh dijiye, ya bataiye kya badalna hai.",
  nudgeSlots: "Jo time suit kare uska number bhejiye, ya koi aur din aur time bata dijiye.",
  nudgeEmail: "Calendar invite ke liye kya aap apna email address share kar sakte hain?",
  // call times
  introMeet: "Bahut badhiya! Founders ke saath Google Meet call ke liye yeh kuch times hain (Indian time):",
  introPhone: "Bahut badhiya! Founders ke saath call ke liye yeh kuch times hain (Indian time):",
  slotsFoot: "Jo time suit kare uska number bhejiye, ya koi aur din aur time bata dijiye. 🌼",
  slotsAsk: "Kaun sa time theek rahega? Kripya 1, 2 ya 3 likhiye, ya koi aur din aur time bata dijiye.",
  tzYes: "Ji haan, yeh sab Indian Standard Time (IST) mein hain. Dobara bhej raha/rahi hoon:",
  more: "Zaroor! Yeh kuch aur options hain (Indian time):",
  noDay: "Us din koi slot khaali nahi hai. Aage ke available times yeh hain (Indian time):",
  around: "Us din ke aaspaas yeh times available hain (Indian time):",
  whichDay: "Zaroor. Aapko kaun sa din aur time suit karega?",
  emailAsk: "Aap apna email address share kar sakte hain? Yeh sirf calendar invite bhejne ke liye hai.",
  chosen: (when, extra) => `Bahut badhiya, ${when}.\n\nKya aap apna email address${extra} share kar sakte hain? Hum aapko Google Meet link ke saath calendar invite bhej denge.`,
  bookedHead: (when) => `Sab set hai! Founders ke saath aapki call ${when} ke liye book ho gayi hai.`,
  willCall: (num) => (num ? `Wo aapko ${num} par call karenge.` : "Wo us time par aapko call karenge."),
  invited: (email) => `Humne ${email} par calendar invite bhej diya hai.`,
  meetLink: (link) => `Yeh raha Google Meet link:\n${link}`,
  bookedTail: "Aapse baat karne ke liye hum utsuk hain. 🌼",
};
