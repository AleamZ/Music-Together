import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  APT_BUY, APT_COLS, APT_COUNT, APT_GRACE_DAYS, APT_GUEST_HOURS, APT_MAX_AHEAD_DAYS, APT_MAX_ITEMS, APT_RENT, APT_RENT_DAYS, APT_ROWS,
  APT_SELL_SHARE, APT_WALL_ROWS, FURNITURE, TV_MAX_QUEUE,
} from "@/lib/game/housing/apartment";

const SQL = readFileSync("supabase/migrations/0041_apartments.sql", "utf8").replace(/\r\n/g, "\n");
const MOTEL = readFileSync("supabase/migrations/0039_motel.sql", "utf8").replace(/\r\n/g, "\n");
const RATS = readFileSync("supabase/migrations/0019_v17_rats.sql", "utf8").replace(/\r\n/g, "\n");

describe("v19.2 apartments: the TS rules mirror 0041", () => {
  it("prices, lengths, caps and the grid", () => {
    expect(SQL).toContain(`when 'rent' then ${APT_RENT} when 'buy' then ${APT_BUY} when 'sell' then ${APT_BUY * APT_SELL_SHARE} end`);
    expect(SQL).toContain(`+ interval '${APT_RENT_DAYS} days'`);
    expect(SQL).toContain(`now() + interval '${APT_MAX_AHEAD_DAYS} days'`);
    expect(SQL).toContain(`paid_until + interval '${APT_GRACE_DAYS} days' <= now()`);
    expect(SQL).toContain(`now() + interval '${APT_GUEST_HOURS} hours'`);
    expect(SQL).toContain(`check (no between 1 and ${APT_COUNT})`);
    expect(SQL).toContain(`>= ${APT_MAX_ITEMS} then`);
    expect(SQL).toContain(`jsonb_array_length(t.queue) >= ${TV_MAX_QUEUE}`);
    expect(SQL).toContain(`p_y < ${APT_WALL_ROWS} or p_x + v_w > ${APT_COLS} or p_y + v_h > ${APT_ROWS}`);
  });
  it("the catalogue rows are the TS catalogue", () => {
    const rows = [...SQL.matchAll(/\('([a-z_]+)', '([^']+)', '([a-z]+)', '([a-z_]+)', (\d), (\d), (\d+), (\d+)\)/g)].map((m) => ({
      id: m[1], name: m[2], kind: m[3], style: m[4], w: Number(m[5]), h: Number(m[6]), price: Number(m[7]), cap: Number(m[8]),
    }));
    expect(rows).toEqual(FURNITURE.map((f) => ({ ...f, cap: f.cap ?? 0 })));
  });
  it("the ledger keeps 0039's reasons and adds the housing ones", () => {
    const reasons = (s: string) => {
      const from = s.lastIndexOf("check (reason in (");
      return [...s.slice(from, s.indexOf("));", from)).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    };
    expect(reasons(SQL)).toEqual([...reasons(MOTEL), "apartment", "apartment_sell", "furniture"]);
  });
  it("_ac_wipe is 0019's plus the v19.2 lines", () => {
    const body = (s: string) => {
      const from = s.indexOf("create or replace function public._ac_wipe");
      return s.slice(from, s.indexOf("end $$;", from) + 7);
    };
    const keep = (s: string) => body(s).split("\n").filter((l) => !l.includes("v19.2")).join("\n").trim();
    expect(keep(SQL)).toBe(keep(RATS));
    expect(body(SQL).split("\n").filter((l) => l.includes("v19.2"))).toHaveLength(4);
  });
});
