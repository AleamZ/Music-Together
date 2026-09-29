import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCraftCases, type CraftCases } from "@/scripts/gen-craft-fixtures";
import {
  ANVIL, anvilInputError, anvilNudge, BREW, BREW_BONUS, brewInputError, brewQuality, createAnvil, createBrew, createSort,
  replayAnvil, replayBrew, replaySort, SORT_TICKS, sortBonus, sortInputError, stepAnvil, stepBrew, stepSort,
} from "@/lib/game/craftmg/games";

const SQL = readFileSync("supabase/migrations/0084_craft_minigames.sql", "utf8");
const FIXTURE = "tests/fixtures/craft-cases.json";

describe("the crafting minigames (lib/game/craftmg/games.ts = 0084's replays)", () => {
  it("craft-cases.json is what the TS makes (WRITE_CRAFT_FIXTURES=1 rewrites it)", () => {
    const cases = buildCraftCases();
    if (process.env.WRITE_CRAFT_FIXTURES === "1") writeFileSync(FIXTURE, `${JSON.stringify(cases)}\n`);
    const got = existsSync(FIXTURE) ? (JSON.parse(readFileSync(FIXTURE, "utf8")) as CraftCases) : { brew: [], anvil: [], sort: [] };
    expect(got).toEqual(cases);
    for (const c of got.brew) expect(brewInputError(c.toggles), c.name).toBeNull();
    for (const c of got.anvil) expect(anvilInputError(c.strikes, c.expected.ticks), c.name).toBeNull();
    for (const c of got.sort) expect(sortInputError(c.ticks, c.dirs), c.name).toBeNull();
    // the sharp players reach the top tiers, the idle ones the bottom
    expect(got.brew.filter((c) => c.name.startsWith("brew-sharp")).every((c) => brewQuality(c.expected.score) === 3)).toBe(true);
    expect(got.brew.filter((c) => c.name.startsWith("brew-idle")).every((c) => brewQuality(c.expected.score) === 1)).toBe(true);
    expect(got.anvil.filter((c) => c.name.startsWith("anvil-sharp")).every((c) => c.expected.score === 10)).toBe(true);
    expect(got.sort.filter((c) => c.name.startsWith("sort-sharp")).every((c) => c.expected.score === 12)).toBe(true);
    expect(got.sort.filter((c) => c.name.startsWith("sort-idle")).every((c) => c.expected.score === 0)).toBe(true);
  });

  it("the stepped rounds agree with the replays", () => {
    let b = createBrew(123);
    for (let t = 0; t < BREW.ticks; t++) b = stepBrew(b, t % 50 < 22);
    expect(b.done).toBe(true);
    expect(b.score).toBe(replayBrew(123, b.toggles));
    let a = createAnvil(456);
    while (!a.done) a = stepAnvil(a, a.tick % 37 === 0);
    expect(a.score).toBe(replayAnvil(456, a.strikes).score);
    let s = createSort(789);
    while (!s.done) s = stepSort(s, s.tick % 23 === 0 ? ((s.tick / 23) % 2) as 0 | 1 : null);
    expect(s.score).toBe(replaySort(789, s.ticks, s.dirs).score);
    expect(s.tick).toBe(SORT_TICKS);
  });

  it("the results stay inside the old bounds", () => {
    expect([0, 269, 270, 419, 420, 600].map(brewQuality)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(BREW_BONUS).toEqual([0, 0, 5, 10]);
    expect(anvilNudge(0)).toBe(-100);
    expect(anvilNudge(10)).toBe(100);
    expect(anvilNudge(5)).toBe(0);
    expect(anvilNudge(99)).toBe(100);
    expect([0, 7, 8, 10, 11, 12].map(sortBonus)).toEqual([0, 0, 2, 2, 5, 5]);
    expect(ANVIL.strikes).toBe(5);
  });

  it("bad inputs are refused", () => {
    expect(brewInputError([5, 3])).toBe("order");
    expect(brewInputError([600])).toBe("range");
    expect(anvilInputError([1, 2, 3], 1800)).toBe("rate");
    expect(sortInputError([50], [2])).toBe("dir");
    expect(sortInputError([50], [])).toBe("shape");
  });

  it("the SQL carries the same constants", () => {
    expect(SQL).toContain("400 + r[1] % 201");
    expect(SQL).toContain("50 + r[1] % 31");
    expect(SQL).toContain("(p_score - 5) * 20");
    expect(SQL).toMatch(/when p_score >= 420 then 3 when p_score >= 270 then 2/);
    expect(SQL).toMatch(/when p_score >= 11 then 5 when p_score >= 8 then 2/);
  });
});
