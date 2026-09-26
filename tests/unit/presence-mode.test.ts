import { describe, it, expect } from "vitest";
import { aggregatePresenceModes, mapCounts, presenceDelay, presenceDog, type PresenceEntry } from "@/lib/presence-modes";

describe("aggregatePresenceModes", () => {
  it("returns one entry per account, sorted by account id", () => {
    const out = aggregatePresenceModes({
      b: [{ name: "Bee", mode: "classic" }],
      a: [{ name: "Ann", mode: "game" }],
    });
    expect(out).toEqual([
      { accountId: "a", name: "Ann", mode: "game", map: "hall", dog: null },
      { accountId: "b", name: "Bee", mode: "classic", map: null, dog: null },
    ]);
  });
  it("treats an account as game when ANY tab is in game mode", () => {
    const out = aggregatePresenceModes({ a: [{ name: "Ann", mode: "classic" }, { name: "Ann", mode: "game" }] });
    expect(out[0].mode).toBe("game");
  });
  it("defaults to classic for old clients without a mode, and skips empty keys", () => {
    const out = aggregatePresenceModes({ a: [{ name: "Ann" }], b: [] });
    expect(out).toEqual([{ accountId: "a", name: "Ann", mode: "classic", map: null, dog: null }]);
  });
  it("takes the map from the game tab that tracked last; an old game client is in the hall", () => {
    const tab = (map: string | undefined, at: string, mode = "game") => ({ name: "Ann", mode, map, online_at: at });
    expect(aggregatePresenceModes({ a: [tab("hall", "2026-09-24T10:00:00Z"), tab("pond", "2026-09-24T10:05:00Z")] })[0].map).toBe("pond");
    expect(aggregatePresenceModes({ a: [tab("pond", "2026-09-24T10:05:00Z"), tab("hall", "2026-09-24T10:00:00Z")] })[0].map).toBe("pond");
    expect(aggregatePresenceModes({ a: [tab(undefined, "2026-09-24T10:00:00Z")] })[0].map).toBe("hall");
    expect(aggregatePresenceModes({ a: [tab("field", "2026-09-24T10:00:00Z")] })[0].map).toBe("field");
    expect(aggregatePresenceModes({ a: [tab("moon", "2026-09-24T10:00:00Z")] })[0].map).toBe("hall");
    expect(aggregatePresenceModes({ a: [tab("pond", "2026-09-24T11:00:00Z", "classic"), tab("hall", "2026-09-24T10:00:00Z")] })[0].map).toBe("hall");
  });
  it("uses an empty name when no tab reports one", () => {
    expect(aggregatePresenceModes({ a: [{ mode: "game" }] })[0].name).toBe("");
  });
  it("takes the dog from the game tab that tracked last, and shows none in the classic view (v17 §7.3)", () => {
    const tab = (dog: unknown, at: string, mode = "game") => ({ name: "Ann", mode, map: "field", online_at: at, dog });
    const muc = { n: "Mực", c: "muc" };
    expect(aggregatePresenceModes({ a: [tab(muc, "2026-09-26T10:00:00Z")] })[0].dog).toEqual({ name: "Mực", coat: "muc" });
    expect(aggregatePresenceModes({ a: [tab(muc, "2026-09-26T10:00:00Z"), tab(null, "2026-09-26T10:05:00Z")] })[0].dog).toBeNull();
    expect(aggregatePresenceModes({ a: [tab(null, "2026-09-26T10:00:00Z"), tab(muc, "2026-09-26T10:05:00Z")] })[0].dog)
      .toEqual({ name: "Mực", coat: "muc" });
    expect(aggregatePresenceModes({ a: [tab(muc, "2026-09-26T10:00:00Z", "classic")] })[0].dog).toBeNull();
    // an old client without a dog
    expect(aggregatePresenceModes({ a: [{ name: "Ann", mode: "game", map: "hall" }] })[0].dog).toBeNull();
  });
});

describe("presenceDog", () => {
  it("accepts a name of 1–16 characters with no hidden character, and a known coat", () => {
    expect(presenceDog({ n: "Ki", c: "vang" })).toEqual({ name: "Ki", coat: "vang" });
    expect(presenceDog({ n: "K", c: "dom" })).toEqual({ name: "K", coat: "dom" });
    expect(presenceDog({ n: "Vàng Vện Đốm 16c", c: "ven" })).toEqual({ name: "Vàng Vện Đốm 16c", coat: "ven" });
    expect(presenceDog({ n: "Mực 🐾", c: "muc" })).toEqual({ name: "Mực 🐾", coat: "muc" });
  });
  it("gives no dog for anything else", () => {
    for (const v of [
      null, undefined, "Ki", { n: "Ki" }, { c: "vang" }, { n: "", c: "vang" }, { n: "A".repeat(17), c: "vang" }, { n: 5, c: "vang" },
      { n: "Ki", c: "x" }, { n: "Ki\u200bki", c: "vang" }, { n: "Ki\u00a0ki", c: "vang" }, { n: "Ki\tki", c: "vang" },
      { n: "Mu\u0301c", c: "muc" },
    ]) {
      expect(presenceDog(v), JSON.stringify(v)).toBeNull();
    }
  });
});

describe("presenceDelay", () => {
  it("sends immediately while under the budget", () => {
    expect(presenceDelay([0, 1000, 2000], 3000)).toBe(0);
  });
  it("waits until the oldest send in the window expires", () => {
    expect(presenceDelay([0, 1000, 2000, 3000], 4000)).toBe(26000);
  });
  it("ignores sends older than the window", () => {
    expect(presenceDelay([0, 1000, 2000, 31000], 31500)).toBe(0);
  });
});

describe("mapCounts", () => {
  it("lists who is on each map, me included, with classic members in the hall", () => {
    const presence: PresenceEntry[] = [
      { accountId: "a", name: "Ann", mode: "game", map: "pond" },
      { accountId: "b", name: "Bee", mode: "classic", map: null },
      { accountId: "c", name: "Cee", mode: "game", map: "hall" },
      { accountId: "d", name: "Dee", mode: "game", map: "field" },
    ];
    expect(mapCounts(presence)).toEqual({
      hall: [{ accountId: "b", name: "Bee", classic: true }, { accountId: "c", name: "Cee", classic: false }],
      pond: [{ accountId: "a", name: "Ann", classic: false }],
      field: [{ accountId: "d", name: "Dee", classic: false }],
    });
    expect(mapCounts([])).toEqual({ hall: [], pond: [], field: [] });
  });
});
