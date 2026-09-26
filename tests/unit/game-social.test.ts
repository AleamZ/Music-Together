import { describe, it, expect } from "vitest";
import type { ChatMessage } from "@/lib/chat";
import { DEFAULT_LOOK } from "@/lib/game/look";
import type { MapId } from "@/lib/game/maps/types";
import { badgesFor, buildRoster, freshChatBubbles, roleAccounts } from "@/lib/game/social";
import type { PresenceEntry } from "@/lib/presence-modes";
import type { Member } from "@/lib/supabase";

const member = (id: string, account: string, username: string): Member =>
  ({ id, room_id: "r", account_id: account, joined_at: "", username });
const members = [
  member("m1", "admin", "An"), member("m2", "dj", "Dũng"), member("m3", "c1", "Cúc"),
  member("m4", "c2", "Chi"), member("m5", "g1", "Giang"), member("m6", "me", "Tôi"),
];
const room = { admin_member_id: "m1", dj_member_id: "m2" };
const seating = {
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
  const presence: PresenceEntry[] = [
    { accountId: "admin", name: "An", mode: "classic", map: null },
    { accountId: "dj", name: "Dũng", mode: "classic", map: null },
    { accountId: "c2", name: "Chi", mode: "classic", map: null },
    { accountId: "g1", name: "Giang", mode: "game", map: "hall" },
    { accountId: "me", name: "Tôi", mode: "game", map: "hall" },
    { accountId: "stranger", name: "Lạ", mode: "game", map: "hall" },
  ];
  const TAN = { ...DEFAULT_LOOK, skin: "tan" as const };
  const roster = buildRoster({ presence, members, room, localId: "me", looks: new Map([["g1", TAN]]), mapId: "hall", seating });
  const byId = new Map(roster.map((r) => [r.id, r]));

  it("lists online members except me and non-members", () => {
    expect([...byId.keys()].sort()).toEqual(["admin", "c2", "dj", "g1"]);
  });
  it("puts a classic DJ behind the mixer and seats the other classic members in id order", () => {
    expect(byId.get("dj")?.spot).toEqual(seating.djSpot);
    expect(byId.get("admin")?.spot).toEqual(seating.seats[0]);
    expect(byId.get("c2")?.spot).toEqual(seating.seats[1]);
    expect(byId.get("g1")?.spot).toBeNull();
  });
  it("uses member names, role badges and looks (default when unknown)", () => {
    expect(byId.get("admin")).toMatchObject({ name: "An", badges: "👑🖥️" });
    expect(byId.get("dj")?.badges).toBe("🎧🖥️");
    expect(byId.get("g1")).toMatchObject({ name: "Giang", badges: "", look: TAN });
    expect(byId.get("c2")?.look).toEqual(DEFAULT_LOOK);
  });
  it("seats classic members by account id whatever the presence order", () => {
    const shuffled: PresenceEntry[] = [
      { accountId: "c2", name: "Chi", mode: "classic", map: null },
      { accountId: "admin", name: "An", mode: "classic", map: null },
    ];
    const r = new Map(buildRoster({ presence: shuffled, members, room, localId: "me", looks: new Map(), mapId: "hall", seating }).map((e) => [e.id, e]));
    expect(r.get("admin")?.spot).toEqual(seating.seats[0]);
    expect(r.get("c2")?.spot).toEqual(seating.seats[1]);
  });
});

describe("buildRoster's dogs (v17 §7.3)", () => {
  it("walks a walking member's dog with them, and seats no dog", () => {
    const muc = { name: "Mực", coat: "muc" as const };
    const presence: PresenceEntry[] = [
      { accountId: "g1", name: "Giang", mode: "game", map: "field", dog: muc },
      { accountId: "c2", name: "Chi", mode: "game", map: "field" },
      { accountId: "c1", name: "Cúc", mode: "classic", map: null, dog: muc },
    ];
    const byId = (mapId: MapId) => new Map(buildRoster({
      presence, members, room, localId: "me", looks: new Map(), mapId, seating: mapId === "hall" ? seating : null,
    }).map((e) => [e.id, e]));
    expect(byId("field").get("g1")?.dog).toEqual(muc);
    expect(byId("field").get("c2")?.dog).toBeNull();
    expect(byId("hall").get("c1")?.dog).toBeNull();
  });
});

describe("buildRoster per map", () => {
  const presence: PresenceEntry[] = [
    { accountId: "c1", name: "Cúc", mode: "classic", map: null },
    { accountId: "g1", name: "Giang", mode: "game", map: "hall" },
    { accountId: "c2", name: "Chi", mode: "game", map: "pond" },
    { accountId: "me", name: "Tôi", mode: "game", map: "pond" },
  ];
  const ids = (mapId: MapId) =>
    buildRoster({ presence, members, room, localId: "me", looks: new Map(), mapId, seating: mapId === "hall" ? seating : null })
      .map((e) => e.id).sort();
  it("draws classic members (seated) and the hall's walkers in the hall", () => {
    expect(ids("hall")).toEqual(["c1", "g1"]);
  });
  it("draws only the pond's walkers at the pond", () => {
    expect(ids("pond")).toEqual(["c2"]);
  });
});

describe("freshChatBubbles", () => {
  const now = Date.parse("2026-09-24T10:00:00Z");
  const msg = (id: string, account: string | null, ageMs: number): ChatMessage =>
    ({ id, room_id: "r", account_id: account, username: "u", body: "hi", created_at: new Date(now - ageMs).toISOString(), system: false });
  it("keeps unseen, recent messages written by people", () => {
    const out = freshChatBubbles([msg("1", "a", 5_000), msg("2", "a", 60_000), msg("3", null, 0), msg("4", "b", 0)], new Set(["4"]), now);
    expect(out.map((m) => m.id)).toEqual(["1"]);
  });
});
