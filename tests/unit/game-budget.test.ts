import { describe, it, expect } from "vitest";
import { budgetKind, CARD_LIMITS, createBudget, createReactionBudget, GAME_LIMITS } from "@/lib/game/net/budget";
import { isHereOn } from "@/lib/game/social";
import type { PresenceEntry } from "@/lib/presence-modes";

describe("createBudget", () => {
  it("keeps a token bucket per sender and kind", () => {
    const b = createBudget({ move: { rate: 5, burst: 5 }, hello: { rate: 0.1, burst: 1 } });
    expect(Array.from({ length: 7 }, () => b.take("ann", "move", 0))).toEqual([true, true, true, true, true, false, false]);
    expect(b.take("bob", "move", 0)).toBe(true);
    expect(b.take("ann", "hello", 0)).toBe(true);
    expect(b.take("ann", "move", 200)).toBe(true); // 200 ms bring one token back
    expect(b.take("ann", "move", 200)).toBe(false);
    expect(b.take("ann", "hello", 9_999)).toBe(false);
    expect(b.take("ann", "hello", 10_000)).toBe(true);
    expect(b.take("ann", "lk", 0)).toBe(true); // a kind without a budget passes
  });

  it("never saves up more than the burst", () => {
    const b = createBudget({ fs: { rate: 2, burst: 3 } });
    b.take("ann", "fs", 0);
    expect(Array.from({ length: 5 }, () => b.take("ann", "fs", 60_000)).filter(Boolean)).toHaveLength(3);
  });

  it("forgets senders whose bucket is full again once it holds too many", () => {
    const b = createBudget({ fs: { rate: 2, burst: 3 } }, 4);
    for (const id of ["a", "b", "c", "d", "e"]) b.take(id, "fs", 0);
    expect(b.size()).toBe(5);
    b.take("f", "fs", 10_000);
    expect(b.size()).toBe(1);
  });
});

describe("the game and reaction budgets (anti-cheat spec §14)", () => {
  it("matches the spec's table", () => {
    expect(GAME_LIMITS).toEqual({
      move: { rate: 5, burst: 5 }, hello: { rate: 0.1, burst: 1 }, bye: { rate: 0.1, burst: 1 },
      fs: { rate: 3, burst: 5 }, fa: { rate: 3, burst: 5 },
    });
    expect((["st", "mv", "pa", "hello", "bye", "fs", "fa", "lk", "fp"] as const).map(budgetKind))
      .toEqual(["move", "move", "move", "hello", "bye", "fs", "fa", null, null]);
  });

  it("gives the card tables' hint its own budget: cv 5 a second per sender, burst 5 (v16 spec §12)", () => {
    expect(CARD_LIMITS).toEqual({ cv: { rate: 5, burst: 5 } });
    const b = createBudget(CARD_LIMITS);
    expect(Array.from({ length: 6 }, () => b.take("ann", "cv", 0))).toEqual([true, true, true, true, true, false]);
    expect(b.take("bob", "cv", 0)).toBe(true);
    expect(b.take("ann", "cv", 200)).toBe(true);
  });

  it("keys reactions by account, else by name, else one shared bucket, with 12 a second in total", () => {
    const b = createReactionBudget();
    const passed = (d: { accountId?: string; username?: string }, times: number, now = 0) =>
      Array.from({ length: times }, () => b.take(d, now)).filter(Boolean).length;
    expect(passed({ accountId: "a" }, 7)).toBe(5);
    expect(passed({ accountId: "b", username: "a" }, 7)).toBe(5);
    expect(passed({ username: "Lan" }, 7)).toBe(2); // 12 in all
    expect(passed({ username: "Minh" }, 1)).toBe(0);
    expect(passed({}, 7, 1000)).toBe(5);
    expect(passed({}, 1, 1000)).toBe(0);
    expect(passed({ username: "Minh" }, 1, 1000)).toBe(1);
  });
});

describe("isHereOn", () => {
  const presence: PresenceEntry[] = [
    { accountId: "ann", name: "Ann", mode: "game", map: "pond" },
    { accountId: "bob", name: "Bob", mode: "classic", map: null },
    { accountId: "cara", name: "Cara", mode: "game", map: "hall" },
  ];
  it("is true only for an account in game mode on this map", () => {
    expect(isHereOn(presence, "ann", "pond")).toBe(true);
    expect(isHereOn(presence, "ann", "hall")).toBe(false);
    expect(isHereOn(presence, "bob", "hall")).toBe(false);
    expect(isHereOn(presence, "cara", "hall")).toBe(true);
    expect(isHereOn(presence, "dan", "hall")).toBe(false);
  });
});
