import { describe, it, expect } from "vitest";
import { uplandFromRow, type UplandCrop, type UplandCropRow } from "@/lib/game/farm/catalog";
import { HOUR_MS, plusH, waterAt } from "@/lib/game/farm/crop";
import { PEST_NAME, PEST_REMEDY } from "@/lib/game/farm/messages";
import type { PestKind } from "@/lib/game/farm/state";
import {
  nurseryReadyAt, upCare, upEstimate, upExcessN, upLostAt, upNext, upNextPhaseAt, upOffHours, upOverAt, upPests, upPhase, upReadyAt,
  upRotHours, upSeasonEstimate, upWantedWater, upYield, type UplandModel, type UplandRoll,
} from "@/lib/game/farm/upland";
import fixtures from "@/tests/fixtures/upland-cases.json";

/** A fixture time: hours after t0, or [hours, seconds]. */
type At = number | [number, number];
interface Case {
  name: string; upland: string; land: number; sow: At | null; plant: At | null; pick: At; k: number;
  water: Array<[At, number]>; fert: Array<[At, string]>; work: Array<[At, string]>; spray: Array<[At, string]>;
  harvests: Array<[At, number, number]>; pest_rolls: Array<{ slot: number; u_time: number; u_hit: number }>;
  expect: Record<string, unknown>;
}
const FX = fixtures as unknown as { t0: string; crops: UplandCropRow[]; cases: Case[]; edges: Case[] };
const t0 = Date.parse(FX.t0);
const at = (h: At) => t0 + (Array.isArray(h) ? h[0] * 3600 + h[1] : h * 3600) * 1000;
const U: Record<string, UplandCrop> = Object.fromEntries(FX.crops.map((r) => [r.id, uplandFromRow(r)]));

const modelOf = (k: Case): UplandModel => ({
  sowAt: k.sow === null ? null : at(k.sow), plantAt: k.plant === null ? null : at(k.plant),
  water: k.water.map(([h, l]) => ({ t: at(h), l })), fert: k.fert.map(([h, item]) => ({ t: at(h), item })),
  work: k.work.map(([h, act]) => ({ t: at(h), act })), spray: k.spray.map(([h, item]) => ({ t: at(h), item })),
  harvests: k.harvests.map(([h, n, kg]) => ({ t: at(h), k: n, kg })),
});
const rollsOf = (k: Case): UplandRoll[] => k.pest_rolls.map((r) => ({ slot: r.slot, uTime: r.u_time, uHit: r.u_hit }));

/** What the SQL smoke reads for each expected key (tests/sql/v15-2-smoke.sql). */
function evaluate(k: Case): Record<string, unknown> {
  const c = modelOf(k), u = U[k.upland], t = at(k.pick), got: Record<string, unknown> = {};
  const pests = upPests(c, u, rollsOf(k), t);
  for (const f of Object.keys(k.expect)) {
    switch (f) {
      case "phase": got.phase = upPhase(c, u, t); break;
      case "next": got.next = upNext(c, u, t); break;
      case "water": got.water = waterAt(c.water, t); break;
      case "off_hours": got.off_hours = upOffHours(c, u, t); break;
      case "rot_hours": got.rot_hours = upRotHours(c, u, t); break;
      case "scores": case "manure": case "phosphate": case "excess": got[f] = upCare(c, u)[f]; break;
      case "pests":
        got.pests = pests.map((p) => ({ kind: p.kind, since_s: (p.since - t0) / 1000, treated_s: p.treatedAt === null ? null : (p.treatedAt - t0) / 1000 }));
        break;
      case "transplant": got.transplant = upPhase(c, u, t) === "nursery" && t >= plusH(c.sowAt!, u.nurseryReadyH!); break;
      default: got[f] = upYield(c, u, k.land, k.k, pests, t)[f as "kg"];
    }
  }
  return got;
}

const FLOATS = new Set(["mcare", "mplant", "mwater", "mrot", "mpest", "mlate", "off_hours", "rot_hours"]);

