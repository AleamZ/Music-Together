import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { MARKET_DEPOT_PCT, marketPrice } from "@/lib/game/market/depots";

describe("market depots (v18.5)", () => {
  it("pay 120 percent, rounded down like the SQL's integer division", () => {
    expect(MARKET_DEPOT_PCT).toBe(120);
    expect([marketPrice(37), marketPrice(5), marketPrice(100), marketPrice(0)]).toEqual([44, 6, 120, 0]);
  });
  it("mirror the constant in 0028_market_depots.sql", () => {
    const sql = readFileSync("supabase/migrations/0028_market_depots.sql", "utf8");
    expect(sql).toContain(`select (p_xu * ${MARKET_DEPOT_PCT}) / 100`);
  });
});
