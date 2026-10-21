# Saffron WhatsApp Agent

One agent for every lead source. Leads reach you through the website, Google Business Profile, ads and Instagram, and end up in one of two places:

- **Instagram:** ManyChat asks date → location → number → occasion → requirement and fills a Google Sheet row column by column.
- **WhatsApp:** people who message the Business number directly (including from Instagram ads).

The agent runs on Netlify, sends through Wati, reads the leads sheet, uses ManyChat's API for Instagram, and uses Claude (API credits from your Max plan) for light replies and for reading details out of free-text messages.

Everything starts in **DRY_RUN=true**: it logs what it would do, sends nothing, writes nothing to the sheet, counts nothing.

## What it does

| Situation | What happens |
|---|---|
| **Instagram lead stops mid-flow** (no number), quiet 12h | **Agent steps in on Instagram** via ManyChat's API with the next missing question only, 10:00-20:00 IST (or at 20h of silence even outside those hours, so Meta's 24h window isn't lost). One nudge per lead. |
| ...no reply by 23h | Added to the **IG Nudges** tab with a suggested message for your team to send by hand (Meta doesn't allow automation after 24h). Cold after 3 days. |
| **Instagram lead gave a WhatsApp number but stopped**, quiet 12h | **Agent takes it to WhatsApp** (10:00-20:00): "you reached out on Instagram with these details: ... we would like a few more details before we can share a quote or some designs: ...". Their reply continues on WhatsApp, asking only what's missing and filling the blanks in their sheet row. |
| **Instagram flow completed** | **WhatsApp within about 5 minutes, any hour** (if the row finished in the last 30 min; otherwise 10:00-20:00): "we have received your details: ... please confirm, or reply with anything you would like to add." "Yes" confirms. Anything else is recorded as an addition and flagged for the team. |
| **Lead typed a question instead of an answer** | Never answered by the agent. Goes to **IG Nudges** (URGENT if it mentions price/dates/booking) with a placeholder for your team's answer. |
| **Someone messages you on WhatsApp** (any hour) | If they're a lead: the agent asks event date, location, occasion, requirement (one at a time, understanding free-text answers), writes them to the sheet, then sends the same confirm-or-add summary. A question mid-flow, or anything about money or availability/booking, goes to the team. |
| **Vendor asks for work** on WhatsApp | Planning Studio sign-up link, once per 6 hours. Recognised as a vendor, so never followed up as a lead. |
| **Your existing WhatsApp chats** | A one-off scan of the last 90 days (see "90-day scan"). After approval, anyone a person on your team spoke to who went quiet is followed up every 2 days, up to 3 times, 10:00-20:00. |
| **Opt-out** ("stop", "not interested") | Honoured immediately and permanently. |
| **Daily summary** | 20:30 IST: short WhatsApp headline to you (`OWNER_NUMBER`) and a full row plus details on the **Daily Summary** tab. |
| **Team alert** | 09:30 IST: how many Instagram nudges are waiting for the team. |

The agent never quotes prices, packages, availability or dates, and never confirms bookings.

**Vendors on Instagram:** ManyChat receives those DMs, so add a ManyChat keyword automation (work, vendor, collaborate, join, photographer, decorator...) that replies with `https://saffron.planningstudio.in/vendor-onboarding` and a line such as "Hi! To work with Saffron Collective, please sign up here so you're in our vendor database."

## Setup

1. `npm install`, deploy to Netlify, add the variables from `.env.example`.
2. **Wati webhooks** (same URL for all three): *Message Received*, *Session Message Sent*, *Template Message Sent* (any `_v2` variants Wati offers; delivery/read events are ignored) →
   `https://<site>.netlify.app/.netlify/functions/wati-webhook?key=<WEBHOOK_SECRET>`
3. **Google Sheet:** share with a service account (Editor). Leads tab, row 1: **N** `WA Follow-up`, **O** `WA Follow-up At`, **P** `Last Message`, **Q** `ManyChat ID`. Have ManyChat's Google Sheets action write the lead's last typed text to P and their ManyChat user id to Q. Create these tabs with headers:
   - `IG Nudges`: Name, Priority, Missing, Their last text, Suggested message, Sheet row, Added at, Done
   - `WhatsApp Leads`: Name, Mobile, Location, Event Date, Occasion, Requirement, Source, Stage, Notes, Confirmed, Updated At
   - `Chat Review`: WhatsApp, Name, Last message from, Last message, Quiet days, Messages from us, Approve (Y/N)
   - `Daily Summary`: Date, New leads, Summaries sent, WA leads started, WA leads completed, WA leads confirmed, IG nudges sent, IG nudges failed, WA finish sent, Quiet follow-ups, Vendor links, Escalations, Opt-outs, Awaiting team, Open nudges, Urgent nudges, Details
4. **ManyChat:** create an API token (Pro plan) → `MANYCHAT_API_TOKEN`.
5. **Templates to submit in Wati** (variables can't contain line breaks):
   - `lead_followup_v1`: Hi {{1}}, thank you for reaching out to Saffron Collective! 🌼 We have received your details: {{2}}. Please confirm if this is correct, or reply here with anything you would like to add.
   - `lead_finish_v1`: Hi {{1}}, thank you for reaching out to Saffron Collective on Instagram! 🌼 Here is what we have noted so far: {{2}}. We would like a few more details before we can share a quote or some designs with you: {{3}}. Could you reply here with them?
   - `quiet_followup_1`, `_2`, `_3`: Hi {{1}}, just following up from Saffron Collective. Would you like to continue our conversation about your event? Reply here whenever you are ready 🌼 (vary the wording across the three)
   - `team_digest_v1`: Good morning! {{1}} Instagram leads need a follow-up today, {{2}} urgent. Open the sheet: {{3}}
   - `owner_summary_v1`: Saffron daily summary {{1}}: {{2}} new leads, {{3}} completed, {{4}} follow-ups sent, {{5}} waiting on you. Full details: {{6}}
6. Set `FOLLOWUP_FROM_ROW` to the **current last row of the sheet on the day you go live**, so older leads aren't messaged.
7. Test with your own number and a test row, read the Netlify logs, then set `DRY_RUN=false`.

## 90-day scan of existing chats

Open `https://<site>.netlify.app/.netlify/functions/backfill-chats-background?key=<WEBHOOK_SECRET>&days=90` once. It reads Wati chats from the last 90 days and **messages nobody**. It recognises vendors and opt-outs, flags chats where the lead wrote last and nobody answered (these show up as "waiting on you" in the daily summary), and lists everyone else on the **Chat Review** tab, on hold. The agent follows up only with rows where you type `Y` in the Approve column (`N` excludes them). This is deliberate: 90 days of chats will include clients, vendors and people who have moved on, and "just following up" would land badly with them.

## Check these on your own accounts before going live

- **ManyChat send format:** `lib/manychat.mjs` follows ManyChat's v2 content format, and I could not confirm that the API works for Instagram subscribers. Check `sendContent` in ManyChat's Swagger and test with one subscriber. If it fails, the agent falls back to the IG Nudges tab for that lead.
- **Wati formats:** the template `parameters` shape, webhook field names (`waId`, `owner`, `type`, `text`, `eventType`), event names (`sessionMessageSent`, `templateMessageSent`, `templateMessageSent_v2`; unknown ones are logged as `wati event ignored:`), `WATI_CHANNEL_NUMBER` on template sends, and the `getContacts` / `getMessages` response shapes come from Wati's public docs and are parsed defensively. Do one test of each.
- **Coexistence:** the quiet follow-up and "a person spoke" detection rely on messages you type in the Business App reaching the webhook as outbound events. Confirm that on your account.
- **Netlify:** the lead check runs every 5 minutes; confirm your plan allows that schedule.
- **Opt-in:** Meta expects people to have agreed to hear from you on WhatsApp. Leads who gave their number on Instagram generally have; check the same holds for everyone you message.
- **Wati trial:** broadcast quota is limited.
- **Planning Studio** is not connected (`lib/planning-studio.mjs` is a stub). Vendor recognition uses keywords until it is.

## Editing

Reply wording and keyword rules: `lib/rules.mjs`. The WhatsApp questions and field order: `lib/leadfields.mjs`. Claude's instructions and output checks: `lib/claude.mjs`. Timings are env settings (see `.env.example`). Run `npm test` after any change.
