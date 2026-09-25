import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FARM_ICONS } from "@/lib/game/art/farm-icons";
import { ICON_SIZE, iconMatrixFor } from "@/lib/game/art/icons";

const sql = readFileSync("supabase/migrations/0013_v15_field.sql", "utf8");
/** The farm items seeded by `insert into public.shop_items … on conflict`. */
const seededItems = (): string[] => {
  const start = sql.indexOf("insert into public.shop_items");
  const block = sql.slice(start, sql.indexOf("on conflict", start));
  return [...block.matchAll(/^\s*\('([a-z_]+)',/gm)].map((m) => m[1]);
};

describe("farm icons", () => {
  it("are 16×16 and only use '.', 'o' and their own palette", () => {
    for (const [id, icon] of Object.entries(FARM_ICONS)) {
      expect(icon.rows, id).toHaveLength(ICON_SIZE);
      for (const row of icon.rows) {
        expect(row, id).toHaveLength(ICON_SIZE);
        for (const ch of row) expect(ch === "." || ch === "o" || ch in icon.pal, `${id}: ${ch}`).toBe(true);
      }
    }
  });
  it("cover every seeded farm item and the two rice sacks", () => {
    expect(Object.keys(FARM_ICONS).sort()).toEqual([...seededItems(), "rice_dry", "rice_wet"].sort());
  });
  it("resolve through iconMatrixFor", () => {
    expect(iconMatrixFor("seed_thom")).toHaveLength(16);
    expect(iconMatrixFor("fert_npk")?.[5]).toHaveLength(16);
    expect(iconMatrixFor("rice_dry")).not.toBeNull();
  });
  it("tell every item apart", () => {
    const looks = Object.keys(FARM_ICONS).map((id) => JSON.stringify(iconMatrixFor(id)));
    expect(new Set(looks).size).toBe(looks.length);
  });
});
