import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ARROWS, arrowAdvance, arrowGame, arrowPress, clampAimInt, isin, NETX, netAimError, netArrowPlan, netArrowReplay, netArrowSeq,
  netHaulReplay, netKeysError, netLanding, netQuality, netRadiusMilli, netSchool, netShadowsAt, netThrowError, insideNetMilli,
} from "@/lib/game/fishing/net";
import { buildNetCases, type NetCase } from "@/scripts/gen-net-fixtures";

const FILE = "tests/fixtures/net-cases.json";

describe("the net's integer sim (0056 mirrors it)", () => {
  it("isin is a parabola per half period, ±1000 at the quarters", () => {
    expect(isin(0, 400)).toBe(0);
    expect(isin(100, 400)).toBe(1000);
    expect(isin(200, 400)).toBe(0);
    expect(isin(300, 400)).toBe(-1000);
    expect(isin(400, 400)).toBe(0);
    expect(isin(50, 400)).toBe(750);                       // 4000·50·150/200²
    for (let t = 0; t < 800; t += 7) expect(Math.abs(isin(t, 400))).toBeLessThanOrEqual(1000);
  });

  it("the power swells to 1000‰ at half the seed's period and back", () => {
    const P = 72;
    expect(netQuality(0, P)).toBe(0);
    expect(netQuality(36, P)).toBe(1000);
    expect(netQuality(72, P)).toBe(0);
    expect(netQuality(18, P)).toBe(750);
    expect(netQuality(-5, P)).toBe(0);
  });

  it("the school: periods are multiples of 4, the power period 66 … 78 ticks, shadows inside the water", () => {
    for (const seed of [0, 1, 42, 2147483647, 123456789]) {
      const s = netSchool(seed);
      expect(s.period % 2).toBe(0);
      expect(s.period).toBeGreaterThanOrEqual(66);
      expect(s.period).toBeLessThanOrEqual(78);
      expect(s.pw % 4).toBe(0);
      expect(s.fish).toHaveLength(5);
      for (const f of s.fish) expect(f.pf % 4).toBe(0);
      for (const t of [0, 1, 59, 600, 3599, 3641]) {
        for (const sh of netShadowsAt(s, t)) {
          expect(Number.isInteger(sh.x) && Number.isInteger(sh.y)).toBe(true);
          expect(sh.x).toBeGreaterThanOrEqual(NETX.fishMinX);
          expect(sh.x).toBeLessThanOrEqual(NETX.fishMaxX);
          expect(sh.y).toBeGreaterThanOrEqual(NETX.fishMinY);
          expect(sh.y).toBeLessThanOrEqual(NETX.fishMaxY);
        }
      }
    }
    expect(netShadowsAt(netSchool(7), 100)).toEqual(netShadowsAt(netSchool(7), 100));
    expect(netShadowsAt(netSchool(7), 100)).not.toEqual(netShadowsAt(netSchool(7), 400));
  });

  it("the aim: integers on the water, within range; clampAimInt always passes the server's check", () => {
    expect(netAimError(80_000, 40_000)).toBeNull();
    expect(netAimError(80_000, 75_000)).toBe("aim");          // on the bank
    expect(netAimError(3_000, 40_000)).toBe("aim");
    expect(netAimError(10_000, 8_000)).toBe("aim");           // out of range
    expect(netAimError(80_000.5, 40_000)).toBe("aim");
    for (const p of [{ x: 0, y: 0 }, { x: 160, y: 0 }, { x: 80, y: 95 }, { x: 12.3456, y: 9.87 }, { x: 150, y: 70 }, { x: 80, y: 40 }]) {
      const a = clampAimInt(p);
      expect(netAimError(a.x, a.y), JSON.stringify(p)).toBeNull();
    }
    expect(clampAimInt({ x: 80, y: 40 })).toEqual({ x: 80_000, y: 40_000 });
  });

  it("landing, radius and the ellipse", () => {
    expect(netLanding(80_000, 20_000, 1000)).toEqual({ x: 80_000, y: 20_000 });
    expect(netLanding(80_000, 20_000, 850)).toEqual({ x: 80_000, y: 20_000 });
    expect(netLanding(80_000, 20_000, 0).y).toBe(84_000 - Math.trunc((64_000 * 450) / 1000));
    expect(netRadiusMilli(24, 1000)).toBe(14_000);
    expect(netRadiusMilli(36, 1000)).toBe(20_000);
    expect(netRadiusMilli(24, 0)).toBe(5_600);
    expect(insideNetMilli(10_000, 10_000, 10_000, 10_000, 5_000)).toBe(true);
    expect(insideNetMilli(14_000, 10_000, 10_000, 10_000, 5_000)).toBe(true);
    expect(insideNetMilli(10_000, 14_000, 10_000, 10_000, 5_000)).toBe(false);   // squashed: 3 px deep
  });

  it("the haul replay counts the shadows under the net at the landing tick", () => {
    const s = netSchool(99);
    const land = 200 + NETX.flightTicks;
    const target = netShadowsAt(s, land)[0];
    const aim = { x: Math.round(target.x), y: Math.min(NETX.aimMaxY, target.y) };
    if (netAimError(aim.x, aim.y) === null) {
      const r = netHaulReplay(99, 36, { press: 200 - s.period / 2, release: 200, aimX: aim.x, aimY: aim.y });
      expect(r.quality).toBe(1000);
      expect(r.landTick).toBe(land);
      expect(r.caught[0]).toBe(true);
      expect(r.hits).toBe(r.caught.filter(Boolean).length);
      expect(r.count).toBe(Math.max(0, 5 - (5 - r.hits)));
    }
    const weak = netHaulReplay(99, 24, { press: 10, release: 10, aimX: 80_000, aimY: 40_000 });
    expect(weak.quality).toBe(0);
    expect(weak.count).toBe(Math.max(0, 2 - (5 - weak.hits)));
  });

  it("a throw no client can make", () => {
    expect(netThrowError({ press: 0, release: 10, aimX: 80_000, aimY: 40_000 })).toBeNull();
    expect(netThrowError({ press: -1, release: 10, aimX: 80_000, aimY: 40_000 })).toBe("range");
    expect(netThrowError({ press: 11, release: 10, aimX: 80_000, aimY: 40_000 })).toBe("range");
    expect(netThrowError({ press: 0, release: NETX.maxRelease + 1, aimX: 80_000, aimY: 40_000 })).toBe("range");
    expect(netThrowError({ press: 0, release: 10, aimX: 80_000, aimY: 80_000 })).toBe("aim");
    expect(netThrowError({ press: 0.5, release: 10, aimX: 80_000, aimY: 40_000 })).toBe("range");
  });
});

