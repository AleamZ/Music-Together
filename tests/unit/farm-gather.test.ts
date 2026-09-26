import { describe, it, expect } from "vitest";
import { critterFromRow, farmItemFromRow, type FarmCatalog } from "@/lib/game/farm/catalog";
import {
  BED_BAR_MS, BED_COUNT, CRAB_FINISH_WAIT_MS, critterCap, critterCount, critterPrice, GATHER, gatherPrompt, heldBox, HOLE_COUNT,
  minutesLeft, spotId, spotKey, spotState, TRANSPLANT_WAIT_MS,
} from "@/lib/game/farm/gather";
import type { FarmMine } from "@/lib/game/farm/state";
import type { Interactable } from "@/lib/game/maps/types";
import fixture from "@/tests/fixtures/gather-cases.json";

const F = fixture as unknown as {
  rules: {
    hand: number; boxes: number[]; cooldown_s: number; daily_visits: number; crab_gate_s: number; visit_window_s: number;
    transplant_gate_s: number; work_window_s: number; cua_gach_odds: number; oc_dong_odds: number; bed_snails: number[];
  };
  prices: [number, number, number][];
  spots: [string, string][];
};
const box = (id: string, capacity: number) => farmItemFromRow({
  id, kind: "critter_box", name: id, price: 1, sort_order: 0, variety: null, fert: null, pest_target: null, capacity,
});
const BOXES = [box("box_bucket", 15), box("box_basket", 30)];

describe("the gathering rules (0018; tests/fixtures/gather-cases.json)", () => {
  it("are the server's", () => {
    const r = F.rules;
    expect(GATHER).toEqual({
      hand: r.hand, cooldownMs: r.cooldown_s * 1000, dailyVisits: r.daily_visits, crabGateMs: r.crab_gate_s * 1000,
      visitWindowMs: r.visit_window_s * 1000, transplantGateMs: r.transplant_gate_s * 1000, workWindowMs: r.work_window_s * 1000,
      cuaGachOdds: r.cua_gach_odds, ocDongOdds: r.oc_dong_odds, bedSnails: r.bed_snails,
    });
    expect(BOXES.map((b) => b.capacity)).toEqual(r.boxes);
    expect([HOLE_COUNT, BED_COUNT]).toEqual([6, 4]);
  });
  it("waits past the server's gates (R7, §8.1)", () => {
    expect(CRAB_FINISH_WAIT_MS).toBe(4000);
    expect(CRAB_FINISH_WAIT_MS).toBeGreaterThan(GATHER.crabGateMs);
    expect(TRANSPLANT_WAIT_MS).toBe(9000);
    expect(TRANSPLANT_WAIT_MS).toBeGreaterThan(GATHER.transplantGateMs);
    expect(BED_BAR_MS).toBe(3000);
  });
});

describe("critterPrice (R4)", () => {
  it("floors base × M in whole hundredths, as the server does", () => {
    for (const [base, mult, price] of F.prices) expect(critterPrice(base, mult), `${base} × ${mult}`).toBe(price);
    // the float product falls just short: floor(45 × 1.4) would pay 62
    expect(Math.floor(45 * 1.4)).toBe(62);
    expect(critterPrice(45, 1.4)).toBe(63);
  });
  it("pays at least 1 xu", () => {
    expect(critterPrice(2, 0.3)).toBe(1);
  });
});

describe("the spot keys (§6)", () => {
  it("map each interactable to the server's key and back", () => {
    for (const [id, key] of F.spots) {
      expect(spotKey(id)).toBe(key);
      expect(spotId(key)).toBe(id);
    }
  });
  it("know only holes 1–6 and beds 1–4", () => {
    expect(["crab_0", "crab_7", "bed_5", "plot_1", "crab1", "crab_10"].map(spotKey)).toEqual([null, null, null, null, null, null]);
    expect(["crab7", "bed0", "crab_1", "bed"].map(spotId)).toEqual([null, null, null, null]);
  });
});

describe("the capacity (R5)", () => {
  it("is 3 by hand plus the largest container", () => {
    expect(critterCap({}, BOXES)).toBe(3);
    expect(critterCap({ box_bucket: 1 }, BOXES)).toBe(18);
    expect(critterCap({ box_basket: 1 }, BOXES)).toBe(33);
    expect(critterCap({ box_bucket: 1, box_basket: 1 }, BOXES)).toBe(33);
    expect(critterCap({ box_basket: 0 }, BOXES)).toBe(3);
  });
  it("names the container held, and counts the critters", () => {
    expect(heldBox({}, BOXES)).toBeNull();
    expect(heldBox({ box_bucket: 1 }, BOXES)?.id).toBe("box_bucket");
    expect(heldBox({ box_bucket: 1, box_basket: 1 }, BOXES)?.id).toBe("box_basket");
    expect(critterCount({})).toBe(0);
    expect(critterCount({ cua_dong: { n: 5 }, oc_dong: { n: 2 } })).toBe(7);
  });
});

