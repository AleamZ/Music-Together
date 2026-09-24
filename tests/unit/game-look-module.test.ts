import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ITEM_ART } from "@/lib/game/art/items";
import { DEFAULT_LOOK as FROM_CHARACTER } from "@/lib/game/character";
import { CHU_TU_LOOK, CO_BA_LOOK, DEFAULT_LOOK } from "@/lib/game/look";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

describe("pure look module", () => {
  it("does not depend on Supabase", () => {
    expect(readFileSync("lib/game/look.ts", "utf8")).not.toMatch(/supabase/);
  });
  it("is the DEFAULT_LOOK the character module exports", () => {
    expect(FROM_CHARACTER).toBe(DEFAULT_LOOK);
  });
  it("dresses the default look and both NPCs in items that have art", () => {
    for (const look of [DEFAULT_LOOK, CO_BA_LOOK, CHU_TU_LOOK]) {
      for (const id of [look.hat, look.top, look.bottom, look.shoes, look.neck]) {
        if (id) expect(ITEM_ART[id], id).toBeDefined();
      }
    }
  });
});
