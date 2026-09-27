import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CELL_COUNT, HOUSE_MAX_ITEMS, HOUSE_MAX_ROOMS, LAND_PRICE, LAND_REFUND_SHARE, LOT_COLS, LOT_COUNT, LOT_ROWS, RENT_OWNER_PERCENT, REPOSSESS_DAYS,
  ROOFS, ROOM_MAX_AHEAD_DAYS, ROOM_MIN_CELLS, ROOM_RENT_DAYS, ROOM_RENT_MAX, ROOM_RENT_MIN, TILE_PRICES, UPKEEP, UPKEEP_DAYS, UPKEEP_MAX_AHEAD_DAYS,
} from "@/lib/game/housing/house";

const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const SQL = read("supabase/migrations/0042_houses.sql");
const APT = read("supabase/migrations/0041_apartments.sql");

/** A function's text, from its `create or replace` to its closing `$$;`. */
const body = (s: string, name: string) => {
  const from = s.indexOf(`create or replace function public.${name}(`);
  expect(from, name).toBeGreaterThanOrEqual(0);
  return s.slice(from, s.indexOf("$$;", from) + 3);
};
const lines = (s: string) => s.split("\n");

describe("v19.3 houses: the TS rules mirror 0042", () => {
  it("prices, lengths, caps and the grid", () => {
    expect(SQL).toContain(`when 'land' then ${LAND_PRICE} when 'upkeep' then ${UPKEEP} when 'refund' then ${LAND_PRICE * LAND_REFUND_SHARE} end`);
    expect(SQL).toContain(`when 'f' then ${TILE_PRICES.f} when 'w' then ${TILE_PRICES.w} when 'd' then ${TILE_PRICES.d} when 'n' then ${TILE_PRICES.n} else 0 end`);
    expect(SQL).toContain(`check (no between 1 and ${LOT_COUNT})`);
    expect(SQL).toContain(`length(grid) = ${CELL_COUNT}`);
    expect(SQL).toContain(`p_x + p_w > ${LOT_COLS} or p_y + p_h > ${LOT_ROWS}`);
    expect(SQL).toContain(`paid_until = now() + interval '${UPKEEP_DAYS} days'`);
    expect(SQL).toContain(`greatest(now(), l.paid_until) + interval '${UPKEEP_DAYS} days'`);
    expect(SQL).toContain(`v_until > now() + interval '${UPKEEP_MAX_AHEAD_DAYS} days'`);
    expect(SQL).toContain(`paid_until + interval '${REPOSSESS_DAYS} days' <= now()`);
    expect(SQL).toContain(`coalesce(t.paid_until, now())) + interval '${ROOM_RENT_DAYS} days'`);
    expect(ROOM_MAX_AHEAD_DAYS).toBe(UPKEEP_MAX_AHEAD_DAYS);
    expect(SQL).toContain(`check (price between ${ROOM_RENT_MIN} and ${ROOM_RENT_MAX})`);
    expect(SQL).toContain(`p_price not between ${ROOM_RENT_MIN} and ${ROOM_RENT_MAX}`);
    expect(SQL).toContain(`(v_price * ${RENT_OWNER_PERCENT}) / 100`);
    expect(SQL).toContain(`if n > ${HOUSE_MAX_ROOMS} then`);
    expect(SQL).toContain(`where x = k) < ${ROOM_MIN_CELLS}) then`);
    expect(SQL).toContain(`where lot_no = l.no) >= ${HOUSE_MAX_ITEMS} then`);
    const roofs = `(${ROOFS.map((r) => `'${r.id}'`).join(",")})`;
    expect(SQL).toContain(`check (roof in ${roofs})`);
    expect(SQL).toContain(`p_roof not in ${roofs}`);
  });

  it("the ledger keeps 0041's reasons and adds the house ones", () => {
    const reasons = (s: string) => {
      const from = s.lastIndexOf("check (reason in (");
      return [...s.slice(from, s.indexOf("));", from)).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    };
    expect(reasons(SQL)).toEqual([
      ...reasons(APT), "house_land", "house_upkeep", "house_build", "house_refund", "house_rent_pay", "house_rent_income",
    ]);
  });

  it("_ac_wipe is 0041's plus the v19.3 line", () => {
    const keep = (s: string) => lines(body(s, "_ac_wipe")).filter((l) => !l.includes("v19.3")).join("\n");
    expect(keep(SQL)).toBe(keep(APT));
    expect(lines(body(SQL, "_ac_wipe")).filter((l) => l.includes("v19.3"))).toHaveLength(1);
  });

  it("the functions re-created from 0041 are 0041's plus (or with) the v19.3 lines", () => {
    // the 0041 lines the v19.3 lines replace (the rest only adds lines)
    const replaced = new Set([
      "                           from public.furniture_items f where f.account_id = p_account and f.apt_no is null), '[]'::jsonb),",
      "  perform public._apt_need_home(v_account);",
    ]);
    const added: Record<string, number> = {
      _apt_list_json: 1, apt_rent: 2, apt_buy: 2, _fridge_cap: 1, fish_move_to_fridge: 1, fish_move_to_bag: 1, home_sleep: 1,
    };
    for (const [name, n] of Object.entries(added)) {
      const mine = lines(body(SQL, name));
      expect(mine.filter((l) => l.includes("v19.3")), name).toHaveLength(n);
      expect(mine.filter((l) => !l.includes("v19.3")).join("\n"), name)
        .toBe(lines(body(APT, name)).filter((l) => !replaced.has(l)).join("\n"));
    }
  });
});
