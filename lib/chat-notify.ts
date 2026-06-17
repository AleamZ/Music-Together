import type { ChatMessage } from "@/lib/chat";

/** Pure: messages that are unseen AND authored by someone other than the viewer
 *  (a null author — e.g. a deleted account — counts as "other"). In order. */
export function newFromOthers(
  messages: ChatMessage[], seen: Set<string>, selfAccountId: string,
): ChatMessage[] {
  return messages.filter((m) => !seen.has(m.id) && m.account_id !== selfAccountId);
}
