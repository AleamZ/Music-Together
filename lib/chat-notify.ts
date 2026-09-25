import type { ChatMessage } from "@/lib/chat";
import { cleanNotificationText } from "@/lib/chat-helpers";
import { parseAnnouncement, parseCatchAnnouncement } from "@/lib/game/fishing/announce";

/** Pure: messages that are unseen AND authored by someone other than the viewer
 *  (a null author — e.g. a deleted account — counts as "other"). In order.
 *  A server catch announcement of the viewer's own catch is not "from others" either (v14). */
export function newFromOthers(
  messages: ChatMessage[], seen: Set<string>, selfAccountId: string,
): ChatMessage[] {
  return messages.filter((m) =>
    !seen.has(m.id) && m.account_id !== selfAccountId && parseCatchAnnouncement(m)?.accountId !== selfAccountId,
  );
}

/** Pure: a message's desktop-notification text — the readable part of a server announcement (a catch, a land sale),
 *  else the cleaned body. */
export function notificationText(m: ChatMessage): string {
  return parseAnnouncement(m)?.text ?? cleanNotificationText(m.body);
}
