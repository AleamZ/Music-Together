import { describe, it, expect } from "vitest";
import { farmItemFromRow } from "@/lib/game/farm/catalog";
import {
  BED_BAR_MS, BED_COUNT, CRAB_FINISH_WAIT_MS, critterCap, critterCount, critterPrice, GATHER, heldBox, HOLE_COUNT, spotId, spotKey,
  TRANSPLANT_WAIT_MS,
} from "@/lib/game/farm/gather";
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
