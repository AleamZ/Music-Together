import { describe, it, expect } from "vitest";
import { uplandFromRow, varietyFromRow, type UplandCrop, type UplandCropRow, type Variety } from "@/lib/game/farm/catalog";
import { cropModel, cropYield, HOUR_MS, partKg, yieldEstimate, type CropModel } from "@/lib/game/farm/crop";
import {
  FULL_CAPS, parseRatBag, parseRatCaps, parseRats, RAT, ratFactor, ratFleePos, ratHours, ratPos, type RatLogEntry,
} from "@/lib/game/farm/rats";
import type { CropView } from "@/lib/game/farm/state";
import { upEstimate, uplandModel, upYield, type UplandModel } from "@/lib/game/farm/upland";
import { nextRandom } from "@/lib/game/fishing/reel";
import rice from "@/tests/fixtures/crop-cases.json";
import upland from "@/tests/fixtures/upland-cases.json";

const V: Record<string, Variety> = Object.fromEntries([
  { id: "short", name: "Lúa ngắn ngày", scale: 0.9, base_kg: 90, price_per_kg: 710, blast_mult: 1, sort_order: 10 },
  { id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 950, blast_mult: 1, sort_order: 20 },
  { id: "thom", name: "Lúa thơm", scale: 1.15, base_kg: 60, price_per_kg: 1350, blast_mult: 1.3, sort_order: 30 },
].map((r) => [r.id, varietyFromRow(r)]));

/** [rat, from, to | null], hours after t0. */
type Entry = [number, number, number | null];
interface RiceCase {
  name: string; variety: string; land: number; q_transplant: number; q_harvest: number;
  soak: number; sow: number; transplant: number; harvest: number;
  water: Array<[number, number]>; fert: Array<[number, string]>; rats: Entry[];
  expect: { kg: number; mcare: number; mseed: number; mwater: number; mpest: number; mlate: number; mrat: number };
  parts?: Array<[number, number]>;
}
interface UplandCase {
  name: string; upland: string; land: number; sow: number | null; plant: number; pick: number; k: number;
  water: Array<[number, number]>; fert: Array<[number, string]>; work: Array<[number, string]>; rats: Entry[];
  expect: { kg: number; mcare: number; mplant: number; mwater: number; mrot: number; mpest: number; mlate: number; mrat: number };
}
interface Edge { name: string; log: Entry[]; t: number; hours: number; mrat: number }
const RX = rice as unknown as { t0: string; rats: RiceCase[]; rat_edges: Edge[] };
const UX = upland as unknown as { t0: string; crops: UplandCropRow[]; rats: UplandCase[] };
const U: Record<string, UplandCrop> = Object.fromEntries(UX.crops.map((r) => [r.id, uplandFromRow(r)]));
const t0 = Date.parse(RX.t0);
const at = (h: number) => t0 + h * HOUR_MS;

const logOf = (a: Entry[]): RatLogEntry[] => a.map(([r, from, to]) => ({ r, from: at(from), to: to === null ? null : at(to) }));
const riceOf = (k: RiceCase): CropModel => ({
  soakAt: at(k.soak), sowAt: at(k.sow), transplantAt: at(k.transplant), qTransplant: k.q_transplant,
  water: k.water.map(([h, l]) => ({ t: at(h), l })), fert: k.fert.map(([h, item]) => ({ t: at(h), item })), rats: logOf(k.rats),
});
const bedsOf = (k: UplandCase): UplandModel => ({
  sowAt: k.sow === null ? null : at(k.sow), plantAt: at(k.plant), water: k.water.map(([h, l]) => ({ t: at(h), l })),
  fert: k.fert.map(([h, item]) => ({ t: at(h), item })), work: k.work.map(([h, act]) => ({ t: at(h), act })), spray: [],
  harvests: [], rats: logOf(k.rats),
});

describe("the shared rat fixtures (the SQL smoke replays the same cases)", () => {
  it("has R1–R4, U1, U2 and ten edges", () => {
    expect(RX.rats.map((k) => k.name.slice(0, 2))).toEqual(["R1", "R2", "R3", "R4"]);
    expect(UX.rats.map((k) => k.name.slice(0, 2))).toEqual(["U1", "U2"]);
    expect(RX.rat_edges).toHaveLength(10);
  });
  for (const e of RX.rat_edges) {
    it(`rat-hours: ${e.name}`, () => {
      const h = ratHours(logOf(e.log), at(e.t));
      expect(h).toBe(e.hours);
      expect(ratFactor(h)).toBeCloseTo(e.mrat, 12);
    });
  }
  for (const k of RX.rats) {
    it(`rice: ${k.name}`, () => {
      const y = cropYield(riceOf(k), V[k.variety], k.land, k.q_harvest, [], at(k.harvest));
      expect(y.kg).toBe(k.expect.kg);
      for (const f of ["mcare", "mseed", "mwater", "mpest", "mlate", "mrat"] as const) expect(y[f], f).toBeCloseTo(k.expect[f], 12);
      (k.parts ?? []).forEach(([h, kg], i) => {
        const whole = cropYield(riceOf(k), V[k.variety], k.land, 1, [], at(h)).kg;
        expect(partKg(i + 1, whole), `part ${i + 1} at ${h} h (Y = ${whole})`).toBe(kg);
      });
    });
  }
  for (const k of UX.rats) {
    it(`hoa màu: ${k.name}`, () => {
      const y = upYield(bedsOf(k), U[k.upland], k.land, k.k, [], at(k.pick));
      expect(y.kg).toBe(k.expect.kg);
      for (const f of ["mcare", "mplant", "mwater", "mrot", "mpest", "mlate", "mrat"] as const) expect(y[f], f).toBeCloseTo(k.expect[f], 12);
    });
  }
  it("by hand: R1 is 90 × 0.96 = 86.4 → 86 kg, R2 is 75 × 0.90 = 67.5 → 68 kg", () => {
    expect(Math.floor(90 * ratFactor(2) + 0.5)).toBe(86);
    expect(Math.floor(75 * ratFactor(5) + 0.5)).toBe(68);
    expect(ratFactor(50)).toBe(ratFactor(5));
  });
});

