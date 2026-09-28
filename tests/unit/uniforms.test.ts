import { describe, expect, it } from "vitest";
import { composeMatrix, lookKey, resolveWear } from "@/lib/game/art/compose";
import { drawGarment } from "@/lib/game/art/garments";
import { garmentIconMatrix } from "@/lib/game/art/icons";
import { FRAMES, type Dir3 } from "@/lib/game/art/layers";
import { POSES } from "@/lib/game/art/body";
import { BELT_COLORS, FIRST_BELT, UNIFORM_ART, UNIFORM_ART_IDS, uniformArtFor } from "@/lib/game/art/uniforms";
import { MARTIAL, UNIFORM_IDS } from "@/lib/game/fight/dojo";
import { filterStoreItems } from "@/lib/game/store";
import { DEFAULT_LOOK } from "@/lib/game/look";
import type { CatalogItem } from "@/lib/game/character";
import type { Facing, Look } from "@/lib/game/types";

const DIRS: Dir3[] = ["down", "up", "left"];
const FACINGS: Facing[] = ["down", "up", "left", "right"];
const BASE: Look = { ...DEFAULT_LOOK, hat: null };
const allColours = (m: string[][]) => m.every((row) => row.every((c) => c === "" || /^#[0-9a-f]{6}$/i.test(c)));

describe("the võ phục on the world chibi (v20.2)", () => {
  it("draws exactly the dojo's seven uniforms, in the outfit slot, unisex", () => {
    expect([...UNIFORM_ART_IDS]).toEqual([...UNIFORM_IDS]);
    for (const id of UNIFORM_ART_IDS) expect(UNIFORM_ART[id]).toMatchObject({ slot: "outfit", gender: "unisex" });
    for (const m of MARTIAL) expect(FIRST_BELT[m.key]).toBe(m.belts[0].color);
  });

  it("v20.3: the belt is drawn in the wearer's current rank colour", () => {
    for (const m of MARTIAL) expect(BELT_COLORS[m.key]).toEqual(m.belts.map((b) => b.color));
    const hex = (c: string) => c.toLowerCase();
    for (const m of MARTIAL) {
      const colours = (rank: number | null) => new Set(composeMatrix({ ...BASE, outfit: m.uniform, belt: rank }, "down", 0).flat().map(hex));
      for (let rank = 1; rank <= 4; rank++) {
        expect(uniformArtFor(m.uniform, rank)!.colors[1]).toBe(m.belts[rank].color);
        if (m.belts[rank].color !== m.belts[0].color) expect(colours(rank).has(hex(m.belts[rank].color)), `${m.key} ${rank}`).toBe(true);
      }
      expect(uniformArtFor(m.uniform, null)).toBe(UNIFORM_ART[m.uniform]);
      expect(uniformArtFor(m.uniform, 2)).toBe(uniformArtFor(m.uniform, 2));
    }
    expect(uniformArtFor("top_ao_thun", 3)).toBeUndefined();
    expect(lookKey({ ...BASE, outfit: "vp_karate", belt: 2 })).not.toBe(lookKey({ ...BASE, outfit: "vp_karate", belt: 3 }));
  });

  it("composes on both bodies in every facing and frame with no unknown codes", () => {
    for (const id of UNIFORM_ART_IDS) for (const gender of ["nam", "nu"] as const) {
      const look: Look = { ...BASE, gender, outfit: id };
      const pal = { ...resolveWear(look).pal, ...UNIFORM_ART[id].colors };
      for (const d of DIRS) for (const fr of FRAMES) {
        const L = drawGarment(UNIFORM_ART[id], d, gender, POSES[fr]);
        for (const layer of [L.behind, L.under, L.tip, L.over]) {
          for (const ch of layer.rows().join("")) if (ch !== ".") expect(pal[ch], `${id} ${d} code ${ch}`).toBeTruthy();
        }
      }
      for (const f of FACINGS) for (const fr of FRAMES) expect(allColours(composeMatrix(look, f, fr)), `${id} ${gender} ${f}`).toBe(true);
    }
  }, 60_000);

  it("replaces the top and bottom, and every uniform looks different", () => {
    const plain = composeMatrix(BASE, "down", 0);
    const seen = new Set<string>();
    for (const id of UNIFORM_ART_IDS) {
      const m = composeMatrix({ ...BASE, outfit: id }, "down", 0);
      expect(m).not.toEqual(plain);
      expect(composeMatrix({ ...BASE, top: "top_tee_red", outfit: id }, "down", 0)).toEqual(m);
      seen.add(JSON.stringify(m));
      expect(garmentIconMatrix(id), id).not.toBeNull();
    }
    expect(seen.size).toBe(7);
  });

  it("the clothes shop never sells them; the wardrobe lists the ones I own", () => {
    const catalog = [
      { id: "vp_judo", slot: "outfit", name: "Judogi", price: 0, starter: false, sort_order: 905, gender: "unisex" },
      { id: "fm_kimono", slot: "outfit", name: "Áo kimono", price: 2200, starter: false, sort_order: 1, gender: "unisex" },
    ] as unknown as CatalogItem[];
    const f = { category: "all" as const, ownedIds: new Set(["vp_judo"]), fitsMe: false, gender: "nam" as const };
    expect(filterStoreItems(catalog, { ...f, tab: "store" }).map((i) => i.id)).toEqual(["fm_kimono"]);
    expect(filterStoreItems(catalog, { ...f, tab: "my_items" }).map((i) => i.id)).toEqual(["vp_judo"]);
  });
});