describe("the shared hoa-màu fixtures (the SQL smoke replays the same cases)", () => {
  it("has the 11 cases of §16", () => {
    expect(FX.cases).toHaveLength(11);
  });
  for (const k of [...FX.cases, ...FX.edges]) {
    it(k.name, () => {
      const got = evaluate(k);
      for (const [f, want] of Object.entries(k.expect)) {
        if (FLOATS.has(f)) expect(got[f] as number, f).toBeCloseTo(want as number, 12);
        else if (f === "scores") (want as number[]).forEach((w, i) => expect((got.scores as number[])[i], `score ${i}`).toBeCloseTo(w, 12));
        else expect(got[f], f).toEqual(want);
      }
    });
  }
});

const khoai = U.khoai, bap = U.bap, ot = U.ot;
const T = (h: number) => t0 + h * HOUR_MS;
const beds = (over: Partial<UplandModel> = {}): UplandModel => ({
  sowAt: null, plantAt: null, water: [{ t: T(0), l: 1 }], fert: [], work: [], spray: [], harvests: [], ...over,
});
/** ớt sown at 0 h and transplanted at 12 h: R_1 = 58 h, R_2 = 70 h, R_3 = 82 h. */
const ots = (over: Partial<UplandModel> = {}) => beds({ sowAt: T(0), plantAt: T(12), ...over });

describe("phases and pickings (§8.3, R24)", () => {
  it("go from the beds through the nursery and the stages to each picking", () => {
    const c = ots();
    const ph = (h: number) => upPhase(c, ot, T(h));
    expect(upPhase(beds(), ot, T(5))).toBe("prepared");
    expect([ph(-1), ph(0), ph(11.9), ph(12), ph(19.9), ph(20), ph(45), ph(57.9)]).toEqual([
      "prepared", "nursery", "nursery", "root", "root", "grow", "flower", "fruit",
    ]);
    // picking 1 stays the next one, overripe, until it is lost at L_1 = 90 h
    expect([ph(58), ph(65.9), ph(66), ph(89.9), ph(90)]).toEqual(["ripe", "ripe", "overripe", "overripe", "overripe"]);
    // picking 1 taken at 60 h: waiting for picking 2 until R_2
    const picked = ots({ harvests: [{ t: T(60), k: 1, kg: 24 }] });
    expect([upPhase(picked, ot, T(61)), upPhase(picked, ot, T(70))]).toEqual(["waiting", "ripe"]);
    expect(upNextPhaseAt(picked, ot, T(61))).toBe(T(70));
  });
  it("loses an unpicked picking after its window, and is done when none is left", () => {
    const c = ots();
    expect([upReadyAt(c, ot, 1), upOverAt(c, ot, 1), upLostAt(c, ot, 1)]).toEqual([T(58), T(66), T(90)]);
    expect([upNext(c, ot, T(89.9)), upNext(c, ot, T(90)), upNext(c, ot, T(102)), upNext(c, ot, T(114))]).toEqual([1, 2, 3, 0]);
    expect(upPhase(c, ot, T(114))).toBe("done");
    expect(upNext(beds(), ot, T(5))).toBe(0);
  });
  it("tells when the nursery is ready and what the beds should hold", () => {
    expect(nurseryReadyAt(ots(), ot)).toBe(T(10));
    expect([upWantedWater(beds(), khoai, T(1)), upWantedWater(ots(), ot, T(5)), upWantedWater(ots(), ot, T(25))]).toEqual([null, [1], [1, 2]]);
    const k = beds({ plantAt: T(0) });
    expect([upWantedWater(k, khoai, T(3)), upWantedWater(k, khoai, T(30)), upWantedWater(k, khoai, T(50))]).toEqual([[1], [0, 1], [0, 1]]);
  });
});

