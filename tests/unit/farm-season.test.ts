import { describe, it, expect } from "vitest";
import { uplandFromRow, varietyFromRow, type FarmCatalog, type UplandCropRow } from "@/lib/game/farm/catalog";
import { ratFoodAt, ratSeason } from "@/lib/game/farm/season";
import { parseFieldState } from "@/lib/game/farm/state";
import fixtures from "@/tests/fixtures/upland-cases.json";

const T0 = Date.parse("2026-09-25T00:00:00Z");
const iso = (h: number) => new Date(T0 + h * 3_600_000).toISOString();
const at = (h: number) => Date.parse(iso(h));
const CATALOG: FarmCatalog = {
  varieties: [varietyFromRow({ id: "short", name: "Lúa ngắn ngày", scale: 0.9, base_kg: 90, price_per_kg: 710, blast_mult: 1, sort_order: 10 })],
  uplands: (fixtures as unknown as { crops: UplandCropRow[] }).crops.map(uplandFromRow),
  items: [],
  critters: [],
};
const plot = (no: number, crop: Record<string, unknown> | null) => ({
  no, kind: "village", owner: null, sale_price: null, sublease_price: null, farmer: null, lease: null, offers: 0, crop,
});
/** Short rice transplanted at tp hours: ripe from tp + 43.2 h. */
const rice = (tp: number, harvester: { started_at: string; ends_at: string } | null = null) => ({
  kind: "rice", variety: "short", phase: "ripe", prepared_at: iso(tp - 12), soak_at: iso(tp - 12), sow_at: iso(tp - 9),
  transplant_at: iso(tp), water: 1, harvester,
});
/** Beds planted at p hours: khoai ripe from p + 48 h, bắp from p + 60 h, ớt's first picking from p + 46 h. */
const beds = (upland: string, p: number) => ({
  kind: "upland", upland, phase: "ripe", prepared_at: iso(p - 12), sow_at: upland === "ot" ? iso(p - 11) : null, plant_at: iso(p),
  water: 1, picking: 1, pickings: upland === "ot" ? 3 : 1,
});
const RATS = { next_at: iso(50), price: 150, live: [], recent: [], plots: {} };
const state = (plots: unknown[], rats: unknown = RATS) =>
  parseFieldState({ server_now: iso(49), plots, drying: [], mine: { items: {}, rice: {}, coins: 0, gift_claimed: true }, rats })!;

describe("rat season (§11)", () => {
  it("live rats make it", () => {
    const s = state([plot(5, null)], { ...RATS, live: [{ id: 1, plot: 5, since: iso(49), seed: 1 }] });
    expect(ratSeason(s, CATALOG, s.rats!.nextAt)).toBe(true);
    expect(ratSeason(state([plot(5, null)]), CATALOG, at(50))).toBe(false);
  });
  it("a ripe or overripe rice, khoai or bắp plot at next_at makes it", () => {
    expect(ratSeason(state([plot(5, rice(6))]), CATALOG, at(50))).toBe(true);
    expect(ratSeason(state([plot(5, rice(7))]), CATALOG, at(50))).toBe(false);
    expect(ratSeason(state([plot(5, rice(-20))]), CATALOG, at(50))).toBe(true);
    expect(ratSeason(state([plot(6, beds("khoai", 2))]), CATALOG, at(50))).toBe(true);
    expect(ratSeason(state([plot(6, beds("khoai", 3))]), CATALOG, at(50))).toBe(false);
    expect(ratSeason(state([plot(6, beds("bap", -10))]), CATALOG, at(50))).toBe(true);
    expect(ratSeason(state([plot(6, beds("bap", -9))]), CATALOG, at(50))).toBe(false);
  });
  it("not ớt, not once a harvester job has started, and not before 0019", () => {
    expect(ratSeason(state([plot(7, beds("ot", 0))]), CATALOG, at(50))).toBe(false);
    const job = { started_at: iso(49.5), ends_at: iso(49.51) };
    expect(ratSeason(state([plot(5, rice(0, job))]), CATALOG, at(50))).toBe(false);
    expect(ratFoodAt(state([plot(5, rice(0, job))]).plots[0], CATALOG, at(49))).toBe(true);
    const old = state([plot(5, rice(6))], null);
    expect(old.rats).toBeNull();
    expect(ratSeason(old, CATALOG, at(50))).toBe(false);
  });
});
