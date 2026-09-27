import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { BODY_CODES, buildBody } from "@/lib/game/art/body";
import { composeMatrix, genderOf, lookKey } from "@/lib/game/art/compose";
import { SPRITE_H, SPRITE_W, type Dir3, type Frame } from "@/lib/game/art/layers";
import { lookFromRow, validateLook, type CatalogItem, type CharacterRow } from "@/lib/game/character";
import { DEFAULT_LOOK } from "@/lib/game/look";
import { HAIR_STYLES, HAIR_STYLES_BY_GENDER, type Gender, type Look } from "@/lib/game/types";

const DIRS: Dir3[] = ["down", "up", "left"];
const FRAMES: Frame[] = [0, 1, 2, 3, 4, 5];
const ROW: CharacterRow = {
  account_id: "a", skin: "warm", hair: "long", hair_color: "black",
  hat: null, top: "top_baba_yellow", bottom: "bottom_jeans", shoes: "shoes_dep_blue", neck: null,
};
const CATALOG: CatalogItem[] = [
  { id: "top_baba_yellow", slot: "top", name: "Áo", price: 0, starter: true, sort_order: 1 },
  { id: "bottom_jeans", slot: "bottom", name: "Quần", price: 0, starter: true, sort_order: 1 },
  { id: "shoes_dep_blue", slot: "shoes", name: "Dép", price: 0, starter: true, sort_order: 1 },
];
const LOOK: Look = { ...lookFromRow(ROW) };

describe("gender parsing", () => {
  it("reads nam / nu from the row", () => {
    expect(lookFromRow({ ...ROW, gender: "nu" }).gender).toBe("nu");
    expect(lookFromRow({ ...ROW, gender: "nam" }).gender).toBe("nam");
  });
  it("old rows without gender (or junk) read as nam", () => {
    expect(lookFromRow(ROW).gender).toBe("nam");
    expect(lookFromRow({ ...ROW, gender: null }).gender).toBe("nam");
    expect(lookFromRow({ ...ROW, gender: "x" }).gender).toBe("nam");
  });
  it("genderOf treats a look without gender as nam", () => {
    const { gender: _drop, ...legacy } = LOOK;
    void _drop;
    expect(genderOf(legacy as Look)).toBe("nam");
    expect(genderOf({ ...LOOK, gender: "nu" })).toBe("nu");
  });
});

describe("validateLook with gender", () => {
  it("accepts both body types and a missing one", () => {
    expect(validateLook({ ...LOOK, gender: "nam" }, CATALOG)).toBeNull();
    expect(validateLook({ ...LOOK, gender: "nu" }, CATALOG)).toBeNull();
    expect(validateLook({ ...LOOK, gender: undefined }, CATALOG)).toBeNull();
  });
  it("rejects an unknown body type", () => {
    expect(validateLook({ ...LOOK, gender: "x" as Gender }, CATALOG)).toBe("option");
  });
  it("offers hair styles per body type from the fixed list", () => {
    for (const g of ["nam", "nu"] as const) for (const h of HAIR_STYLES_BY_GENDER[g]) expect(HAIR_STYLES).toContain(h);
    expect(HAIR_STYLES_BY_GENDER.nam).toContain("short");
    expect(HAIR_STYLES_BY_GENDER.nu).toContain("long");
  });
});

describe("two body painters", () => {
  it("both bodies are full 24×48 grids of known codes", () => {
    for (const g of ["nam", "nu"] as const) for (const d of DIRS) for (const f of FRAMES) {
      const rows = buildBody(d, f, g);
      expect(rows).toHaveLength(SPRITE_H);
      for (const r of rows) expect(r).toHaveLength(SPRITE_W);
      expect([...rows.join("")].every((ch) => BODY_CODES.includes(ch))).toBe(true);
    }
  });
  it("nam is the default body; nu differs from it facing front, back and side", () => {
    for (const d of DIRS) {
      expect(buildBody(d, 0)).toEqual(buildBody(d, 0, "nam"));
      expect(buildBody(d, 0, "nu")).not.toEqual(buildBody(d, 0, "nam"));
    }
  });
  it("nu has both arms fully drawn, a narrower frame, a bust and a waist; nam has broader shoulders", () => {
    const nam = buildBody("down", 0, "nam"), nu = buildBody("down", 0, "nu");
    for (let i = 22; i <= 25; i++) {
      // sleeves on both sides (nữ columns 4–5 and 18–19, nam 3–4 and 19–20)
      expect(nu[i].slice(4, 6)).toMatch(/^[aA]{2}$/);
      expect(nu[i].slice(18, 20)).toMatch(/^[aA]{2}$/);
      expect(nam[i].slice(3, 5)).toMatch(/^[aA]{2}$/);
      expect(nam[i].slice(19, 21)).toMatch(/^[aA]{2}$/);
    }
    expect(nu[22][3]).toBe(".");
    // the bust's highlight and shading, and the waist's outline inside the arms
    expect(nu.slice(22, 26).join("")).toMatch(/u.*T/);
    expect(nu[26][7]).toBe("o");
    expect(nu[26][16]).toBe("o");
    expect(nam[26][7]).not.toBe("o");
  });
  it("the composed sprites differ, and so do their cache keys", () => {
    const nam = { ...DEFAULT_LOOK, gender: "nam" as const }, nu = { ...DEFAULT_LOOK, gender: "nu" as const };
    expect(lookKey(nam)).not.toBe(lookKey(nu));
    for (const f of ["down", "up", "left", "right"] as const) {
      const a = composeMatrix(nam, f, 0), b = composeMatrix(nu, f, 0);
      expect(b).toHaveLength(SPRITE_H);
      expect(b).not.toEqual(a);
    }
  });
  it("every item stays drawn on the nu body (items are colours on shared regions)", () => {
    const nu: Look = { ...DEFAULT_LOOK, gender: "nu" };
    const m = composeMatrix(nu, "down", 0);
    const top = m.slice(19, 29).flat().filter((c) => c !== "").length;
    expect(top).toBeGreaterThan(100);
  });
});
