import { describe, it, expect } from "vitest";
import { varietyFromRow, type Variety } from "@/lib/game/farm/catalog";
import {
  cropCare, cropPhase, cropYield, excessN, HOUR_MS, nextPhaseAt, nextWaterDrop, partKg, pestHours, waterAt, waterOffHours, wantedWater,
  yieldEstimate, type CropModel,
} from "@/lib/game/farm/crop";
import type { PestKind, PestView } from "@/lib/game/farm/state";
import fixtures from "@/tests/fixtures/crop-cases.json";

const V: Record<string, Variety> = Object.fromEntries([
  { id: "short", name: "Lúa ngắn ngày", scale: 0.9, base_kg: 90, price_per_kg: 710, blast_mult: 1, sort_order: 10 },
  { id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 950, blast_mult: 1, sort_order: 20 },
  { id: "thom", name: "Lúa thơm", scale: 1.15, base_kg: 60, price_per_kg: 1350, blast_mult: 1.3, sort_order: 30 },
].map((r) => [r.id, varietyFromRow(r)]));

interface Case {
  name: string; variety: string; land: number; q_transplant: number; q_harvest: number;
  soak: number; sow: number; transplant: number; harvest: number;
  water: Array<[number, number]>; fert: Array<[number, string]>;
  expect: {
    kg: number; mcare: number; mseed: number; mwater: number; mpest: number; mlate: number;
    pests: Array<{ kind: PestKind; since_s: number; treated_s: number | null }>;
  };
  /** v15.2: six hand parts, [hours, kg] each — part i pays partKg(i, Y) with Y the plot's yield at its cut. */
  parts?: Array<[number, number]>;
}
const FX = fixtures as unknown as { t0: string; cases: Case[] };
const t0 = Date.parse(FX.t0);
const at = (h: number) => t0 + h * HOUR_MS;

const cropOf = (k: Case): CropModel => ({
  soakAt: at(k.soak), sowAt: at(k.sow), transplantAt: at(k.transplant), qTransplant: k.q_transplant,
  water: k.water.map(([h, l]) => ({ t: at(h), l })), fert: k.fert.map(([h, item]) => ({ t: at(h), item })),
});

describe("the shared crop fixtures (the SQL smoke replays the same cases)", () => {
  for (const k of FX.cases) {
    it(k.name, () => {
      const pests: PestView[] = k.expect.pests.map((p) => ({
        kind: p.kind, since: t0 + p.since_s * 1000, treatedAt: p.treated_s === null ? null : t0 + p.treated_s * 1000,
      }));
      const y = cropYield(cropOf(k), V[k.variety], k.land, k.q_harvest, pests, at(k.harvest));
      expect(y.kg).toBe(k.expect.kg);
      for (const f of ["mcare", "mseed", "mwater", "mpest", "mlate"] as const) expect(y[f], f).toBeCloseTo(k.expect[f], 12);
    });
  }
});

describe("rice in six parts (v15.2 §6.1, R5)", () => {
  it("splits Y exactly", () => {
    const parts = (y: number) => [1, 2, 3, 4, 5, 6].map((i) => partKg(i, y));
    expect(parts(75)).toEqual([12, 13, 12, 13, 12, 13]);
    expect(parts(99)).toEqual([16, 17, 16, 17, 16, 17]);
    expect(parts(7)).toEqual([1, 1, 1, 1, 1, 2]);
    for (let y = 6; y <= 200; y++) {
      expect(parts(y).reduce((a, b) => a + b, 0)).toBe(y);
      // after n parts the harvester pays y − floor(n·y/6): exactly parts n+1..6
      for (let n = 0; n <= 5; n++) expect(y - Math.floor((n * y) / 6)).toBe(parts(y).slice(n).reduce((a, b) => a + b, 0));
    }
  });
  for (const k of FX.cases.filter((c) => c.parts)) {
    it(`pays each part of Y at its cut: ${k.name}`, () => {
      k.parts!.forEach(([h, kg], i) => {
        const y = cropYield(cropOf(k), V[k.variety], k.land, 1, [], at(h)).kg;
        expect(partKg(i + 1, y), `part ${i + 1} at ${h} h (Y = ${y})`).toBe(kg);
      });
    });
  }
});

const nep = V.nep, short = V.short;
const bare = (over: Partial<CropModel> = {}): CropModel => ({
  soakAt: null, sowAt: null, transplantAt: null, qTransplant: 1, water: [{ t: at(0), l: 3 }], fert: [], ...over,
});
const grown = (over: Partial<CropModel> = {}) => bare({ soakAt: at(0), sowAt: at(3), transplantAt: at(12), ...over });

