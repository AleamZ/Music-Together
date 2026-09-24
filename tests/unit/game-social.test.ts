import { describe, it, expect } from "vitest";
import type { ChatMessage } from "@/lib/chat";
import { DEFAULT_LOOK } from "@/lib/game/character";
import { badgesFor, buildRoster, freshChatBubbles, roleAccounts } from "@/lib/game/social";
import type { Member } from "@/lib/supabase";

const member = (id: string, account: string, username: string): Member =>
  ({ id, room_id: "r", account_id: account, joined_at: "", username });
const members = [
  member("m1", "admin", "An"), member("m2", "dj", "Dũng"), member("m3", "c1", "Cúc"),
  member("m4", "c2", "Chi"), member("m5", "g1", "Giang"), member("m6", "me", "Tôi"),
];
const room = { admin_member_id: "m1", dj_member_id: "m2" };
const map = {
  djSpot: { x: 320, y: 124, dir: "down" as const },
  seats: [{ x: 1, y: 1, dir: "down" as const }, { x: 2, y: 2, dir: "down" as const }],
  standSpots: [{ x: 9, y: 9, dir: "left" as const }],
};

describe("roles and badges", () => {
  it("maps role member ids to account ids", () => {
    expect(roleAccounts(room, members)).toEqual({ adminAccountId: "admin", djAccountId: "dj" });
    expect(roleAccounts({ admin_member_id: null, dj_member_id: "gone" }, members)).toEqual({ adminAccountId: null, djAccountId: null });
  });
  it("combines admin, DJ and classic badges", () => {
    const roles = { adminAccountId: "a", djAccountId: "d" };
    expect(badgesFor("a", roles, false)).toBe("👑");
    expect(badgesFor("d", roles, true)).toBe("🎧🖥️");
    expect(badgesFor("x", roles, false)).toBe("");
  });
});

describe("buildRoster", () => {
  const presence = [
    { accountId: "admin", name: "An", mode: "classic" as const },
    { accountId: "dj", name: "Dũng", mode: "classic" as const },
    { accountId: "c2", name: "Chi", mode: "classic" as const },
    { accountId: "g1", name: "Giang", mode: "game" as const },
    { accountId: "me", name: "Tôi", mode: "game" as const },
    { accountId: "stranger", name: "Lạ", mode: "game" as const },
  ];
  const TAN = { ...DEFAULT_LOOK, skin: "tan" as const };
  const roster = buildRoster({ presence, members, room, localId: "me", looks: new Map([["g1", TAN]]), map });
  const byId = new Map(roster.map((r) => [r.id, r]));

  it("lists online members except me and non-members", () => {
    expect([...byId.keys()].sort()).toEqual(["admin", "c2", "dj", "g1"]);
  });
  it("puts a classic DJ behind the mixer and seats the other classic members in id order", () => {
    expect(byId.get("dj")?.spot).toEqual(map.djSpot);
    expect(byId.get("admin")?.spot).toEqual(map.seats[0]);
    expect(byId.get("c2")?.spot).toEqual(map.seats[1]);
    expect(byId.get("g1")?.spot).toBeNull();
  });
  it("uses member names, role badges and looks (default when unknown)", () => {
    expect(byId.get("admin")).toMatchObject({ name: "An", badges: "👑🖥️" });
    expect(byId.get("dj")?.badges).toBe("🎧🖥️");
    expect(byId.get("g1")).toMatchObject({ name: "Giang", badges: "", look: TAN });
    expect(byId.get("c2")?.look).toEqual(DEFAULT_LOOK);
  });
});

describe("freshChatBubbles", () => {
  const now = Date.parse("2026-09-24T10:00:00Z");
  const msg = (id: string, account: string | null, ageMs: number): ChatMessage =>
    ({ id, room_id: "r", account_id: account, username: "u", body: "hi", created_at: new Date(now - ageMs).toISOString() });
  it("keeps unseen, recent messages written by people", () => {
    const out = freshChatBubbles([msg("1", "a", 5_000), msg("2", "a", 60_000), msg("3", null, 0), msg("4", "b", 0)], new Set(["4"]), now);
    expect(out.map((m) => m.id)).toEqual(["1"]);
  });
});
