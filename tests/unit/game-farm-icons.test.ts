import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FARM_ICONS } from "@/lib/game/art/farm-icons";
import { ICON_SIZE, iconMatrixFor } from "@/lib/game/art/icons";

/** The ids seeded by `insert into public.<table> … on conflict` in a migration. */
const seeded = (file: string, table: string): string[] => {
  const sql = readFileSync(`supabase/migrations/${file}`, "utf8");
  const start = sql.indexOf(`insert into public.${table}`);
  const block = sql.slice(start, sql.indexOf("on conflict", start));
  return [...block.matchAll(/^\s*\('([a-z_]+)',/gm)].map((m) => m[1]);
};
const seededItems = (): string[] => [
  ...seeded("0013_v15_field.sql", "shop_items"), ...seeded("0016_v15_2_crops.sql", "shop_items"), ...seeded("0018_v15_3_gather.sql", "shop_items"),
];

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
  it("cover every seeded farm item, the two rice sacks, each hoa-màu crop's produce and each critter kind", () => {
    const produce = seeded("0016_v15_2_crops.sql", "upland_crops").map((u) => `produce_${u}`);
    expect(produce).toEqual(["produce_khoai", "produce_bap", "produce_ot"]);
    const critters = seeded("0018_v15_3_gather.sql", "critter_kinds");
    expect(critters).toEqual(["cua_dong", "cua_gach", "oc_dong", "oc_buou_vang"]);
    expect(seeded("0018_v15_3_gather.sql", "shop_items")).toEqual(["box_bucket", "box_basket"]);
    expect(Object.keys(FARM_ICONS).sort()).toEqual([...seededItems(), "rice_dry", "rice_wet", ...produce, ...critters].sort());
  });
  it("draw the v15.2 tools in their colours", () => {
    expect(iconMatrixFor("tool_sickle")?.flat()).toEqual(expect.arrayContaining(["#5a5f68", "#e8e8ee", "#6e4424"]));
    expect(iconMatrixFor("tool_sprayer")?.flat()).toEqual(expect.arrayContaining(["#3d6fd1", "#2f56a6"]));
    expect(iconMatrixFor("produce_ot")?.flat()).toContain("#d8342a");
  });
  it("draw the v15.3 containers and critters in their colours (§15)", () => {
    const colours: Record<string, string[]> = {
      box_bucket: ["#3d6fd1", "#2f56a6", "#d9d9e0"],
      box_basket: ["#c8a46a", "#9a7a44"],
      cua_dong: ["#6b5a2e", "#8e7a44", "#b8432f"],
      cua_gach: ["#e0662f", "#f29b4a", "#b8432f"],
      oc_dong: ["#4a3a22", "#8a6a3f"],
      oc_buou_vang: ["#c9955a", "#8a5a2b", "#f29bb5"],
    };
    for (const [id, cols] of Object.entries(colours)) expect(iconMatrixFor(id)?.flat(), id).toEqual(expect.arrayContaining(cols));
    // the cua gạch lies belly-up: no eyes, the roe instead
    expect(iconMatrixFor("cua_dong")?.flat()).toContain("#2a2f3a");
    expect(iconMatrixFor("cua_gach")?.flat()).not.toContain("#2a2f3a");
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
  it("paint the NPK bag in its own blue, apart from potash's red", () => {
    const body = (id: string) => iconMatrixFor(id)?.[2][3]; // a pixel of the bag's top band
    expect(iconMatrixFor("fert_npk")?.flat()).toContain("#3d6fd1");
    expect(body("fert_npk")).not.toBe(body("fert_potash"));
  });
});
