import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { MARKET_DEPOT_LABEL, MARKET_DEPOT_PCT, marketPrice } from "@/lib/game/market/depots";

describe("market depots (v18.5)", () => {
  it("pay 110 percent (econ v2), rounded down like the SQL's integer division", () => {
    expect(MARKET_DEPOT_PCT).toBe(110);
    expect(MARKET_DEPOT_LABEL).toBe("+10%");
    expect([marketPrice(37), marketPrice(5), marketPrice(100), marketPrice(0)]).toEqual([40, 5, 110, 0]);
  });
  it("mirror the constant in 0100_econ_core.sql", () => {
    const sql = readFileSync("supabase/migrations/0100_econ_core.sql", "utf8");
    expect(sql).toContain(`select (p_xu * ${MARKET_DEPOT_PCT}) / 100`);
  });
});
