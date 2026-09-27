import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOOK, characterErrorMessage, itemFitsGender, lookFromRow, validateLook, type CatalogItem, type CharacterRow,
} from "@/lib/game/character";
import { FASHION_MODELS, filterStoreItems, genderTag } from "@/lib/game/store";

const item = (id: string, slot: CatalogItem["slot"], starter = true, gender?: CatalogItem["gender"]): CatalogItem => ({
  id, slot, name: id, price: starter ? 0 : 100, starter, sort_order: 0, gender,
});

const CATALOG: CatalogItem[] = [
  item("top_baba_yellow", "top"),
  item("bottom_jeans", "bottom"),
  item("shoes_dep_blue", "shoes"),
  item("fm_kimono", "outfit", false, "unisex"),
  item("fm_ao_dai", "outfit", false, "nu"),
  item("fm_pleated_skirt", "bottom", false, "nu"),
  item("fm_hoodie", "top", false),
];
const ROW: CharacterRow = {
  account_id: "a", skin: "light", hair: "short", hair_color: "black", hat: null,
  top: "top_baba_yellow", bottom: "bottom_jeans", shoes: "shoes_dep_blue", neck: null,
};
const BASE = { ...DEFAULT_LOOK, top: "top_baba_yellow", bottom: "bottom_jeans", shoes: "shoes_dep_blue", hat: null, neck: null };

describe("lookFromRow: outfit", () => {
  it("reads outfit, and an absent/null outfit as null", () => {
    expect(lookFromRow({ ...ROW, outfit: "fm_kimono" }).outfit).toBe("fm_kimono");
    expect(lookFromRow({ ...ROW, outfit: null }).outfit).toBeNull();
    expect(lookFromRow(ROW).outfit).toBeNull();
  });
});

describe("validateLook: outfit slot and item gender", () => {
  const owned = new Set(["fm_kimono", "fm_ao_dai", "fm_pleated_skirt"]);
  it("accepts an owned outfit and no outfit", () => {
    expect(validateLook({ ...BASE, outfit: "fm_kimono" }, CATALOG, owned)).toBeNull();
    expect(validateLook({ ...BASE, outfit: null }, CATALOG, owned)).toBeNull();
    expect(validateLook(BASE, CATALOG, owned)).toBeNull();
  });
  it("refuses an unowned outfit or a non-outfit item in the slot", () => {
    expect(validateLook({ ...BASE, outfit: "fm_kimono" }, CATALOG)).toBe("slot");
    expect(validateLook({ ...BASE, outfit: "top_baba_yellow" }, CATALOG, owned)).toBe("slot");
  });
  it("refuses a nu-only item on a nam body, allows it on a nu body", () => {
    expect(validateLook({ ...BASE, gender: "nam", outfit: "fm_ao_dai" }, CATALOG, owned)).toBe("gender");
    expect(validateLook({ ...BASE, outfit: "fm_ao_dai" }, CATALOG, owned)).toBe("gender");
    expect(validateLook({ ...BASE, gender: "nam", bottom: "fm_pleated_skirt" }, CATALOG, owned)).toBe("gender");
    expect(validateLook({ ...BASE, gender: "nu", outfit: "fm_ao_dai", bottom: "fm_pleated_skirt" }, CATALOG, owned)).toBeNull();
  });
  it("itemFitsGender treats untagged items as unisex", () => {
    expect(itemFitsGender({ gender: undefined }, "nu")).toBe(true);
    expect(itemFitsGender({ gender: "nam" }, "nu")).toBe(false);
  });
  it("maps the server's gender refusal to Vietnamese", () => {
    expect(characterErrorMessage({ message: "item not for this gender" })).toMatch(/giới tính/);
  });
});

describe("filterStoreItems", () => {
  const base = { tab: "store" as const, category: "all" as const, ownedIds: new Set<string>(), fitsMe: false, gender: "nam" as const };
  it("hides starters and filters by the outfit category", () => {
    expect(filterStoreItems(CATALOG, base).map((c) => c.id)).toEqual(["fm_kimono", "fm_ao_dai", "fm_pleated_skirt", "fm_hoodie"]);
    expect(filterStoreItems(CATALOG, { ...base, category: "outfit" }).map((c) => c.id)).toEqual(["fm_kimono", "fm_ao_dai"]);
  });
  it("'Hợp với tôi' hides items for the other gender", () => {
    expect(filterStoreItems(CATALOG, { ...base, fitsMe: true }).map((c) => c.id)).toEqual(["fm_kimono", "fm_hoodie"]);
    expect(filterStoreItems(CATALOG, { ...base, fitsMe: true, gender: "nu" })).toHaveLength(4);
  });
  it("my items shows only owned ones", () => {
    expect(filterStoreItems(CATALOG, { ...base, tab: "my_items", ownedIds: new Set(["fm_ao_dai"]) }).map((c) => c.id)).toEqual(["fm_ao_dai"]);
  });
  it("tags gender items ♂/♀", () => {
    expect(genderTag({ gender: "nu" })).toBe("♀");
    expect(genderTag({ gender: "nam" })).toBe("♂");
    expect(genderTag({ gender: "unisex" })).toBeNull();
  });
});

describe("FASHION_MODELS catalog", () => {
  it("has the 23 contract entries with unique fm_ ids", () => {
    expect(FASHION_MODELS).toHaveLength(23);
    expect(new Set(FASHION_MODELS.map((m) => m.id)).size).toBe(23);
    expect(FASHION_MODELS.filter((m) => m.slot === "outfit").map((m) => m.id).sort())
      .toEqual(["fm_ao_dai", "fm_kimono", "fm_maxi_dress", "fm_overalls"]);
    expect(FASHION_MODELS.filter((m) => m.gender === "nu").map((m) => m.id).sort())
      .toEqual(["fm_ao_dai", "fm_maxi_dress", "fm_pleated_skirt"]);
  });
  it("matches the rows inserted by 0024_fashion_models.sql", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0024_fashion_models.sql"), "utf8");
    const rows = [...sql.matchAll(/\('(fm_\w+)',\s*'(\w+)',\s*'([^']+)',\s*(\d+),\s*false,\s*\d+,\s*'(\w+)'\)/g)]
      .map(([, id, slot, name, price, gender]) => ({ id, name, slot, gender, price: Number(price) }));
    expect(rows).toEqual(FASHION_MODELS.map(({ id, name, slot, gender, price }) => ({ id, name, slot, gender, price })));
  });
});
