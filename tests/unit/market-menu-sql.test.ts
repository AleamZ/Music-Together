import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { MENU } from "@/lib/game/market/menu";

describe("meal_catalog matches MENU", () => {
  it("every menu row is seeded with the same values", () => {
    const sql = readFileSync("supabase/migrations/0026_market.sql", "utf8");
    MENU.forEach((m, i) => {
      const row = `('${m.id}', '${m.name}', '${m.kind}', ${m.price}, ${m.hunger}, ${m.thirst}, ${m.fishDish}, ${i + 1})`;
      expect(sql, m.id).toContain(row);
    });
  });
});
