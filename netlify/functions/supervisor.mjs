import { withChat } from "../../lib/readgate.mjs";
import { operatorOn } from "../../lib/operator.mjs";
import { superviseOnce } from "../../lib/supervisor.mjs";
import { ownerDeps } from "../../lib/operatordeps.mjs";
import { listContacts, saveContact } from "../../lib/contacts.mjs";
import { getRecentMessages } from "../../lib/wati.mjs";
import { logNeedsTeam } from "../../lib/needsteam.mjs";
import { testAllows } from "../../lib/testmode.mjs";
import { incr } from "../../lib/metrics.mjs";

// Every hour, 10:00-20:00 IST. Claude looks at chats where the person wrote last and nobody has answered for 20 minutes,
// fixes what is clearly safe (a vendor who got no link, a simple question) and flags the rest for the team.
export const config = { schedule: "5 * * * *" };

const istHour = () => Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));

export default () => withChat(() => runGated()); // every message that can leave runs inside the one-rule gate (lib/readgate.mjs)
const runGated = async () => {
  if (!operatorOn()) return console.log("Operator is off.");
  const h = istHour(), from = Number(process.env.SEND_FROM_HOUR || 10), to = Number(process.env.SEND_TO_HOUR || 20);
  if (h < from || h >= to) return console.log(`Outside hours (IST ${h}:00).`);
  const res = await superviseOnce({
    contacts: listContacts,
    history: (waId) => getRecentMessages(waId, 12),
    send: (waId, text) => ownerDeps.send(waId, text, { ordered: false }),
    save: saveContact,
    logTeam: (o) => logNeedsTeam({ channel: "WhatsApp", contact: `+${o.waId}`, ...o }),
    count: incr,
    allowed: (waId) => testAllows({ waId }),
  });
  console.log("supervisor:", JSON.stringify(res));
};
