import { describe, it, expect } from "vitest";
import { aggregatePresenceModes } from "@/lib/presence-modes";

describe("aggregatePresenceModes", () => {
  it("returns one entry per account, sorted by account id", () => {
    const out = aggregatePresenceModes({
      b: [{ name: "Bee", mode: "classic" }],
      a: [{ name: "Ann", mode: "game" }],
    });
    expect(out).toEqual([
      { accountId: "a", name: "Ann", mode: "game" },
      { accountId: "b", name: "Bee", mode: "classic" },
    ]);
  });
  it("treats an account as game when ANY tab is in game mode", () => {
    const out = aggregatePresenceModes({ a: [{ name: "Ann", mode: "classic" }, { name: "Ann", mode: "game" }] });
    expect(out[0].mode).toBe("game");
  });
  it("defaults to classic for old clients without a mode, and skips empty keys", () => {
    const out = aggregatePresenceModes({ a: [{ name: "Ann" }], b: [] });
    expect(out).toEqual([{ accountId: "a", name: "Ann", mode: "classic" }]);
  });
  it("uses an empty name when no tab reports one", () => {
    expect(aggregatePresenceModes({ a: [{ mode: "game" }] })[0].name).toBe("");
  });
});
