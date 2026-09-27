import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  arrowForKey, arrowPlan, arrowSequence, beatMs, chargeQuality, clampAim, createRound, insideNet, isHit, isSweet, landingPoint,
  makeSchool, MAX_MISTAKES, NET, netBase, netCatch, netRadius, offsetsFor, pressArrow, pullWaitMs, ringSize, roundGrade,
  roundMistakes, SCENE, shadowsAt,
} from "@/lib/game/fishing/net";

const SQL = readFileSync("supabase/migrations/0034_rods_nets.sql", "utf8");

describe("net scoring (v18.2, mirrors 0034)", () => {
  it("the power swells to full at half a period and back", () => {
    expect(ringSize(0)).toBe(0);
    expect(ringSize(NET.periodMs / 2)).toBeCloseTo(1);
    expect(ringSize(NET.periodMs)).toBeCloseTo(0);
    expect(chargeQuality(300)).toBeCloseTo(0.5);
    expect(isSweet(chargeQuality(600))).toBe(true);
    expect(isSweet(chargeQuality(300))).toBe(false);
  });

  it("scores the charge: 2 … 5 fish, a big net one more (still ≤ 5)", () => {
    expect(netBase(0, false)).toBe(2);
    expect(netBase(600, false)).toBe(5);
    expect(netBase(310, false)).toBe(4);          // 2 + round(1.54)
    expect(netBase(200, false)).toBe(3);          // 2 + round(0.75)
    expect(netBase(0, true)).toBe(3);
    expect(netBase(600, true)).toBe(5);
  });

  it("each shadow the net misses lets one fish escape", () => {
    expect(offsetsFor([true, true, true, true, true])).toEqual([0, 0, 0, 0, 0]);
    expect(offsetsFor([true, false])).toEqual([0, NET.missOffset, NET.missOffset, NET.missOffset, NET.missOffset]);
    expect(netCatch(600, offsetsFor([true, true, true, true, true]), false)).toBe(5);
    expect(netCatch(600, offsetsFor([true, true, false, true, true]), false)).toBe(4);
    expect(netCatch(0, offsetsFor([]), false)).toBe(0);
    expect(netCatch(0, [0, 0, 0], true)).toBe(1);
    expect(isHit(null)).toBe(false);
  });

  it("the server's pace and the wait before a haul", () => {
    expect([0, 1, 2, 3, 4, 7, -3].map(beatMs)).toEqual([550, 600, 650, 700, 750, 650, 700]);
    expect(pullWaitMs(600)).toBe(2700 + 250);
  });

  it("mirrors the SQL", () => {
    expect(SQL).toContain("(1 - cos(2 * pi() * greatest(0, coalesce(p_charge_ms, 0)) / 1200.0)) / 2");
    expect(SQL).toContain("abs(p_offsets[g]) <= 150");
    expect(SQL).toContain("select 550 + 50 * (abs(coalesce(p_seed, 0)) % 5)");
    expect(SQL).toContain("least(5, 2 + floor(3 * public._net_quality(p_charge_ms) + 0.5)::int");
    expect(SQL).toContain("now() < t.started_at + make_interval(secs => 0.9 * 5 * t.beat_ms / 1000.0)");
    expect(NET.periodMs).toBe(1200);
    expect(NET.hitMs).toBe(150);
    expect(NET.shadows).toBe(5);
  });
});

