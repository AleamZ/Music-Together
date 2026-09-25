import { describe, it, expect } from "vitest";
import { aggregatePresenceModes, mapCounts, presenceDelay, type PresenceEntry } from "@/lib/presence-modes";

describe("aggregatePresenceModes", () => {
  it("returns one entry per account, sorted by account id", () => {
    const out = aggregatePresenceModes({
      b: [{ name: "Bee", mode: "classic" }],
      a: [{ name: "Ann", mode: "game" }],
    });
    expect(out).toEqual([
      { accountId: "a", name: "Ann", mode: "game", map: "hall" },
      { accountId: "b", name: "Bee", mode: "classic", map: null },
    ]);
  });
  it("treats an account as game when ANY tab is in game mode", () => {
    const out = aggregatePresenceModes({ a: [{ name: "Ann", mode: "classic" }, { name: "Ann", mode: "game" }] });
    expect(out[0].mode).toBe("game");
  });
  it("defaults to classic for old clients without a mode, and skips empty keys", () => {
    const out = aggregatePresenceModes({ a: [{ name: "Ann" }], b: [] });
    expect(out).toEqual([{ accountId: "a", name: "Ann", mode: "classic", map: null }]);
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