describe("kéo lưới: the server-derived arrow rounds (0056)", () => {
  const common = { weightG: 300, rarity: 1 };
  const heavy = { weightG: 1500, rarity: 2 };
  it("the plan in integers: 0037's rounds, keys 4 … 9, timer 180 … 252 ticks", () => {
    expect(netArrowPlan([common])).toEqual({ rounds: 2, keys: 4, timer: 252 - Math.trunc((1300 * 48) / 10000) });
    expect(netArrowPlan([heavy, heavy, heavy, heavy, heavy])).toEqual({ rounds: 5, keys: 9, timer: 180 });
    expect(netArrowPlan([{ weightG: 1000, rarity: 2 }, { weightG: 1000, rarity: 2 }]).rounds).toBe(4);
    expect(netArrowPlan([]).rounds).toBe(2);
  });
  it("sequences from the arrow seed: the top two bits of mulberry32", () => {
    expect(netArrowSeq(5, 0, 6)).toEqual(netArrowSeq(5, 0, 6));
    expect(netArrowSeq(5, 0, 6)).toHaveLength(6);
    expect(netArrowSeq(5, 1, 6)).not.toEqual(netArrowSeq(5, 0, 6));
    for (const a of netArrowSeq(2147483647, 4, 9)) expect(ARROWS).toContain(a);
  });
  it("a clean game: every round typed in time", () => {
    const plan = { rounds: 2, keys: 4, timer: 240 };
    let g = arrowGame(11, plan);
    const keys: number[] = [];
    let t = 30;
    while (!g.done) {
      const a = g.seq[g.at];
      keys.push(t * 4 + ARROWS.indexOf(a));
      g = arrowPress(g, t, a);
      t += 10;
    }
    expect(g.mistakes).toBe(0);
    expect(g.end).toBe(t - 10);
    expect(netArrowReplay(11, plan, keys)).toEqual({ mistakes: 0, ticks: g.end });
  });
  it("wrong keys and time-outs are mistakes; the 4th ends it (kéo hụt)", () => {
    const plan = { rounds: 3, keys: 4, timer: 100 };
    let g = arrowGame(3, plan);
    const wrong = ARROWS.find((a) => a !== g.seq[0])!;
    g = arrowPress(g, 5, wrong);
    expect(g.wrongs).toBe(1);
    g = arrowAdvance(g, 100);                                  // round 1 timed out: 1 wrong + 1
    expect(g.mistakes).toBe(2);
    expect(g.round).toBe(1);
    expect(g.start).toBe(100);
    g = arrowAdvance(g, 199);
    expect(g.round).toBe(1);
    g = arrowAdvance(g, 200);                                  // round 2 timed out: 3
    expect(g.mistakes).toBe(3);
    const w2 = ARROWS.find((a) => a !== g.seq[0])!;
    g = arrowPress(g, 210, w2);                                // the 4th
    expect(g.done).toBe(true);
    expect(g.end).toBe(210);
    expect(Math.min(4, g.mistakes)).toBe(4);
    expect(netArrowReplay(3, plan, [5 * 4 + ARROWS.indexOf(wrong), 210 * 4 + ARROWS.indexOf(w2)])).toEqual({ mistakes: 4, ticks: 210 });
  });
  it("no keys at all: every round times out", () => {
    expect(netArrowReplay(1, { rounds: 2, keys: 4, timer: 200 }, [])).toEqual({ mistakes: 2, ticks: 400 });
    expect(netArrowReplay(1, { rounds: 5, keys: 4, timer: 200 }, [])).toEqual({ mistakes: 4, ticks: 800 });
  });
  it("a key after the end, or no client could send it", () => {
    const plan = { rounds: 2, keys: 4, timer: 200 };
    expect(netArrowReplay(1, plan, [400 * 4])).toEqual({ error: "late" });
    expect(netKeysError([0, 4, 8], 10)).toBeNull();
    expect(netKeysError([8, 4], 10)).toBe("order");
    expect(netKeysError([-1], 10)).toBe("range");
    expect(netKeysError([0.5], 10)).toBe("range");
    expect(netKeysError([11 * 4], 10)).toBe("range");
    expect(netKeysError(Array.from({ length: 65 }, (_, i) => i * 40), 3000)).toBe("too_many");
    expect(netKeysError(Array.from({ length: 21 }, (_, i) => i * 4), 100)).toBe("rate");
    expect(netKeysError(Array.from({ length: 21 }, (_, i) => i * 12), 3000)).toBeNull();   // 20 in 60 ticks is fine
    expect(netKeysError([], -1)).toBe("ticks");
    expect(netKeysError([], NETX.maxArrowTicks + 1)).toBe("ticks");
  });
});

