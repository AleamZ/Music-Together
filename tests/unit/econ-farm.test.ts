import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sortBonus } from "@/lib/game/craftmg/games";
import { FARM_LIMIT, landNet, OWN_LIMIT, SALE_MAX, SALE_MIN, SUBLEASE_MAX } from "@/lib/game/farm/catalog";
import { MACHINES } from "@/lib/game/fishing/extras";

// 0102_econ_farm.sql (econ v2, the farm) against the TS that mirrors it.
const SQL = readFileSync("supabase/migrations/0102_econ_farm.sql", "utf8").replace(/\r\n/g, "\n");
/** The body of a function 0102 re-creates, from its create statement to the next one. */
const body = (name: string): string => {
  const i = SQL.indexOf(`function public.${name}(`);
  expect(i, name).toBeGreaterThan(0);
  const j = SQL.indexOf("create or replace function", i);
  return SQL.slice(i, j < 0 ? undefined : j);
};

describe("0102 is the client's (econ v2, the farm)", () => {
  it("the sale band and the sublease cap: the checks and the list / offer / sublease functions", () => {
    expect([SALE_MIN, SALE_MAX, SUBLEASE_MAX]).toEqual([400_000, 2_400_000, 50_000]);
    expect(SQL).toContain(`field_plots_sale_price_check check (sale_price between ${SALE_MIN} and ${SALE_MAX})`);
    expect(SQL).toContain(`land_offers_price_check check (price between ${SALE_MIN} and ${SALE_MAX})`);
    expect(SQL).toContain(`field_plots_sublease_price_check check (sublease_price between 1 and ${SUBLEASE_MAX})`);
    expect(body("_farm_do_list")).toContain(`p_price < ${SALE_MIN} or p_price > ${SALE_MAX}`);
    expect(body("_farm_do_offer")).toContain(`p_price < ${SALE_MIN} or p_price > ${SALE_MAX}`);
    expect(body("_farm_do_set_sublease")).toContain(`p_price < 1 or p_price > ${SUBLEASE_MAX}`);
  });
  it("the seller's and the owner's share: floor(price × (100 − p2p_fee_pct) / 100), 5 % by default", () => {
    for (const fn of ["_land_sale", "_farm_do_rent_sublease"]) {
      expect(body(fn)).toContain("coalesce(public._econ_param('p2p_fee_pct'), 5)");
    }
    expect(body("_land_sale")).toContain("floor(p_price * (100 - v_fee) / 100)::integer, 'land_sell'");
    expect(body("_farm_do_rent_sublease")).toContain("floor(f.sublease_price * (100 - v_fee) / 100)::integer, 'lease_income'");
    expect([landNet(1_000_000, 5), landNet(777_777, 10), landNet(50_000, 5), landNet(400_001, 5), landNet(9, 0)])
      .toEqual([950_000, 699_999, 47_500, 380_000, 9]);
  });
  it("the caps count every room: 2 farmed plots, 1 private plot", () => {
    expect([FARM_LIMIT, OWN_LIMIT]).toEqual([2, 1]);
    expect(body("_farm_count")).not.toContain("fp.room_id = p_room");
    expect(body("_farm_count")).toContain("public._farmer(fp.room_id, fp.plot_no, p_now) = p_account");
    expect(body("_owns_land")).not.toContain("fp.room_id = p_room");
    expect(body("_field_view")).toContain("'farm_total', public._farm_count(p_room, p_viewer, p_now)");
    expect(body("_field_view")).toContain("'owns_land', public._owns_land(p_room, p_viewer)");
  });
  it("the processor's price, its recipes at ≈ 1.15× the field price, and the sort bonus", () => {
    const m = MACHINES.find((x) => x.id === "processor")!;
    expect(m.price).toBe(50_000);
    expect(body("_machine_price")).toContain(`when 'processor' then ${m.price}`);
    const values = Object.fromEntries([...SQL.matchAll(/\('(\w+)', (\d+)\)/g)].map((x) => [x[1], Number(x[2])]));
    // input: 10 kg dry rice (710 / 950 / 1 350 xu/kg), 10 kg khoai / bắp (265 / 460), 5 kg ớt (1 590)
    const field: Record<string, number> = { gao_trang: 7100, banh_tet: 9500, gao_thom: 13500, khoai_say: 2650, bot_bap: 4600, tuong_ot: 7950 };
    expect(values).toMatchObject({ gao_trang: 8150, banh_tet: 10900, gao_thom: 15500, khoai_say: 3050, bot_bap: 5300, tuong_ot: 9150 });
    for (const [id, v] of Object.entries(field)) {
      expect(values[id] / v, id).toBeGreaterThan(1.13);
      expect(values[id] / v, id).toBeLessThan(1.16);
    }
    expect(body("_sort_bonus")).toContain("when p_score >= 11 then 2 when p_score >= 8 then 1 else 0");
    expect([7, 8, 10, 11].map(sortBonus)).toEqual([0, 1, 1, 2]);
  });
  it("crop_harvest when a plot's crop is in: the sixth part, the harvester's job, the last picking", () => {
    for (const fn of ["_farm_do_harvest_part", "_farm_do_harvest", "_field_sweep"]) {
      expect(body(fn), fn).toMatch(/_game_event\([a-z_.]+, 'crop_harvest', 1,/);
    }
  });
  it("the thương lái buys the crabs, snails and rats", () => {
    for (const fn of ["sell_critters", "_rat_do_sell"]) {
      expect(body(fn), fn).toMatch(/v_pay := public\._npc_sale\(\w+, v_xu\)/);
      expect(body(fn), fn).toContain("'npc_cut', v_xu - v_pay");
    }
    expect(body("_farm_mine")).toContain("'npc', public._npc_quota(p_account)");
  });
});