describe("the field prompts (§13.1)", () => {
  const NOW = Date.parse("2026-09-26T10:00:00Z");
  const spot = (id: string, kind: "crab_hole" | "snail_bed", n: number): Interactable => ({
    id, kind, label: "", prompt: "", rect: { x: 0, y: 0, w: 1, h: 1 }, use: { x: 0, y: 0 }, spot: n,
  });
  const HOLE = spot("crab_3", "crab_hole", 3);
  const BED = spot("bed_2", "snail_bed", 2);
  const named = (id: string, name: string, capacity: number) => farmItemFromRow({
    id, kind: "critter_box", name, price: 1, sort_order: 0, variety: null, fert: null, pest_target: null, capacity,
  });
  const CATALOG: FarmCatalog = {
    varieties: [], uplands: [], items: [named("box_bucket", "Xô nhựa", 15), named("box_basket", "Giỏ tre", 30)],
    critters: [critterFromRow({ id: "cua_dong", name: "Cua đồng", grp: "crab", base_price: 12, sort_order: 10 })],
  };
  const mine = (over: Partial<FarmMine> = {}): FarmMine => ({
    items: {}, rice: {}, coins: 0, giftClaimed: true, produce: {}, tank: null, critters: {}, critterCap: 3,
    gather: { readyAt: {}, leftToday: 200, dayResetsAt: null }, ...over,
  });
  const prompt = (it: Interactable, m: FarmMine, c: FarmCatalog = CATALOG) => gatherPrompt(it, m, c, NOW);
  const cooling = (key: string, ms: number) => ({ readyAt: { [key]: NOW + ms }, leftToday: 150, dayResetsAt: null });
  const LIMIT = { readyAt: {}, leftToday: 0, dayResetsAt: NOW + 3_600_000 };
  const FULL = { critters: { cua_dong: { n: 3, xu: 36 } } };

  it("reads E at a ready spot", () => {
    expect(prompt(HOLE, mine())).toBe("Bắt cua hang 3");
    expect(prompt(BED, mine())).toBe("Mò ốc bãi 2");
    expect(spotState(HOLE, mine(), CATALOG, NOW)).toEqual({ kind: "ready" });
  });
  it("counts a cooldown in whole minutes on the server clock, ready at its end", () => {
    expect(prompt(HOLE, mine({ gather: cooling("crab3", 11.5 * 60_000) }))).toBe("Hang 3 · cua chưa ra (còn 12 phút)");
    expect(prompt(BED, mine({ gather: cooling("bed2", 7 * 60_000) }))).toBe("Bãi 2 · còn 7 phút");
    expect(prompt(HOLE, mine({ gather: cooling("crab3", 1_000) }))).toBe("Hang 3 · cua chưa ra (còn 1 phút)");
    expect(prompt(HOLE, mine({ gather: cooling("crab3", 0) }))).toBe("Bắt cua hang 3");
    expect(prompt(HOLE, mine({ gather: cooling("crab4", 60_000) }))).toBe("Bắt cua hang 3");
    expect(spotState(HOLE, mine({ gather: cooling("crab3", 60_000) }), CATALOG, NOW)).toEqual({ kind: "cooling", readyAt: NOW + 60_000 });
    expect([1, 60_000, 60_001].map(minutesLeft)).toEqual([1, 1, 2]);
  });
  it("names the full container, or the hands", () => {
    expect(prompt(HOLE, mine(FULL))).toBe("Hang 3 · tay đầy — bán ở vựa cô Út");
    expect(prompt(BED, mine({ items: { box_bucket: 1 }, critterCap: 18, critters: { cua_dong: { n: 18, xu: 216 } } })))
      .toBe("Bãi 2 · xô nhựa đầy — bán ở vựa cô Út");
    expect(prompt(HOLE, mine({ items: { box_basket: 1 }, critterCap: 33, critters: { cua_dong: { n: 33, xu: 396 } } })))
      .toBe("Hang 3 · giỏ tre đầy — bán ở vựa cô Út");
    expect(spotState(HOLE, mine(FULL), CATALOG, NOW)).toEqual({ kind: "full", box: null });
    expect(spotState(BED, mine({ items: { box_bucket: 1 }, critterCap: 18, critters: { cua_dong: { n: 18, xu: 216 } } }), CATALOG, NOW))
      .toMatchObject({ kind: "full", box: { id: "box_bucket", name: "Xô nhựa" } });
  });
  it("shows the server's first refusal: the daily limit, then full, then the cooldown", () => {
    const all = mine({ ...FULL, gather: { ...LIMIT, readyAt: { crab3: NOW + 60_000 } } });
    expect(prompt(HOLE, all)).toBe("Hết lượt bắt cua, mò ốc hôm nay");
    expect(prompt(HOLE, mine({ ...FULL, gather: cooling("crab3", 60_000) }))).toBe("Hang 3 · tay đầy — bán ở vựa cô Út");
    // the Vietnam day turned since the answer: no longer at the limit
    expect(gatherPrompt(HOLE, mine({ gather: LIMIT }), CATALOG, NOW + 3_600_000)).toBe("Bắt cua hang 3");
  });
  it("shows every spot ready before 0018 (no critter kinds)", () => {
    const before = { ...CATALOG, critters: [] };
    expect(prompt(HOLE, mine({ ...FULL, gather: LIMIT }), before)).toBe("Bắt cua hang 3");
    expect(prompt(BED, mine({ gather: cooling("bed2", 60_000) }), before)).toBe("Mò ốc bãi 2");
    expect(gatherPrompt(HOLE, null, null, NOW)).toBe("Bắt cua hang 3");
  });
});
