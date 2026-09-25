import { describe, it, expect } from "vitest";
import {
  HARVESTER_H, HARVESTER_PAL, HARVESTER_ROWS, HARVESTER_W, harvesterSpot, liveLook, lookKey, plotDraws, plotLabel, plotLook, postLabel,
  riceCut, type PlotDraw,
} from "@/lib/game/art/crops";
import { uplandFromRow, varietyFromRow, type UplandCropRow } from "@/lib/game/farm/catalog";
import { HOUR_MS } from "@/lib/game/farm/crop";
import type { CropView, PlotView } from "@/lib/game/farm/state";
import fixtures from "@/tests/fixtures/upland-cases.json";

const t0 = Date.parse("2026-09-25T00:00:00Z");
const at = (h: number) => t0 + h * HOUR_MS;
const nep = varietyFromRow({ id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 });
const short = varietyFromRow({ id: "short", name: "Lúa ngắn ngày", scale: 0.9, base_kg: 90, price_per_kg: 12, blast_mult: 1, sort_order: 10 });

/** Nếp on plot 5: prepared and soaked at 0 h, sown at 3 h, transplanted at 12 h unless `over` says otherwise. */
const crop = (over: Partial<CropView> = {}): CropView => ({
  kind: "rice", variety: "nep", upland: null, phase: "tillering", preparedAt: at(0), soakAt: at(0), sowAt: at(3), transplantAt: at(12),
  plantAt: null, water: 2, waterSetAt: at(12), pests: [], excessN: false, ripe: false, rottedAt: null, picking: null, pickings: 1,
  parts: 0, harvester: null, log: null, ...over,
});
const NO_LOG = { work: [], harvests: [], harvestedKg: 0 };
const plot = (over: Partial<PlotView> = {}): PlotView => ({
  no: 5, kind: "village", owner: null, salePrice: null, subleasePrice: null, farmer: null, lease: null, offers: 0, crop: null, ...over,
});

describe("plotLook", () => {
  it("leaves unprepared plots to the background's stubble", () => {
    expect(plotLook(5, null, null, at(0))).toBeNull();
    // seed soaking at home before the plot is prepared
    expect(plotLook(5, crop({ preparedAt: null, sowAt: null, transplantAt: null }), nep, at(1))).toBeNull();
  });
  it("shows prepared mud until sowing, then a seedbed that grows until the seedlings are old", () => {
    const bed = crop({ transplantAt: null });
    expect(plotLook(5, crop({ sowAt: null, transplantAt: null }), nep, at(2))).toMatchObject({ stage: "prepared", progress: 0 });
    expect(plotLook(5, bed, nep, at(3))).toMatchObject({ stage: "seedbed", progress: 0 });
    expect(plotLook(5, bed, nep, at(10))).toMatchObject({ stage: "seedbed", progress: 0.5 });
    expect(plotLook(5, bed, nep, at(40))).toMatchObject({ stage: "seedbed", progress: 1 });
  });
  it("grows through the stages after transplanting, scaled by the variety", () => {
    const stage = (h: number, v = nep) => plotLook(5, crop(), v, at(12 + h))?.stage;
    expect([1, 4, 20, 33, 44, 50, 70].map((h) => stage(h))).toEqual(
      ["transplanted", "tillering", "panicle", "heading", "ripening", "ripe", "overripe"]);
    // short rice (s = 0.9) is ripe at 43.2 h, nếp only at 48 h
    expect(stage(44, short)).toBe("ripe");
    expect(plotLook(5, crop(), nep, at(12 + 44))).toMatchObject({ stage: "ripening", progress: 0.5 });
    expect(plotLook(5, crop(), nep, at(12 + 200))).toMatchObject({ stage: "overripe", progress: 1 });
  });
  it("draws the untreated pests only, and crooked rows after a poor transplant", () => {
    const pests = [
      { kind: "hopper" as const, since: at(20), treatedAt: null },
      { kind: "leaf_folder" as const, since: at(18), treatedAt: at(19) },
    ];
    expect(plotLook(5, crop({ pests }), nep, at(22))).toMatchObject({ pests: ["hopper"], wobble: false });
    const log = { water: [], fert: [], spray: [], picks: [], qTransplant: 0.95, ...NO_LOG };
    expect(plotLook(5, crop({ log }), nep, at(22))?.wobble).toBe(true);
  });
  it("reads the water from the farmer's log at any time, else the level fetched", () => {
    expect(plotLook(5, crop({ water: 3 }), nep, at(40))?.water).toBe(3);
    const log = { water: [{ t: at(12), l: 3 }], fert: [], spray: [], picks: [], qTransplant: 1, ...NO_LOG };
    // one level lost per 12 h: 3 at 12 h → 1 at 36 h
    expect(plotLook(5, crop({ water: 3, log }), nep, at(36))?.water).toBe(1);
  });
  it("keys the painted plot by stage, progress in fifths, water, pests and rows", () => {
    const key = (h: number) => lookKey(plotLook(5, crop(), nep, at(12 + h))!);
    expect(key(4)).toBe(key(5));
    expect(key(4)).not.toBe(key(10));
    expect(key(4)).toBe("rice|tillering|0|2||0|0|0");
  });
});

