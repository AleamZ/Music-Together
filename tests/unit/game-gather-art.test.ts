import { describe, expect, it } from "vitest";
import {
  CRAB_SCENE, drawBedCue, drawCrabScene, drawHoleCue, drawTransplantScene, GUIDE_Y, hillX, paintBed, paintHole, TRANSPLANT_SCENE,
  type CrabView, type Paint, type TransplantView,
} from "@/lib/game/art/gather-art";
import type { TransplantHill } from "@/lib/game/farm/minigames";
import { CRAB_HOLES, SNAIL_BEDS } from "@/lib/game/maps/field";
import type { Rect } from "@/lib/game/maps/types";

type Op = { fill: string; alpha: number; x: number; y: number; w: number; h: number };

/** A 2D context that records each fill with its colour and alpha. */
function recorder(): { c: Paint; ops: Op[] } {
  const ops: Op[] = [];
  const c: Paint = {
    fillStyle: "",
    globalAlpha: 1,
    fillRect(x: number, y: number, w: number, h: number) {
      ops.push({ fill: String(c.fillStyle), alpha: c.globalAlpha, x, y, w, h });
    },
  };
  return { c, ops };
}
const of = (ops: readonly Op[], fill: string) => ops.filter((o) => o.fill === fill);
const inside = (ops: readonly Op[], r: Rect) =>
  ops.every((o) => o.x >= r.x && o.y >= r.y && o.x + o.w <= r.x + r.w && o.y + o.h <= r.y + r.h);
const whole = (ops: readonly Op[]) => ops.every((o) => [o.x, o.y, o.w, o.h].every(Number.isInteger));

describe("the field's holes and beds (v15.3 §15)", () => {
  it("digs each hole: a 10 × 6 burrow in its rim, in bank mud, with 2–3 pellets, inside its rect", () => {
    for (const r of CRAB_HOLES) {
      const { c, ops } = recorder();
      paintHole(c, r);
      expect(inside(ops, r)).toBe(true);
      expect(of(ops, "#3a2a1a").map((o) => [o.w, o.h])).toEqual([[10, 6]]);
      expect(of(ops, "#5a4128")).toHaveLength(1);
      expect(of(ops, "#6e5230").length).toBeGreaterThan(0);
      expect(of(ops, "#7a5c38").length).toBeGreaterThanOrEqual(2);
      expect(of(ops, "#7a5c38").length).toBeLessThanOrEqual(3);
    }
  });
  it("lays each bed across the water's edge: sand under light water, hyacinth leaves and two stones, inside its rect", () => {
    for (const r of SNAIL_BEDS) {
      const { c, ops } = recorder();
      paintBed(c, r);
      expect([r.w, r.h]).toEqual([20, 10]);
      expect(inside(ops, r)).toBe(true);
      for (const col of ["#8cc3d6", "#c9b58a", "#4f9a38", "#6fbf4a"]) expect(of(ops, col).length, col).toBeGreaterThan(0);
      expect(of(ops, "#d9d2c0")).toHaveLength(2);
    }
  });
});

describe("the cues on a spot ready for me (v15.3 §15)", () => {
  const hole = (t: number, reduced = false) => {
    const { c, ops } = recorder();
    drawHoleCue(c, 100, 50, t, reduced);
    return ops;
  };
  const bed = (t: number, reduced = false) => {
    const { c, ops } = recorder();
    drawBedCue(c, 10, 20, t, reduced);
    return ops;
  };
  it("peeks a crab out of a hole, two eye stalks and a claw tip, with a bubble rising every 1.5 s", () => {
    expect(of(hole(0), "#2a2f3a")).toHaveLength(2);
    expect(of(hole(0), "#b8432f")).toHaveLength(1);
    const bubble = (t: number, reduced = false) => of(hole(t, reduced), "#e8f4f8")[0].y;
    expect(bubble(0)).not.toBe(bubble(1000));
    expect(bubble(200)).toBe(bubble(1700));
    expect(new Set([0, 400, 900, 1400].map((t) => bubble(t, true))).size).toBe(1);
  });
  it("glints 2–3 shells on a bed, ốc đồng and ốc bươu vàng, one at a time", () => {
    const shells = of(bed(0), "#4a3a22").length + of(bed(0), "#c9955a").length;
    expect(shells).toBeGreaterThanOrEqual(2);
    expect(shells).toBeLessThanOrEqual(3);
    expect(of(bed(0), "#c9955a").length).toBeGreaterThan(0);
    const glint = (t: number, reduced = false) => {
      const g = of(bed(t, reduced), "#e8f4f8")[0];
      return `${g.x},${g.y}`;
    };
    expect(glint(0)).not.toBe(glint(600));
    expect(new Set([0, 600, 1200].map((t) => glint(t, true))).size).toBe(1);
  });
});

