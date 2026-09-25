import type { ChatMessage } from "@/lib/chat";

// The chat messages the server posts: a rare+ catch from finish_cast (v14 spec §8.5) and a land sale between players
// (v15 spec §7.8). Pure.

export const ANNOUNCER_NAME = "Ao cá";
export const LAND_ANNOUNCER_NAME = "Hợp tác xã";

export interface CatchAnnouncement { accountId: string; speciesId: string; weightG: number; text: string }
export interface LandAnnouncement { plot: number; text: string }
export type Announcement = ({ kind: "catch" } & CatchAnnouncement) | ({ kind: "land" } & LandAnnouncement);

const CATCH = /^\[catch:([0-9a-f-]{36})\|([a-z_]{1,32})\|(\d{1,6})\] ([\s\S]+)$/;
const LAND = /^\[land:(\d{1,2})\] ([\s\S]+)$/;

type Posted = Pick<ChatMessage, "account_id" | "username" | "body" | "system">;

/** Only server messages count: the system flag, no author account and the announcer's name, so a member cannot fake
 *  one (anti-cheat spec §6.1). */
export function parseCatchAnnouncement(m: Posted): CatchAnnouncement | null {
  if (m.system !== true || m.account_id !== null || m.username !== ANNOUNCER_NAME) return null;
  const x = CATCH.exec(m.body);
  if (!x) return null;
  return { accountId: x[1], speciesId: x[2], weightG: Number(x[3]), text: x[4] };
}

/** A land sale: the system flag, no author account, the co-op's name and the `[land:<plot>]` prefix. */
export function parseLandAnnouncement(m: Posted): LandAnnouncement | null {
  if (m.system !== true || m.account_id !== null || m.username !== LAND_ANNOUNCER_NAME) return null;
  const x = LAND.exec(m.body);
  return x ? { plot: Number(x[1]), text: x[2] } : null;
}

/** Any server announcement, or null for a member's message. */
export function parseAnnouncement(m: Posted): Announcement | null {
  const c = parseCatchAnnouncement(m);
  if (c) return { kind: "catch", ...c };
  const l = parseLandAnnouncement(m);
  return l ? { kind: "land", ...l } : null;
}

/** Announcements not shown yet and at most maxAgeMs old (the game HUD toasts them). */
export function freshAnnouncements(
  messages: ChatMessage[], shown: ReadonlySet<string>, now: number, maxAgeMs = 30_000,
): Array<{ id: string; announcement: Announcement }> {
  const out: Array<{ id: string; announcement: Announcement }> = [];
  for (const m of messages) {
    if (shown.has(m.id) || now - Date.parse(m.created_at) > maxAgeMs) continue;
    const a = parseAnnouncement(m);
    if (a) out.push({ id: m.id, announcement: a });
  }
  return out;
}
