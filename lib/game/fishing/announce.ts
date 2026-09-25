import type { ChatMessage } from "@/lib/chat";

// The chat message finish_cast posts for a rare+ catch (spec §8.5). Pure.

export const ANNOUNCER_NAME = "Ao cá";

export interface CatchAnnouncement { accountId: string; speciesId: string; weightG: number; text: string }

const PATTERN = /^\[catch:([0-9a-f-]{36})\|([a-z_]{1,32})\|(\d{1,6})\] ([\s\S]+)$/;

/** Only server messages count: no author account and the announcer's name, so a member cannot fake one. */
export function parseCatchAnnouncement(m: Pick<ChatMessage, "account_id" | "username" | "body">): CatchAnnouncement | null {
  if (m.account_id !== null || m.username !== ANNOUNCER_NAME) return null;
  const x = PATTERN.exec(m.body);
  if (!x) return null;
  return { accountId: x[1], speciesId: x[2], weightG: Number(x[3]), text: x[4] };
}

/** Announcements not shown yet and at most maxAgeMs old (the game HUD toasts them). */
export function freshAnnouncements(
  messages: ChatMessage[], shown: ReadonlySet<string>, now: number, maxAgeMs = 30_000,
): Array<{ id: string; announcement: CatchAnnouncement }> {
  const out: Array<{ id: string; announcement: CatchAnnouncement }> = [];
  for (const m of messages) {
    if (shown.has(m.id) || now - Date.parse(m.created_at) > maxAgeMs) continue;
    const a = parseCatchAnnouncement(m);
    if (a) out.push({ id: m.id, announcement: a });
  }
  return out;
}