describe("water and rot (§8.4)", () => {
  it("counts off-target samples from the first planting action, and rot at Đẫm or more from rot_from_h", () => {
    // khoai planted at 0 h on a bed flooded to Đẫm at 20 h: the vine stage wants Khô–Ẩm
    const c = beds({ plantAt: T(0), water: [{ t: T(0), l: 1 }, { t: T(20), l: 2 }] });
    expect(upOffHours(c, khoai, T(22))).toBe(2);
    expect(upRotHours(c, khoai, T(22))).toBe(0);
    expect(upRotHours(c, khoai, T(24))).toBe(2);
    expect(upRotHours(c, bap, T(24))).toBe(0);
  });
});

describe("care (§8.5, R23)", () => {
  const P = T(1);
  const fert = (list: Array<[number, string]>) => beds({ plantAt: P, fert: list.map(([h, item]) => ({ t: T(h), item })) });
  it("scores bón lót before P and each care's best entry", () => {
    const c = fert([[0, "fert_manure"], [0.5, "fert_phosphate"], [8, "fert_urea"], [21, "fert_potash"]]);
    // khoai: td half at 7 h after P (urê), then on time at 20 h (kali): the best counts; lật dây missing
    expect(upCare(c, khoai)).toEqual({ manure: true, phosphate: true, scores: [0, 0.1], excess: false });
    const work = beds({ plantAt: P, work: [{ t: T(36), act: "lat_day" }, { t: T(30), act: "lat_day" }] });
    expect(upCare(work, khoai).scores).toEqual([0.2, 0]);
  });
  it("finds excess N outside every region that takes it, or twice in one region", () => {
    expect(upExcessN(fert([[40, "fert_urea"]]), khoai, Infinity)).toBe(true);
    expect(upExcessN(fert([[17, "fert_npk"], [20, "fert_npk"]]), khoai, Infinity)).toBe(true);
    expect(upExcessN(fert([[17, "fert_npk"], [20, "fert_npk"]]), khoai, T(19))).toBe(false);
    expect(upExcessN(fert([[10, "fert_urea"], [40, "fert_npk"]]), bap, Infinity)).toBe(false);
  });
});

describe("the yield (§8.7)", () => {
  it("pays old seedlings −3 %/h past nursery_old_h, at most 30 %", () => {
    const y = (plantH: number) => upYield(beds({ sowAt: T(0), plantAt: T(plantH) }), ot, 1, 1, [], T(plantH + 46)).mplant;
    expect([y(18), y(20)]).toEqual([1, 1 - 0.03 * 2]);
    expect(y(40)).toBeCloseTo(0.7, 12);
  });
  it("estimates as if the open cares are done on time, the whole season too", () => {
    // ớt transplanted at 12 h, nothing done yet at 14 h: the base fertilizers are gone (−10 %), the cares still open
    const c = ots();
    expect(upEstimate(c, ot, 1, 1, [], T(14)).mcare).toBeCloseTo(0.9, 12);
    expect(upEstimate(beds({ sowAt: T(0) }), ot, 1, 1, [], T(5)).mcare).toBe(1);
    const all = upSeasonEstimate(c, ot, 1, [], T(14));
    expect(all).toBe([1, 2, 3].reduce((a, k) => a + upEstimate(c, ot, 1, k, [], T(14)).kg, 0));
    const picked = ots({ harvests: [{ t: T(60), k: 1, kg: 20 }] });
    expect(upSeasonEstimate(picked, ot, 1, [], T(61))).toBe(20 + upEstimate(picked, ot, 1, 2, [], T(61)).kg + upEstimate(picked, ot, 1, 3, [], T(61)).kg);
  });
});

describe("the pests' names and remedies", () => {
  it("match the config", () => {
    for (const u of Object.values(U)) {
      for (const p of u.pests) {
        expect(PEST_NAME[p.kind as PestKind], p.kind).toBe(p.name);
        expect(PEST_REMEDY[p.kind as PestKind], p.kind).toBe(p.remedy);
      }
    }
  });
});
