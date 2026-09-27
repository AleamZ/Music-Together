import { describe, it, expect } from "vitest";
import { marketErrorMessage } from "@/lib/game/market/rpc";

describe("market errors", () => {
  it("maps server errors to Vietnamese", () => {
    expect(marketErrorMessage("insufficient funds")).toMatch(/xu/);
    expect(marketErrorMessage("fish not found")).toMatch(/cá/);
    expect(marketErrorMessage("not a fish dish")).toMatch(/cá/);
    expect(marketErrorMessage("unknown meal")).toMatch(/món/);
    expect(marketErrorMessage("boom")).toBe("Không gọi món được, thử lại nhé.");
  });
});
