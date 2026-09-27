import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { DEFAULT_HAIR, lookFromRow, validateLook, type CatalogItem, type CharacterRow } from "@/lib/game/character";
import { DEFAULT_LOOK } from "@/lib/game/look";
import { categoryMatches, filterStoreItems, unequipItem } from "@/lib/game/store";
import { HAIR_COLOR, HAIR_COLOR_LABEL, HAIR_STYLE_LABEL } from "@/lib/game/art/palettes";
import { HAIR_COLORS, HAIR_STYLES, type Look } from "@/lib/game/types";

const item = (id: string, slot: CatalogItem["slot"], starter = true, gender: CatalogItem["gender"] = "unisex"): CatalogItem =>
  ({ id, slot, name: id, price: 100, starter, sort_order: 0, gender });

const CATALOG: CatalogItem[] = [
  item("hat_nonla", "hat"), item("top_baba_yellow", "top"), item("bottom_shorts_red", "bottom"),
  item("shoes_dep_blue", "shoes"), item("neck_khanran", "neck"),
  item("acc_watch", "wrist", false), item("acc_clip_star", "hairpin", false), item("acc_bow_red", "hairpin", false, "nu"),
];
const OWNED = new Set(["acc_watch", "acc_clip_star", "acc_bow_red"]);

describe("fashion2 model", () => {
  it("lookFromRow reads null top/bottom and the accessory slots", () => {
    const row: CharacterRow = {
      account_id: "a", skin: "warm", hair: "curly", hair_color: "moss", hat: null, top: null, bottom: null,
      shoes: "shoes_dep_blue", neck: null, wrist: "acc_watch", hairpin: "acc_clip_star", gender: "nam",
    };
    const look = lookFromRow(row);
    expect(look.top).toBeNull();
    expect(look.bottom).toBeNull();
    expect(look.wrist).toBe("acc_watch");
    expect(look.hairpin).toBe("acc_clip_star");
    expect(look.hair).toBe("curly");
    expect(look.hairColor).toBe("moss");
    const old = lookFromRow({ ...row, wrist: undefined, hairpin: undefined });
    expect(old.wrist).toBeNull();
    expect(old.hairpin).toBeNull();
  });

  it("validateLook accepts null top and bottom, and checks the new slots", () => {
    expect(validateLook({ ...DEFAULT_LOOK, top: null, bottom: null }, CATALOG)).toBeNull();
    expect(validateLook({ ...DEFAULT_LOOK, wrist: "acc_watch", hairpin: "acc_clip_star" }, CATALOG, OWNED)).toBeNull();
    expect(validateLook({ ...DEFAULT_LOOK, hairpin: "acc_watch" }, CATALOG, OWNED)).toBe("slot");
    expect(validateLook({ ...DEFAULT_LOOK, wrist: "acc_watch" }, CATALOG)).toBe("slot");
    expect(validateLook({ ...DEFAULT_LOOK, hairpin: "acc_bow_red", gender: "nam" }, CATALOG, OWNED)).toBe("gender");
    expect(validateLook({ ...DEFAULT_LOOK, shoes: null as unknown as string }, CATALOG)).toBe("missing");
  });

  it("DEFAULT_HAIR", () => {
    expect(DEFAULT_HAIR).toEqual({ nam: { hair: "short", hairColor: "black" }, nu: { hair: "long", hairColor: "black" } });
  });

  it("hair lists match the exact lists", () => {
    expect(HAIR_STYLES).toEqual(["short", "bob", "long", "buzz", "undercut", "curly", "ponytail", "twin_braids", "bun", "bangs"]);
    expect(HAIR_COLORS).toEqual(["black", "darkbrown", "brown", "pink", "blonde", "red", "blue", "silver", "purple", "moss"]);
    expect(HAIR_STYLE_LABEL.twin_braids).toBe("Tết hai bên");
    expect(HAIR_COLOR_LABEL.moss).toBe("Xanh rêu");
    expect(HAIR_COLOR.blonde.h).toBe("#e8c26a");
    expect(HAIR_COLOR.red.h).toBe("#b8322a");
    expect(HAIR_COLOR.blue.h).toBe("#3a6fc4");
    expect(HAIR_COLOR.silver.h).toBe("#c8ccd4");
    expect(HAIR_COLOR.purple.h).toBe("#7a4bb0");
    expect(HAIR_COLOR.moss.h).toBe("#5f7a3a");
  });

  it("hair lists equal 0029_fashion2.sql _hair_ok", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0029_fashion2.sql"), "utf8");
    const list = (col: string) => {
      const m = sql.match(new RegExp(`${col} in \\(([^)]*)\\)`));
      expect(m).not.toBeNull();
      return m![1].split(",").map((s) => s.trim().replace(/'/g, ""));
    };
    expect(list("p_hair")).toEqual([...HAIR_STYLES]);
    expect(list("p_color")).toEqual([...HAIR_COLORS]);
  });

  it("the accessory store category covers neck, wrist and hairpin", () => {
    expect(categoryMatches("accessory", "neck")).toBe(true);
    expect(categoryMatches("accessory", "wrist")).toBe(true);
    expect(categoryMatches("accessory", "hairpin")).toBe(true);
    expect(categoryMatches("accessory", "hat")).toBe(false);
    const shop = CATALOG.map((c) => ({ ...c, starter: false }));
    const got = filterStoreItems(shop, { tab: "store", category: "accessory", ownedIds: new Set(), fitsMe: false, gender: "nam" });
    expect(got.map((c) => c.id).sort()).toEqual(["acc_bow_red", "acc_clip_star", "acc_watch", "neck_khanran"]);
  });

  it("unequipItem clears a sold top/bottom/wrist/hairpin to null", () => {
    const worn: Look = { ...DEFAULT_LOOK, wrist: "acc_watch", hairpin: "acc_clip_star" };
    expect(unequipItem(worn, "top_baba_yellow")?.top).toBeNull();
    expect(unequipItem(worn, "bottom_shorts_red")?.bottom).toBeNull();
    expect(unequipItem(worn, "acc_watch")?.wrist).toBeNull();
    expect(unequipItem(worn, "acc_clip_star")?.hairpin).toBeNull();
    expect(unequipItem(worn, "nothing")).toBeNull();
  });
});