describe("water", () => {
  it("drops a level every 12 h, never below dry; the later of two same-time entries wins", () => {
    const log = [{ t: at(0), l: 3 }];
    expect([waterAt(log, at(11.99)), waterAt(log, at(12)), waterAt(log, at(100)), waterAt(log, at(-1))]).toEqual([3, 2, 0, 0]);
    expect(waterAt([{ t: at(0), l: 1 }, { t: at(0), l: 2 }], at(0))).toBe(2);
    expect(nextWaterDrop(log, at(13))).toBe(at(24));
    expect(nextWaterDrop(log, at(40))).toBeNull();
  });
  it("wants Ẩm for seedlings, Nông then phơi while tillering, Nông–Sâu at panicle and drained from ripening", () => {
    const c = grown();
    const want = (h: number) => wantedWater(c, nep, at(h))?.levels;
    expect([want(1), want(5), want(20), want(27), want(33), want(55), want(80)]).toEqual([
      undefined, [1], [2], [0, 1, 2], [2, 3], [0, 1], [0, 1],
    ]);
  });
  it("counts off-target 15-minute samples from sowing", () => {
    // seedlings want Ẩm but the plot stays flooded (3) from sowing at 3 h until the transplant at 12 h: 36 samples
    expect(waterOffHours(grown(), nep, at(12))).toBe(9);
    expect(waterOffHours(grown(), nep, at(3))).toBe(0);
  });
});

describe("phases", () => {
  it("follow §8.2", () => {
    const c = grown();
    const ph = (h: number) => cropPhase(c, nep, at(h));
    expect(cropPhase(bare(), null, at(1))).toBe("prepared");
    expect(cropPhase(bare({ soakAt: at(0) }), null, at(1.9))).toBe("soaking");
    expect(cropPhase(bare({ soakAt: at(0) }), null, at(2))).toBe("sprouted");
    expect([ph(3), ph(12), ph(29.9), ph(30), ph(42), ph(52), ph(60), ph(72)]).toEqual([
      "seedling", "tillering", "tillering", "panicle", "heading", "ripening", "ripe", "overripe",
    ]);
    expect(cropPhase(c, short, at(12 + 43.2))).toBe("ripe");
  });
  it("tells when the next phase starts", () => {
    const c = grown();
    expect(nextPhaseAt(bare({ soakAt: at(0) }), null, at(1))).toBe(at(2));
    expect(nextPhaseAt(c, nep, at(13))).toBe(at(30));
    expect(nextPhaseAt(c, nep, at(61))).toBe(at(72));
    expect(nextPhaseAt(c, nep, at(73))).toBe(at(120));
    expect(nextPhaseAt(bare({ soakAt: at(0), sowAt: at(3) }), nep, at(5))).toBeNull();
  });
});

describe("care", () => {
  it("scores the base fertilizers, the top-dresses, phơi ruộng and excess nitrogen", () => {
    const fert = (list: Array<[number, string]>) => grown({ fert: list.map(([h, item]) => ({ t: at(h), item })) });
    // the plot flooded at 0 h has drained to Ẩm on its own by T = 18 h (30 h): phơi ruộng is earned
    expect(cropCare(fert([[1, "fert_manure"], [1, "fert_phosphate"], [17, "fert_urea"], [32, "fert_potash"]]), nep)).toEqual({
      manure: true, phosphate: true, td1: 0, td2: 0, phoi: true, excess: false,
    });
    expect(cropCare(grown({ water: [{ t: at(0), l: 3 }, { t: at(24), l: 2 }] }), nep).phoi).toBe(false);
    // potash while tillering and NPK late in panicle are half credit; manure after transplanting is wasted
    expect(cropCare(fert([[13, "fert_manure"], [17, "fert_potash"], [38, "fert_npk"]]), nep)).toMatchObject({
      manure: false, td1: 0.1, td2: 0.1, excess: false,
    });
    expect(excessN(fert([[17, "fert_urea"], [20, "fert_npk"]]), nep, Infinity)).toBe(true);   // twice in tillering
    expect(excessN(fert([[32, "fert_urea"]]), nep, Infinity)).toBe(true);                     // urea at panicle
    expect(excessN(fert([[45, "fert_npk"]]), nep, Infinity)).toBe(true);                      // N at heading
    expect(excessN(fert([[32, "fert_urea"]]), nep, at(31))).toBe(false);                      // not yet
  });
});

describe("pests", () => {
  it("count hours until treated; snails only while the water is at least Nông", () => {
    const c = grown({ water: [{ t: at(0), l: 3 }, { t: at(16), l: 1 }] });
    const pest = (kind: PestKind, since: number, treated: number | null): PestView => ({ kind, since: at(since), treatedAt: treated === null ? null : at(treated) });
    expect(pestHours(c, pest("hopper", 20, 23), at(60))).toBe(3);
    expect(pestHours(c, pest("hopper", 20, null), at(26))).toBe(6);
    expect(pestHours(c, pest("snail", 14, null), at(20))).toBe(2);
  });
});

describe("yieldEstimate", () => {
  it("counts open windows as done on time, and what already happened as it is", () => {
    // seedlings in a well-drained bed, nothing applied yet: a full harvest is still possible
    const seedbed = bare({ soakAt: at(0), sowAt: at(3), water: [{ t: at(0), l: 3 }, { t: at(2.75), l: 1 }] });
    expect(yieldEstimate(seedbed, nep, 1, [], at(4))).toMatchObject({ kg: 75, mcare: 1, mwater: 1 });
    // at T = 25 h the base fertilizers and both top-dresses were missed, and the water was wrong for 18 h: a flooded
    // seedbed (9 h), then too low late in tillering (2 h) and at panicle (7 h)
    const late = yieldEstimate(grown(), nep, 1, [], at(37));
    expect(late.mcare).toBeCloseTo(0.5, 12);
    expect(late.mwater).toBeCloseTo(0.82, 12);
    expect(late.kg).toBe(31);
  });
});