describe("net aim (v18.2 redesign)", () => {
  it("keeps the aim on the water and within range", () => {
    expect(clampAim({ x: 80, y: 40 })).toEqual({ x: 80, y: 40 });
    const far = clampAim({ x: 0, y: 0 });
    expect(Math.hypot(far.x - SCENE.hands.x, far.y - SCENE.hands.y)).toBeLessThanOrEqual(SCENE.range + 1e-9);
    expect(clampAim({ x: 80, y: 95 }).y).toBeLessThan(SCENE.shore);
  });
  it("a weak throw is smaller and lands short; the green zone lands on the aim at full size", () => {
    const aim = { x: 80, y: 20 };
    expect(landingPoint(aim, 1)).toEqual(aim);
    expect(landingPoint(aim, 0.3).y).toBeGreaterThan(aim.y);
    expect(netRadius(24, 1)).toBe(14);
    expect(netRadius(36, 1)).toBe(20);
    expect(netRadius(24, 0)).toBeCloseTo(5.6);
  });
  it("inside the net's ellipse", () => {
    expect(insideNet({ x: 10, y: 10 }, { x: 10, y: 10 }, 5)).toBe(true);
    expect(insideNet({ x: 14, y: 10 }, { x: 10, y: 10 }, 5)).toBe(true);
    expect(insideNet({ x: 10, y: 14 }, { x: 10, y: 10 }, 5)).toBe(false);   // squashed: 3 px deep
  });
  it("the school swims inside the water, the same for a seed", () => {
    const s = makeSchool(42);
    for (const t of [0, 1000, 5000, 20000]) {
      const sh = shadowsAt(s, t);
      expect(sh).toHaveLength(NET.shadows);
      for (const f of sh) {
        expect(f.y).toBeGreaterThanOrEqual(SCENE.top);
        expect(f.y).toBeLessThanOrEqual(SCENE.bottom);
      }
    }
    expect(shadowsAt(makeSchool(42), 777)).toEqual(shadowsAt(s, 777));
    expect(shadowsAt(s, 0)).not.toEqual(shadowsAt(s, 3000));
  });
});

describe("kéo lưới: the arrow rounds (v18.2, mirrors 0037)", () => {
  const common = { weightG: 300, rarity: 1 };
  const heavy = { weightG: 1500, rarity: 2 };
  it("scales with the haul", () => {
    expect(arrowPlan([common])).toEqual({ rounds: 2, keys: 4, timerMs: 4096 });
    expect(arrowPlan([common, common])).toMatchObject({ rounds: 2, keys: 4 });
    expect(arrowPlan([heavy, heavy, heavy, heavy, heavy])).toEqual({ rounds: 5, keys: 9, timerMs: 3000 });
    expect(arrowPlan([{ weightG: 1000, rarity: 2 }, { weightG: 1000, rarity: 2 }]).rounds).toBe(4);
  });
  it("sequences are seeded; keys map arrows and WASD", () => {
    expect(arrowSequence(5, 6)).toEqual(arrowSequence(5, 6));
    expect(arrowSequence(5, 6)).toHaveLength(6);
    expect(["ArrowUp", "KeyS", "KeyA", "ArrowRight", "Space"].map(arrowForKey)).toEqual(["up", "down", "left", "right", null]);
  });
  it("a right key moves on, a wrong one is a mistake; a timeout is one", () => {
    let r = createRound(["up", "left"]);
    r = pressArrow(r, "down");
    expect(r).toMatchObject({ at: 0, wrongs: 1, done: false });
    r = pressArrow(pressArrow(r, "up"), "left");
    expect(r.done).toBe(true);
    expect(roundMistakes(r)).toBe(1);
    expect(roundGrade(r, 500, 4000)).toBe("miss");
    const clean = pressArrow(pressArrow(createRound(["up", "left"]), "up"), "left");
    expect(roundMistakes(clean)).toBe(0);
    expect(roundGrade(clean, 1000, 4000)).toBe("perfect");
    expect(roundGrade(clean, 3000, 4000)).toBe("good");
    expect(roundMistakes(pressArrow(createRound(["up", "left"]), "up"))).toBe(1);   // timed out mid-way
    expect(MAX_MISTAKES).toBe(3);
  });
  it("mirrors the SQL rounds", () => {
    const S37 = readFileSync("supabase/migrations/0037_net_arrows.sql", "utf8");
    expect(S37).toContain("least(5, greatest(2, floor(coalesce(sum((f->>'rarity')::numeric + (f->>'weight_g')::numeric / 1000), 0) / 2 + 0.5)::int + 1))");
    expect(S37).toContain("make_interval(secs => 0.8 * public._net_rounds(t.haul))");
  });
});