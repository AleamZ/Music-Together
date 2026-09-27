import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BIG_SALE, BUILD_APPRAISE_PERCENT, ESTATE_FEE_PERCENT, ESTATE_MAX_PERCENT, ESTATE_MIN_PERCENT, FLAG_DAYS, LISTING_DAYS,
  RELIST_COOLDOWN_HOURS, ROUND_TRIP_DAYS, SALES_SHOWN,
} from "@/lib/game/housing/estate";

const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const SQL = read("supabase/migrations/0043_real_estate.sql");
const HOUSES = read("supabase/migrations/0042_houses.sql");

const body = (s: string, name: string) => {
  const from = s.indexOf(`create or replace function public.${name}(`);
  expect(from, name).toBeGreaterThanOrEqual(0);
  return s.slice(from, s.indexOf("$$;", from) + 3);
};
const lines = (s: string) => s.split("\n");

describe("v19.4 real estate: the TS rules mirror 0043", () => {
  it("fee, band, appraisal, times", () => {
    expect(SQL).toContain(`when 'fee' then ${ESTATE_FEE_PERCENT} when 'min' then ${ESTATE_MIN_PERCENT} when 'max' then ${ESTATE_MAX_PERCENT} when 'build' then ${BUILD_APPRAISE_PERCENT} when 'big' then ${BIG_SALE} end`);
    expect(SQL).toContain(`now() + interval '${LISTING_DAYS} days'`);
    expect(SQL).toContain(`now() + interval '${RELIST_COOLDOWN_HOURS} hours'`);
    expect(SQL).toContain(`x.expires_at + interval '${RELIST_COOLDOWN_HOURS} hours'`);
    expect(SQL).toContain(`s.sold_at > now() - interval '${ROUND_TRIP_DAYS} days'`);
    expect(SQL).toContain(`s.sold_at > now() - interval '${FLAG_DAYS} days'`);
    expect(SQL).toContain(`order by sold_at desc, id desc limit ${SALES_SHOWN}) s`);
    expect(SQL).toContain("(p_app * public._estate_rule('min') + 99) / 100");
    expect(SQL).toContain("p_app * public._estate_rule('max') / 100");
  });

  it("the ledger keeps 0042's reasons and adds the estate ones", () => {
    const reasons = (s: string) => {
      const from = s.lastIndexOf("check (reason in (");
      return [...s.slice(from, s.indexOf("));", from)).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    };
    expect(reasons(SQL)).toEqual([...reasons(HOUSES), "estate_sale", "estate_buy"]);
  });

  it("_ac_wipe is 0042's plus the v19.4 line", () => {
    const keep = (s: string) => lines(body(s, "_ac_wipe")).filter((l) => !l.includes("v19.4")).join("\n");
    expect(keep(SQL)).toBe(keep(HOUSES));
    expect(lines(body(SQL, "_ac_wipe")).filter((l) => l.includes("v19.4"))).toEqual([
      expect.stringContaining("perform public._estate_wipe(p_account);"),
    ]);
  });

  it("every RPC is granted and takes the session token", () => {
    for (const sig of ["estate_state(text)", "estate_list(text, text, integer, boolean)", "estate_cancel(text)", "estate_buy(text, bigint, integer)", "admin_estate_flags(text)"]) {
      expect(SQL).toContain(`grant execute on function public.${sig} to anon, authenticated;`);
    }
    for (const fn of ["estate_state", "estate_list", "estate_cancel", "estate_buy"]) expect(body(SQL, fn)).toContain("public._auth_account(p_session_token)");
    expect(body(SQL, "admin_estate_flags")).toContain("public._auth_root(p_session_token)");
  });
});