describe("plot labels", () => {
  it("names the owner of a private plot and the farmer of a village plot", () => {
    expect(plotLabel(plot({ no: 2, kind: "private", owner: { id: "a", name: "An" }, farmer: { id: "b", name: "Bình" } }))).toBe("2 · An");
    expect(plotLabel(plot({ no: 3, kind: "private" }))).toBe("3 · đất bán");
    expect(plotLabel(plot({ farmer: { id: "b", name: "Bình" } }))).toBe("5 · Bình");
    expect(plotLabel(plot())).toBe("5 · đất trống");
  });
  it("gives the engine every plot with its look, label and my urgent ring", () => {
    const plots = [plot({ no: 5, crop: crop() }), plot({ no: 6 })];
    const draws = plotDraws(plots, { varieties: [nep], uplands: [] }, new Set([5]), at(16));
    expect(draws.map((d) => [d.no, d.look?.stage ?? null, d.label, d.urgent, d.parts, d.harvester])).toEqual([
      [5, "tillering", "5 · đất trống", true, 0, null],
      [6, null, "6 · đất trống", false, 0, null],
    ]);
  });
});

describe("v15.2: beds, the cut strips and the harvester", () => {
  const U = Object.fromEntries((fixtures as unknown as { crops: UplandCropRow[] }).crops.map((r) => [r.id, uplandFromRow(r)]));
  const LOG = { fert: [], spray: [], picks: [], qTransplant: 1, work: [], harvestedKg: 0 };
  /** Beds on plot 5 prepared at 0 h, Ẩm; `upland` planted at 0 h unless `over` says otherwise. */
  const beds = (upland: string | null, over: Partial<CropView> = {}, harvests: Array<[number, number]> = []): CropView => crop({
    kind: "upland", variety: null, upland, soakAt: null, sowAt: null, transplantAt: null, plantAt: upland === null ? null : at(0), water: 1,
    pickings: upland === null ? 0 : U[upland].pickings.length,
    log: { ...LOG, water: [{ t: at(0), l: 1 }], harvests: harvests.map(([h, k]) => ({ t: at(h), k, kg: 10 })) },
    ...over,
  });
  const look = (c: CropView, h: number) => plotLook(5, c, null, at(h), c.upland ? U[c.upland] : null);

  it("draws bare beds, then the config's stages by index, the ripe window and the overripe one", () => {
    expect(look(beds(null), 1)).toMatchObject({ crop: "", stage: "beds", water: 1, cut: 0, picked: 0 });
    expect(look(beds("khoai"), 3)).toMatchObject({ crop: "khoai", stage: "g0", progress: 0.5 });
    expect(look(beds("khoai"), 10)).toMatchObject({ stage: "g1", progress: 0.25 });
    expect(look(beds("khoai"), 51)).toMatchObject({ stage: "ripe", progress: 0.25, picked: 0, pickings: 1 });
    expect(look(beds("khoai"), 72)).toMatchObject({ stage: "overripe", progress: 0.25 });
    expect(look(beds("bap"), 55)).toMatchObject({ crop: "bap", stage: "g4", progress: 0.5 });
    // no config yet (the catalog before 0016 loads): bare beds
    expect(plotLook(5, beds("khoai"), null, at(10))).toMatchObject({ crop: "", stage: "beds" });
  });
  it("draws the ớt nursery, then its pickings thinning out", () => {
    const nursery = beds("ot", { sowAt: at(0), plantAt: null });
    expect(look(nursery, 5)).toMatchObject({ crop: "ot", stage: "nursery", progress: 0.5 });
    // set out at 12 h: picking 1 is ripe at 58 h, picking 2 at 70 h
    const ot = (harvests: Array<[number, number]>) => beds("ot", { sowAt: at(0), plantAt: at(12) }, harvests);
    expect(look(ot([]), 60)).toMatchObject({ stage: "ripe", picked: 0, pickings: 3 });
    expect(look(ot([[59, 1]]), 62)).toMatchObject({ stage: "waiting", picked: 1 });
    // a neighbour has no log: the server's next picking tells what is gone
    const seen = { ...ot([]), log: null, picking: 2 };
    expect(look(seen, 72)).toMatchObject({ stage: "ripe", picked: 1 });
    expect(look({ ...seen, picking: 0 }, 72)).toMatchObject({ stage: "beds", picked: 3 });
  });
  it("cuts rice strips by the parts, and a harvester over the rest on its way", () => {
    const job = { startedAt: at(61), endsAt: at(61) + 30_000 };
    expect(riceCut(0, null, at(61))).toBe(0);
    expect(riceCut(2, null, at(61))).toBeCloseTo(2 / 6, 12);
    expect(riceCut(2, job, at(61) + 15_000)).toBeCloseTo(4 / 6, 12);
    expect(riceCut(2, job, at(61) + 60_000)).toBe(1);
    const cut = plotLook(5, crop({ parts: 2 }), nep, at(62))!;
    expect(cut.cut).toBeCloseTo(2 / 6, 12);
    expect(lookKey(cut)).toBe(`rice|${cut.stage}|${Math.floor(cut.progress * 5)}|2||0|4|0`);
    const d: PlotDraw = { no: 5, look: plotLook(5, crop({ parts: 2, harvester: job }), nep, at(61)), label: "5 · Bình", urgent: false, parts: 2, harvester: job };
    expect(liveLook(d, at(61) + 15_000)?.cut).toBeCloseTo(4 / 6, 12);
    const still = { ...d, harvester: null };
    expect(liveLook(still, at(62))).toBe(still.look);
  });
  it("counts the parts and a harvester's seconds on the name post", () => {
    const d: PlotDraw = { no: 5, look: null, label: "5 · Bình", urgent: false, parts: 2, harvester: null };
    expect(postLabel(d, at(0))).toBe("5 · Bình · gặt 2/6");
    expect(postLabel({ ...d, parts: 0 }, at(0))).toBe("5 · Bình");
    const job = { startedAt: at(0), endsAt: at(0) + 30_000 };
    expect(postLabel({ ...d, harvester: job }, at(0) + 5_000)).toBe("5 · Bình · máy gặt 25s");
    expect(postLabel({ ...d, harvester: job }, at(0) + 29_500)).toBe("5 · Bình · máy gặt 1s");
    // ended on this clock: the job is hidden until the state catches up
    expect(postLabel({ ...d, harvester: job }, at(0) + 30_000)).toBe("5 · Bình");
  });
  it("draws a 32 × 20 combine in its palette, its reel on the cut line", () => {
    expect([HARVESTER_W, HARVESTER_H]).toEqual([32, 20]);
    expect(HARVESTER_ROWS).toHaveLength(HARVESTER_H);
    for (const row of HARVESTER_ROWS) {
      expect(row).toHaveLength(HARVESTER_W);
      for (const ch of row) expect(ch === "." || ch in HARVESTER_PAL, ch).toBe(true);
    }
    expect(HARVESTER_PAL).toMatchObject({ b: "#d9532b", B: "#a83a1c", g: "#9fc3cf", t: "#2a2f3a", T: "#5a5f68", r: "#f6c945" });
    expect(harvesterSpot(100, 50, 128, 76, 0.5)).toEqual({ x: 136, y: 78 });
  });
});
