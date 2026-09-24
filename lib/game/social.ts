import type { ChatMessage } from "@/lib/chat";
import { DEFAULT_LOOK } from "@/lib/game/look";
import type { RosterEntry } from "@/lib/game/engine";
import type { Seating } from "@/lib/game/maps/types";
import { assignSpots } from "@/lib/game/seating";
import type { Look } from "@/lib/game/types";
import type { PresenceEntry } from "@/lib/presence-modes";
import type { Member, Room } from "@/lib/supabase";

export interface RoleAccounts { adminAccountId: string | null; djAccountId: string | null }

/** 👑 admin, 🎧 DJ, 🖥️ still in the classic view. */
export function badgesFor(accountId: string, roles: RoleAccounts, classic: boolean): string {
  return `${accountId === roles.adminAccountId ? "👑" : ""}${accountId === roles.djAccountId ? "🎧" : ""}${classic ? "🖥️" : ""}`;
}

/** Room roles are stored as member ids; the game works with account ids. */
export function roleAccounts(room: Pick<Room, "admin_member_id" | "dj_member_id">, members: Member[]): RoleAccounts {
  const accountOf = (memberId: string | null) => members.find((m) => m.id === memberId)?.account_id ?? null;
  return { adminAccountId: accountOf(room.admin_member_id), djAccountId: accountOf(room.dj_member_id) };
}

export interface RosterInput {
  presence: PresenceEntry[];
  members: Member[];
  room: Pick<Room, "admin_member_id" | "dj_member_id">;
  localId: string;
  looks: Map<string, Look>;
  map: Seating;
}

/**
 * Everyone online in the room except me (non-members are ignored). Classic-view members get a fixed
 * spot — the DJ behind the mixer, the others on café seats in account-id order — so every client
 * shows the same arrangement. Game-view members walk (spot null).
 */
export function buildRoster({ presence, members, room, localId, looks, map }: RosterInput): RosterEntry[] {
  const byAccount = new Map(members.map((m) => [m.account_id, m] as const));
  const roles = roleAccounts(room, members);
  const online = presence.filter((p) => p.accountId !== localId && byAccount.has(p.accountId));
  const seated = online.filter((p) => p.mode === "classic" && p.accountId !== roles.djAccountId).map((p) => p.accountId);
  const spots = assignSpots(seated, map.seats, map.standSpots);
  return online.map((p) => {
    const classic = p.mode === "classic";
    const spot = !classic ? null : p.accountId === roles.djAccountId ? map.djSpot : spots.get(p.accountId) ?? null;
    return {
      id: p.accountId,
      name: byAccount.get(p.accountId)?.username || p.name || "Khách",
      badges: badgesFor(p.accountId, roles, classic),
      look: looks.get(p.accountId) ?? DEFAULT_LOOK,
      spot,
    };
  });
}

/** Chat messages that should pop up as bubbles: not shown yet, written by a person, at most maxAgeMs old. */
export function freshChatBubbles(messages: ChatMessage[], shown: ReadonlySet<string>, now: number, maxAgeMs = 30_000): ChatMessage[] {
  return messages.filter((m) => !shown.has(m.id) && m.account_id !== null && now - Date.parse(m.created_at) <= maxAgeMs);
}