describe("CrabGame's scene (v15.3 §15)", () => {
  const scene = (v: Partial<CrabView> = {}) => {
    const { c, ops } = recorder();
    drawCrabScene(c, { closed: false, lurking: false, mark: null, t: 0, reduced: false, ...v });
    return ops;
  };
  it("fills its 96 × 64 and no more, on whole pixels", () => {
    expect(CRAB_SCENE).toEqual({ w: 96, h: 64 });
    for (const v of [{}, { closed: true }, { lurking: true }, { mark: "hit" as const }, { mark: "pinch" as const, t: 700 }]) {
      const ops = scene(v);
      expect(inside(ops, { x: 0, y: 0, ...CRAB_SCENE })).toBe(true);
      expect(whole(ops)).toBe(true);
    }
  });
  it("outlines the claws red and spread wide when open, green and together when closed", () => {
    const open = scene(), closed = scene({ closed: true });
    expect(of(open, "#d8342a")).toHaveLength(2);
    expect(of(open, "#4caf50")).toHaveLength(0);
    expect(of(closed, "#4caf50")).toHaveLength(2);
    expect(of(closed, "#d8342a")).toHaveLength(0);
    const spread = (ops: Op[], col: string) => {
      const xs = of(ops, col).map((o) => o.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(spread(open, "#d8342a")).toBeGreaterThan(2 * spread(closed, "#4caf50"));
    expect(of(open, "#6b5a2e").length).toBeGreaterThan(0);
  });
  it("keeps the crab low in the hole, its claws hidden, through the lead-in", () => {
    const lurk = scene({ lurking: true });
    expect(of(lurk, "#d8342a").length + of(lurk, "#4caf50").length).toBe(0);
    const shell = (ops: Op[]) => of(ops, "#6b5a2e").find((o) => o.w === 22)!.y;
    expect(shell(lurk)).toBeGreaterThan(shell(scene()));
  });
  it("dips the hand on a hit, and jerks it back with ! marks on a pinch", () => {
    const hand = (ops: Op[]) => of(ops, "#e0b089").find((o) => o.w === 12)!.y;
    const idle = scene({ reduced: true });
    expect(hand(scene({ mark: "hit", reduced: true }))).toBeGreaterThan(hand(idle));
    expect(hand(scene({ mark: "pinch", reduced: true }))).toBeLessThan(hand(idle));
    expect(of(scene({ mark: "pinch", reduced: true }), "#d8342a")).toHaveLength(of(idle, "#d8342a").length + 4);
  });
  it("shakes the open claws and hovers the hand, but not under reduced motion", () => {
    const ts = [0, 40, 80, 120, 160, 900];
    const claw = (t: number, reduced: boolean) => of(scene({ t, reduced }), "#d8342a")[0].x;
    expect(new Set(ts.map((t) => claw(t, false))).size).toBeGreaterThan(1);
    expect(new Set(ts.map((t) => claw(t, true))).size).toBe(1);
    const hand = (t: number, reduced: boolean) => of(scene({ t, reduced }), "#e0b089").find((o) => o.w === 12)!.y;
    expect(new Set(ts.map((t) => hand(t, true))).size).toBe(1);
  });
});

describe("TransplantGame's scene (v15.3 §15)", () => {
  const hill = (mark: TransplantHill["mark"]): TransplantHill => ({ x: mark === "sot" ? null : 0.5, centre: 0.5, mark, score: 0 });
  const scene = (v: Partial<TransplantView> = {}) => {
    const { c, ops } = recorder();
    drawTransplantScene(c, { hills: [], centre: 0.5, x: 0.3, ot: false, t: 0, reduced: false, ...v });
    return { ops, alpha: c.globalAlpha };
  };
  it("fills its 160 × 48 and no more, on whole pixels", () => {
    expect(TRANSPLANT_SCENE).toEqual({ w: 160, h: 48 });
    const hills = [hill("chuan"), hill("lech"), hill("sot"), ...Array.from({ length: 9 }, () => hill("duoc"))];
    for (const v of [{}, { centre: 0.35, x: 0 }, { centre: 0.65, x: 1, hills }, { ot: true, hills, t: 2500 }]) {
      const { ops } = scene(v);
      expect(inside(ops, { x: 0, y: 0, ...TRANSPLANT_SCENE })).toBe(true);
      expect(whole(ops)).toBe(true);
    }
  });
  it("draws the band at 35 % alpha around its chuẩn core at 55 %, then restores the alpha", () => {
    const { ops, alpha } = scene({ centre: 0.5 });
    const band = ops.filter((o) => o.alpha === 0.35), core = ops.filter((o) => o.alpha === 0.55);
    expect(band.map((o) => o.fill)).toEqual(["#6fbf4a"]);
    expect(core.map((o) => o.fill)).toEqual(["#6fbf4a"]);
    expect(core[0].w).toBeLessThan(band[0].w);
    const mid = (o: Op) => o.x + o.w / 2;
    expect(Math.abs(mid(core[0]) - mid(band[0]))).toBeLessThanOrEqual(1);
    expect(ops.filter((o) => ![1, 0.35, 0.55].includes(o.alpha))).toHaveLength(0);
    expect(alpha).toBe(1);
    expect(scene({ centre: null }).ops.filter((o) => o.alpha !== 1)).toHaveLength(0);
  });
  it("sets 12 slots on the guide line, a tuft for each hill set, a lệch one 2 px off the line, none for a sót", () => {
    expect(of(scene().ops, "#5a4128").filter((o) => o.w === 3 && o.h === 3)).toHaveLength(12);
    const stalks = of(scene({ hills: [hill("chuan"), hill("lech"), hill("sot"), hill("duoc")] }).ops, "#4f9a38");
    expect(stalks.map((o) => o.x)).toEqual([hillX(0), hillX(1), hillX(3)]);
    expect(stalks[0].y + stalks[0].h).toBe(GUIDE_Y);
    expect(stalks[1].y - stalks[0].y).toBe(2);
    expect(stalks[2].y).toBe(stalks[0].y);
  });
  it("moves the hand with its tied bunch along the sweep, and hides it outside one", () => {
    const hand = (x: number | null) => of(scene({ x }).ops, "#e0b089");
    expect(hand(0.2)[0].x).toBeLessThan(hand(0.8)[0].x);
    expect(of(scene({ x: 0.5 }).ops, "#8b5a33")).toHaveLength(1);
    expect(hand(null)).toHaveLength(0);
  });
  it("draws the ớt round's rounder leaves", () => {
    expect(of(scene({ ot: true, x: 0.5, hills: [hill("chuan")] }).ops, "#5caa4a").length).toBeGreaterThanOrEqual(3);
    expect(of(scene({ x: 0.5, hills: [hill("chuan")] }).ops, "#5caa4a")).toHaveLength(0);
  });
  it("lets the mud's sheen shimmer, but not under reduced motion", () => {
    const sheen = (t: number, reduced: boolean) => JSON.stringify(of(scene({ t, reduced }).ops, "#86683f"));
    expect(sheen(0, false)).not.toBe(sheen(500, false));
    expect(sheen(0, true)).toBe(sheen(500, true));
  });
});
