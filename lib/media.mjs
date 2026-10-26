// Photos, reels and links. A lead often shares a reel or a picture first ("we want something like this") and then asks.
// That is a reference, not a reason to stop. Only a burst of files (a vendor sending a portfolio) pauses the chat.

export const MEDIA_ONLY = /^(\s*(\[attachment\]|\[(image|video|document|audio|sticker)\]|https?:\/\/\S+|attachment|sent an attachment\.?)\s*)+$/i;
export const isMediaOnly = (text = "") => MEDIA_ONLY.test(String(text).trim());

// 3 or more files/links inside 10 minutes looks like a portfolio or a document dump, not inspiration.
export const BURST = 3, BURST_MS = 10 * 60_000;
export function recordMedia(times = [], now = Date.now()) {
  const recent = [...times.filter((t) => now - t < BURST_MS), now];
  return { times: recent, burst: recent.length >= BURST };
}

export const REF_THANKS = "Thank you for sharing this, we have noted it for our planner. 🌼";
export const REF_NOTE = "Shared a reference (photo or reel) first";
// First thing they sent was a file: say hello and invite them to tell us more. The questions start with their next message.
export const refOpen = (who = "") => `Hi${who ? " " + who : ""}!\n\nWelcome to Saffron Collective. 🌼\n\nThank you for sharing this. How can we help you?`;
// A message that arrived with no readable text may be a photo, or a typed answer that did not come through. Say so, and ask again once.
export const REF_UNSURE = "Thank you! If you were typing an answer, I could not read it. Could you please type it once more? 🌼";
// Used whenever we do not yet know what they want (a bare "Hi", "how can I connect"): they could be a client or a vendor, so we only ask.
export const greetingText = (who = "") => `Hi${who ? " " + who : ""}!\n\nWelcome to Saffron Collective. 🌼\n\nHow can we help you?`;

// Should a photo, reel or link on its own get NO welcome? True for vendors, anyone handed to a person, finished chats, and anyone we
// have already welcomed or answered a moment ago (several files sent together would otherwise each get their own hello).
export function skipMediaWelcome(c = {}, now = Date.now()) {
  if (c.esc || c.humanSpoke || c.kind === "vendor" || c.dnc || c.q?.stage === "done" || c.q?.stage === "paused") return true;
  return !c.q && Boolean(c.greeted || (c.lastOut && now - c.lastOut < 2 * 3600_000));
}