describe("the shared fixtures (tests/fixtures/net-cases.json; tests/sql/anticheat-v2-net-smoke.sql replays them)", () => {
  const built = buildNetCases();
  if (process.env.WRITE_NET_FIXTURES === "1") writeFileSync(FILE, `${JSON.stringify(built, null, 1)}\n`);
  const cases = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, "utf8")) as NetCase[]) : [];
  it("are the generator's output", () => {
    expect(cases).toEqual(built);
  });
  it("cover full, partial and empty hauls, and clean, sloppy and failed pulls", () => {
    const hauls = cases.filter((c) => c.kind === "haul");
    const pulls = cases.filter((c) => c.kind === "arrows");
    expect(hauls.length).toBeGreaterThanOrEqual(12);
    expect(pulls.length).toBeGreaterThanOrEqual(10);
    const counts = new Set(hauls.map((c) => c.kind === "haul" ? c.expected.count : -1));
    expect(counts.has(0) && counts.has(5)).toBe(true);
    expect([...counts].some((n) => n > 0 && n < 5)).toBe(true);
    const mistakes = new Set(pulls.map((c) => c.kind === "arrows" ? c.expected.mistakes : -1));
    for (const m of [0, 1, 4]) expect(mistakes.has(m), `mistakes ${m}`).toBe(true);
  });
  it("are inputs an honest client can make (the server's input checks pass)", () => {
    for (const c of cases) {
      if (c.kind === "haul") expect(netThrowError(c.input), c.name).toBeNull();
      else expect(netKeysError(c.keys, c.expected.ticks), c.name).toBeNull();
    }
  });
});
