import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FISH_ICONS } from "@/lib/game/art/fish";
import { GEAR_ICONS } from "@/lib/game/art/gear";
import { ICON_SIZE, iconMatrixFor, pixelIconMatrix, type PixelIcon } from "@/lib/game/art/icons";
import { OUTLINE } from "@/lib/game/art/palettes";

const sql = readFileSync("supabase/migrations/0012_v14_fishing.sql", "utf8");
/** v18.2: chú Tư's new stock (rods, nets, bait_gold). */
const sql34 = readFileSync("supabase/migrations/0034_rods_nets.sql", "utf8");
/** Hotfix: Bộ câu cá (bait_box_100, bucket_100, fishing_kit). */
const sql98 = readFileSync("supabase/migrations/0098_fishing_kit.sql", "utf8");
/** Câu cá v3: the parts, groundbait, notebook, new buckets and nets, and four species. */
const sql110 = readFileSync("supabase/migrations/0110_fishing_v3.sql", "utf8");
/** Ids seeded by `insert into public.<table> … on conflict`. */
const seededIds = (table: string, src = sql): string[] => {
  const start = src.indexOf(`insert into public.${table}`);
  if (start < 0) return [];
  const block = src.slice(start, src.indexOf("on conflict", start));
  return [...block.matchAll(/^\s*\('([a-z0-9_]+)',/gm)].map((m) => m[1]);
};

describe("fish and gear icons", () => {
  const all: Array<[string, PixelIcon]> = [...Object.entries(FISH_ICONS), ...Object.entries(GEAR_ICONS)];
  it("are 16×16 and only use '.', 'o' and their own palette", () => {
    for (const [id, icon] of all) {
      expect(icon.rows, id).toHaveLength(ICON_SIZE);
      for (const row of icon.rows) {
        expect(row, id).toHaveLength(ICON_SIZE);
        for (const ch of row) expect(ch === "." || ch === "o" || ch in icon.pal, `${id}: ${ch}`).toBe(true);
      }
    }
  });
  it("cover every seeded species and shop item", () => {
    const species = [sql, readFileSync("supabase/migrations/0076_fishing_extras.sql", "utf8"),
      readFileSync("supabase/migrations/0086_explore_minigames.sql", "utf8"), sql110].flatMap((src) => seededIds("fish_species", src));
    expect(species.sort()).toEqual(Object.keys(FISH_ICONS).sort());
    expect([...seededIds("shop_items"), ...seededIds("shop_items", sql34), ...seededIds("shop_items", sql98), ...seededIds("shop_items", sql110)]
      .sort()).toEqual(Object.keys(GEAR_ICONS).sort());
  });
  it("map codes to colours", () => {
    const m = pixelIconMatrix({ rows: Array(16).fill(".o" + "b".repeat(14)), pal: { b: "#123456" } });
    expect(m[0].slice(0, 3)).toEqual(["", OUTLINE, "#123456"]);
  });
  it("resolve any item id — clothes, fish, gear — and nothing else", () => {
    expect(iconMatrixFor("hat_nonla")).toHaveLength(16);
    expect(iconMatrixFor("ca_ho")).toHaveLength(16);
    expect(iconMatrixFor("rod_carbon")?.[0]).toHaveLength(16);
    expect(iconMatrixFor("nope")).toBeNull();
  });
  it("give every species its own silhouette", () => {
    // Occupied-pixel masks (a cell is occupied unless it is ".") must differ in at least 6 cells for every pair.
    const mask = (icon: PixelIcon) => [...icon.rows.join("")].map((ch) => ch !== ".");
    const fish = Object.entries(FISH_ICONS).map(([id, icon]) => [id, mask(icon)] as const);
    const tooClose: string[] = [];
    fish.forEach(([a, ma], i) => {
      for (const [b, mb] of fish.slice(i + 1)) {
        const diff = ma.filter((occupied, k) => occupied !== mb[k]).length;
        if (diff < 6) tooClose.push(`${a} ~ ${b}: ${diff} cells`);
      }
    });
    expect(tooClose).toEqual([]);
  });
});
