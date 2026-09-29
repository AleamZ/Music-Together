import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildWorldMgCases } from "@/scripts/gen-world-mg-fixtures";
import {
  COMBO, WG, comboInputError, comboParams, huntAim, huntAnimal, huntParams, replayCombo, replayHunt, replayPhoto,
  replayTrap, skillChance, trapParams, trapPath, tri, wildInputError,
} from "@/lib/game/realm/minigames";

const FIXTURE = "tests/fixtures/world-mg-cases.json";

describe("world minigames (0083)", () => {
  it("world-mg-cases.json is what the TS makes (WRITE_WORLD_MG_FIXTURES=1 rewrites it)", () => {
    const cases = buildWorldMgCases();
    if (process.env.WRITE_WORLD_MG_FIXTURES === "1") writeFileSync(FIXTURE, `${JSON.stringify(cases)}\n`);
    const got = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, "utf8")) : null;
    expect(got).toEqual(JSON.parse(JSON.stringify(cases)));
  });

  it("the fixtures cover every outcome", () => {
    const { wild, combo } = buildWorldMgCases();
    const outs = new Set(wild.map((c) => `${c.game}:${c.expected.outcome}`));
    for (const o of ["hunt:hit", "hunt:charged", "trap:caught", "trap:miss", "trap:escaped", "photo:done"]) expect(outs).toContain(o);
    expect(combo.some((c) => c.expected.perfect === COMBO.arrows)).toBe(true);
    expect(combo.some((c) => !c.expected.dodged)).toBe(true);
    expect(combo.some((c) => c.expected.judges.includes("miss"))).toBe(true);
  });

  it("the triangle and the chance stay in bounds", () => {
    for (let t = 0; t < 500; t++) {
      expect(tri(97, t)).toBeGreaterThanOrEqual(0);
      expect(tri(97, t)).toBeLessThanOrEqual(1000);
    }
    expect(skillChance(70, 1000, true)).toBe(90);
    expect(skillChance(70, 0, true)).toBe(50);
    expect(skillChance(25, 0, true)).toBe(5);
    expect(skillChance(90, 1000, true)).toBe(95);
    expect(skillChance(90, 1000, false)).toBe(0);
  });

  it("a perfectly led shot hits; a wolf's charge ends the hunt unless dodged", () => {
    const seed = 12345;
    const p = huntParams(seed, "wolf");
    let best = 0;
    for (let t = 0; t < p.charge - WG.flight; t++) {
      if (Math.abs(huntAim(p, t) + p.wind - huntAnimal(p, t + WG.flight)) <= 5) { best = t; break; }
    }
    if (best > 0) expect(replayHunt(seed, "wolf", true, [best], []).outcome).toBe("hit");
    expect(replayHunt(seed, "wolf", true, [], []).outcome).toBe("charged");
    expect(replayHunt(seed, "wolf", true, [], [p.charge - 3]).outcome).toBe("open");
    expect(replayHunt(seed, "wolf", false, [], []).outcome).toBe("open");
  });

  it("the trap walks forward and escapes at the end", () => {
    const path = trapPath(trapParams(7, "rabbit"), WG.maxTicks);
    expect(path[0]).toBe(0);
    expect(path.includes(1000)).toBe(true);
    expect(replayTrap(7, "rabbit", []).outcome).toBe("escaped");
    const at = path.findIndex((x) => Math.abs(x - 500) <= 4);
    expect(replayTrap(7, "rabbit", [at]).outcome).toBe("caught");
  });

  it("a photo keeps the best of three snaps", () => {
    const r = replayPhoto(99, "deer", [100, 200, 300], []);
    expect(r.outcome).toBe("done");
    expect(r.ticks).toBe(301);
    expect(r.score).toBeLessThanOrEqual(1000);
  });

  it("the combo judges rhythm arrows and the slam", () => {
    const p = comboParams(42);
    const keys = p.beats.map((b, i) => b * 4 + p.dirs[i]);
    const all = replayCombo(42, keys, [p.slam - 5], p.end);
    expect(all.perfect).toBe(6);
    expect(all.best).toBe(6);
    expect(all.dodged).toBe(true);
    expect(all.exact).toBe(6);
    expect(replayCombo(42, keys, [], p.end).dodged).toBe(false);
    // the beats are ≥ 54 ticks (0.9 s, the old cooldown) apart
    for (let i = 1; i < p.beats.length; i++) expect(p.beats[i] - p.beats[i - 1]).toBeGreaterThanOrEqual(54);
    const wrong = replayCombo(42, keys.map((k, i) => (i === 0 ? k - (k % 4) + ((k + 1) % 4) : k)), [], p.end);
    expect(wrong.judges[0]).toBe("miss");
    expect(wrong.streaks[1]).toBe(1);
  });

  it("input shape rules", () => {
    expect(wildInputError("trap", [5, 80], [], 100)).toBe("too_many");
    expect(wildInputError("hunt", [5, 20], [], 100)).toBe("rate");
    expect(wildInputError("hunt", [5], [120], 100)).toBe("range");
    expect(wildInputError("photo", [5, 70], [1, 2], 100)).toBeNull();
    expect(comboInputError([-1], [], 100)).toBe("range");
    expect(comboInputError([404, 400], [], 200)).toBe("order");
    expect(comboInputError([100 * 4 + 1], [], 200)).toBeNull();
  });
});