describe("the estimate counts the rats so far, not future ones (§5.5)", () => {
  const r1 = RX.rats[0];
  it("rice", () => {
    expect(yieldEstimate(riceOf(r1), V.short, 1, [], at(58)).mrat).toBeCloseTo(0.96, 12);
    expect(yieldEstimate({ ...riceOf(r1), rats: undefined }, V.short, 1, [], at(58)).mrat).toBe(1);
    expect(yieldEstimate(riceOf(r1), V.short, 1, [], at(56)).mrat).toBe(1);
  });
  it("hoa màu", () => {
    const u1 = UX.rats[0];
    expect(upEstimate(bedsOf(u1), U.khoai, 1, 1, [], at(51)).mrat).toBeCloseTo(0.98, 12);
    expect(upEstimate(bedsOf(u1), U.khoai, 1, 1, [], at(50)).mrat).toBe(1);
  });
  it("the models take the plot's rat log (none by default)", () => {
    const view = { soakAt: null, sowAt: null, transplantAt: null, plantAt: null, log: null } as unknown as CropView;
    const log = logOf([[1, 1, null]]);
    expect(cropModel(view, log).rats).toBe(log);
    expect(cropModel(view).rats).toEqual([]);
    expect(uplandModel(view, log).rats).toBe(log);
    expect(uplandModel(view).rats).toEqual([]);
  });
});

describe("a rat's path (§5.4)", () => {
  // times are ms from the rat's `since` (0 here, so no precision is lost to the epoch)
  const hole = { x: 172, y: 46 }, plot = { x: 72, y: 52, w: 128, h: 96 }, seed = 1234567, since = 0;
  /** E = (172, 60), the inset plot's nearest point, 14 px from the hole. */
  const entry = (14 / 48) * 1000;
  const P = (i: number) => {
    const [a, s] = nextRandom(seed + 7919 * i);
    const [b] = nextRandom(s);
    return { x: 80 + a * 112, y: 60 + b * 80 };
  };
  const dist = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(q.x - p.x, q.y - p.y);

  it("comes out of its hole at `since` and runs at 48 px/s to the nearest point of the inset plot", () => {
    expect(ratPos(seed, since, hole, plot, since - 1)).toBeNull();
    expect(ratPos(seed, since, hole, plot, since)).toEqual({ x: 172, y: 46, dir: 1, moving: true });
    const mid = ratPos(seed, since, hole, plot, since + entry / 2)!;
    expect(mid.x).toBe(172);
    expect(mid.y).toBeCloseTo(53, 9);
    const e = ratPos(seed, since, hole, plot, since + entry)!;
    expect(e.x).toBeCloseTo(172, 9);
    expect(e.y).toBeCloseTo(60, 9);
  });
  it("then 6 s legs: a run of at most 1.5 s to P(i), then nibbling there", () => {
    for (const i of [0, 1, 2, 7]) {
      const start = since + entry + i * RAT.legMs, from = i === 0 ? { x: 172, y: 60 } : P(i - 1), to = P(i);
      const run = Math.min(1500, (dist(from, to) / 48) * 1000);
      const s0 = ratPos(seed, since, hole, plot, start)!;
      expect(s0.x).toBeCloseTo(from.x, 9);
      expect(s0.y).toBeCloseTo(from.y, 9);
      const half = ratPos(seed, since, hole, plot, start + run / 2)!;
      expect(half.moving).toBe(true);
      expect(half.x).toBeCloseTo((from.x + to.x) / 2, 9);
      expect(half.dir).toBe(to.x < from.x ? -1 : 1);
      expect(ratPos(seed, since, hole, plot, start + run + 1)).toMatchObject({ x: to.x, y: to.y, moving: false });
      expect(ratPos(seed, since, hole, plot, start + RAT.legMs - 1)).toMatchObject({ x: to.x, y: to.y, moving: false });
    }
  });
  it("stays inside the inset plot after its entry, the same on every call", () => {
    const bad: string[] = [];
    for (let i = 0; i < 2000; i++) {
      const t = since + entry + i * 137;
      const p = ratPos(seed, since, hole, plot, t)!;
      if (!(p.x >= 80 && p.x <= 192 && p.y >= 60 && p.y <= 140)) bad.push(`${i}: ${p.x}, ${p.y}`);
      const q = ratPos(seed, since, hole, plot, t)!;
      if (q.x !== p.x || q.y !== p.y || q.dir !== p.dir || q.moving !== p.moving) bad.push(`${i}: not the same`);
    }
    expect(bad).toEqual([]);
    expect(ratPos(seed + 1, since, hole, plot, since + 60_000)).not.toEqual(ratPos(seed, since, hole, plot, since + 60_000));
  }, 30_000);
  it("a fled rat runs back to its hole in 1.5 s", () => {
    const end = since + 20_000, p = ratPos(seed, since, hole, plot, end)!;
    expect(ratFleePos(seed, since, end, hole, plot, end)).toMatchObject({ x: p.x, y: p.y, moving: true });
    const half = ratFleePos(seed, since, end, hole, plot, end + 750)!;
    expect(half.x).toBeCloseTo((p.x + 172) / 2, 9);
    expect(half.y).toBeCloseTo((p.y + 46) / 2, 9);
    expect(ratFleePos(seed, since, end, hole, plot, end + 1500)).toBeNull();
  });
});

