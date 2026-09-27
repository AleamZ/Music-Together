import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { VEHICLES } from "@/lib/game/travel/vehicles";

describe("vehicle_catalog matches VEHICLES", () => {
  it("seeds every vehicle with the same values", () => {
    const sql = readFileSync("supabase/migrations/0027_vehicles.sql", "utf8");
    VEHICLES.forEach((v, i) => expect(sql, v.id).toContain(`('${v.id}', '${v.name}', ${v.price}, ${v.tripMs}, ${i + 1})`));
  });
});
