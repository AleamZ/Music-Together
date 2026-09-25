import { describe, it, expect } from "vitest";
import { lookKey, plotDraws, plotLabel, plotLook } from "@/lib/game/art/crops";
import { varietyFromRow } from "@/lib/game/farm/catalog";
import { HOUR_MS } from "@/lib/game/farm/crop";
import type { CropView, PlotView } from "@/lib/game/farm/state";

const t0 = Date.parse("2026-09-25T00:00:00Z");
const at = (h: number) => t0 + h * HOUR_MS;
const nep = varietyFromRow({ id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 });
const short = varietyFromRow({ id: "short", name: "Lúa ngắn ngày", scale: 0.9, base_kg: 90, price_per_kg: 12, blast_mult: 1, sort_order: 10 });

/** Nếp on plot 5: prepared and soaked at 0 h, sown at 3 h, transplanted at 12 h unless `over` says otherwise. */
const crop = (over: Partial<CropView> = {}): CropView => ({
  variety: "nep", phase: "tillering", preparedAt: at(0), soakAt: at(0), sowAt: at(3), transplantAt: at(12), water: 2, waterSetAt: at(12),
  pests: [], excessN: false, ripe: false, rottedAt: null, log: null, ...over,
});
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
    const log = { water: [], fert: [], spray: [], picks: [], qTransplant: 0.95 };
    expect(plotLook(5, crop({ log }), nep, at(22))?.wobble).toBe(true);
  });
  it("reads the water from the farmer's log at any time, else the level fetched", () => {
    expect(plotLook(5, crop({ water: 3 }), nep, at(40))?.water).toBe(3);
    const log = { water: [{ t: at(12), l: 3 }], fert: [], spray: [], picks: [], qTransplant: 1 };
    // one level lost per 12 h: 3 at 12 h → 1 at 36 h
    expect(plotLook(5, crop({ water: 3, log }), nep, at(36))?.water).toBe(1);
  });
  it("keys the painted plot by stage, progress in fifths, water, pests and rows", () => {
    const key = (h: number) => lookKey(plotLook(5, crop(), nep, at(12 + h))!);
    expect(key(4)).toBe(key(5));
    expect(key(4)).not.toBe(key(10));
    expect(key(4)).toBe("tillering|0|2||0");
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
    const draws = plotDraws(plots, [nep], new Set([5]), at(16));
    expect(draws.map((d) => [d.no, d.look?.stage ?? null, d.label, d.urgent])).toEqual([
      [5, "tillering", "5 · đất trống", true],
      [6, null, "6 · đất trống", false],
    ]);
  });
});