describe("the field's rats (§10.5)", () => {
  it("an answer from before 0019 has none", () => {
    expect(parseRats(undefined)).toBeNull();
    expect(parseRats(null)).toBeNull();
    expect(parseRats({ price: 150, live: [] })).toBeNull();
  });
  it("reads next_at, the price, the live and recent rats and the logs by plot", () => {
    const r = parseRats({
      next_at: "2026-03-01T00:20:00Z", price: 336,
      live: [{ id: 812, plot: 3, since: "2026-03-01T00:05:00Z", seed: 1234567 }, { id: "x", plot: 3 }],
      recent: [
        { id: 811, plot: 3, since: "2026-03-01T00:01:00Z", seed: 99, ended_at: "2026-03-01T00:15:00Z", how: "sling",
          by: { id: "u1", name: "Lan" }, dog: null },
        { id: 810, plot: 4, since: "2026-03-01T00:02:00Z", seed: 5, ended_at: "2026-03-01T00:15:01Z", how: "dog",
          by: { id: "u2", name: "Dat" }, dog: "Mực" },
        { id: 809, plot: 4, since: "2026-03-01T00:02:00Z", seed: 5, ended_at: "2026-03-01T00:15:02Z", how: "fled", by: null, dog: null },
        { id: 808, plot: 4, since: "2026-03-01T00:02:00Z", seed: 5, ended_at: "2026-03-01T00:15:02Z", how: "eaten" },
      ],
      plots: {
        3: [{ r: 811, from: "2026-03-01T00:02:00Z", to: "2026-03-01T00:15:00Z" }, { r: 812, from: "2026-03-01T00:06:00Z", to: null }],
        4: [], 11: [{ r: 1, from: "2026-03-01T00:02:00Z", to: null }],
      },
    });
    const T = (s: string) => Date.parse(`2026-03-01T00:${s}Z`);
    expect(r).toEqual({
      nextAt: T("20:00"), price: 336,
      live: [{ id: 812, plot: 3, since: T("05:00"), seed: 1234567 }],
      recent: [
        { id: 811, plot: 3, since: T("01:00"), seed: 99, endedAt: T("15:00"), how: "sling", by: { id: "u1", name: "Lan" }, dog: null },
        { id: 810, plot: 4, since: T("02:00"), seed: 5, endedAt: T("15:01"), how: "dog", by: { id: "u2", name: "Dat" }, dog: "Mực" },
        { id: 809, plot: 4, since: T("02:00"), seed: 5, endedAt: T("15:02"), how: "fled", by: null, dog: null },
      ],
      plots: { 3: [{ r: 811, from: T("02:00"), to: T("15:00") }, { r: 812, from: T("06:00"), to: null }] },
    });
  });
  it("reads the bag and the caps; an answer without them holds none and leaves the caps full", () => {
    expect(parseRatBag({ count: 2, value: 486 })).toEqual({ count: 2, value: 486 });
    expect(parseRatBag(undefined)).toEqual({ count: 0, value: 0 });
    expect(parseRatCaps({ hour_left: 4, hour_resets_at: "2026-03-01T01:00:00Z", day_left: 21 }))
      .toEqual({ hourLeft: 4, hourResetsAt: Date.parse("2026-03-01T01:00:00Z"), dayLeft: 21 });
    expect(parseRatCaps(undefined)).toEqual(FULL_CAPS);
    expect(FULL_CAPS).toEqual({ hourLeft: 6, hourResetsAt: null, dayLeft: 24 });
  });
});
