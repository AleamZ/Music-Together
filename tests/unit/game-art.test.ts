import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BODY_CODES, HEADS, POSES, buildBody } from "@/lib/game/art/body";
import { BRA, BRIEF_NAM, BRIEF_NU, composeMatrix, resolveWear } from "@/lib/game/art/compose";
import { GARMENT_ART, GARMENT_ART_IDS, drawGarment } from "@/lib/game/art/garments";
import { HAIR, HAIR_CODES } from "@/lib/game/art/hair";
import { HATS, HAT_CODES } from "@/lib/game/art/hats";
import { ITEM_ART } from "@/lib/game/art/items";
import { SKIN } from "@/lib/game/art/palettes";
import { FRAMES, SPRITE_H, SPRITE_W, type Dir3 } from "@/lib/game/art/layers";
import { DEFAULT_LOOK } from "@/lib/game/look";
import { HAIR_STYLES, type Facing, type Look } from "@/lib/game/types";

const DIRS: Dir3[] = ["down", "up", "left"];
const FACINGS: Facing[] = ["down", "up", "left", "right"];
const onlyCodes = (rows: readonly string[], codes: string) => rows.every((r) => [...r].every((ch) => codes.includes(ch)));
const BASE: Look = { ...DEFAULT_LOOK, hat: null };

describe("body grids", () => {
  it("are 24×48 for every direction, frame and body type, using only known codes", () => {
    for (const g of ["nam", "nu"] as const) for (const d of DIRS) for (const f of FRAMES) {
      for (const lower of ["pants", "skirt", "pleated", "maxi", "robe"] as const) {
        const rows = buildBody(d, f, g, { lower, thigh: 3, cuff: true });
        expect(rows).toHaveLength(SPRITE_H);
        for (const r of rows) expect(r).toHaveLength(SPRITE_W);
        expect(onlyCodes(rows, BODY_CODES)).toBe(true);
      }
    }
  });
  it("every walk frame and the breath differ from idle; feet stay on the ground row when not lifted", () => {
    for (const d of DIRS) {
      const idle = buildBody(d, 0);
      for (const f of FRAMES.slice(1)) expect(buildBody(d, f), `${d} ${f}`).not.toEqual(idle);
      expect(buildBody(d, 1)).not.toEqual(buildBody(d, 3));
      for (const f of FRAMES) expect(buildBody(d, f)[44].replace(/\./g, "").length, `${d} ${f}`).toBeGreaterThan(0);
    }
  });
  it("bounces: the head sits a pixel higher on the passing frames and lower on the breath", () => {
    const topRow = (rows: string[]) => rows.findIndex((r) => r.includes("s"));
    const idle = topRow(buildBody("down", 0));
    expect(topRow(buildBody("down", 2))).toBe(idle + POSES[2].dy);
    expect(POSES[2].dy).toBe(-1);
    expect(topRow(buildBody("down", 5))).toBe(idle + 1);
  });
});

describe("hair layers", () => {
  it("fit the sprite and use only hair codes", () => {
    for (const style of Object.values(HAIR)) for (const d of DIRS) {
      const l = style[d];
      expect(l.top + l.rows.length).toBeLessThanOrEqual(SPRITE_H);
      for (const r of l.rows) expect(r).toHaveLength(SPRITE_W);
      expect(onlyCodes(l.rows, HAIR_CODES)).toBe(true);
    }
  });
  it("cover the bald scalp in every direction", () => {
    for (const [name, style] of Object.entries(HAIR)) for (const d of DIRS) {
      const l = style[d], head = HEADS[d];
      const at = (r: number, c: number) => (r >= l.top && r < l.top + l.rows.length ? l.rows[r - l.top][c] : ".");
      for (let r = 0; r <= 15; r++) for (let c = 0; c < SPRITE_W; c++) {
        const skin = head[r][c] === "s" || head[r][c] === "S";
        const must = r <= 8 || (d === "up" && r <= 15) || (d === "left" && r <= 15 && c >= 14);
        if (skin && must) expect(at(r, c), `${name}.${d} r${r} c${c}`).not.toBe(".");
      }
    }
  });
});

describe("hats", () => {
  it("are 24 wide with known codes", () => {
    for (const h of Object.values(HATS).flatMap((d) => Object.values(d))) {
      for (const r of h.rows) expect(r).toHaveLength(SPRITE_W);
      expect(onlyCodes(h.rows, HAT_CODES)).toBe(true);
    }
  });
  it("each new hat id (0029) composes on both genders, every facing and frame, and paints every code it uses", () => {
    const ids = ["hat_cap", "hat_beanie", "hat_fedora", "hat_sunhat", "hat_helmet", "hat_coi", "hat_bucket", "hat_crown", "hat_antlers", "hat_straw_cowboy"];
    for (const id of ids) {
      const a = ITEM_ART[id];
      expect(a?.slot, id).toBe("hat");
      if (a?.slot !== "hat") continue;
      for (const d of DIRS) for (const ch of HATS[a.shape][d].rows.join("")) if (ch !== "." && ch !== "o") expect(a.colors[ch], `${id} ${d} ${ch}`).toBeTruthy();
      for (const gender of ["nam", "nu"] as const) for (const f of FACINGS) for (const fr of FRAMES) {
        const m = composeMatrix({ ...BASE, gender, hat: id }, f, fr);
        expect(allColours(m), `${id} ${gender} ${f} ${fr}`).toBe(true);
        expect(m, `${id} ${gender} ${f} ${fr}`).not.toEqual(composeMatrix({ ...BASE, gender }, f, fr));
      }
    }
  });
});

/** Every drawn pixel is a colour (no code left without one). */
function allColours(m: string[][]): boolean {
  return m.every((row) => row.every((c) => c === "" || /^#[0-9a-f]{6}$/i.test(c)));
}

describe("every option composes", () => {
  it("each hair style, top, bottom, shoe, hat and scarf, on both bodies, in all facings and frames", () => {
    const slots = {
      top: [] as string[], bottom: [] as string[], shoes: [] as string[], hat: [] as string[], neck: [] as string[],
      wrist: [] as string[], hairpin: [] as string[],
    };
    for (const [id, a] of Object.entries(ITEM_ART)) slots[a.slot].push(id);
    for (const gender of ["nam", "nu"] as const) {
      const looks: Look[] = [
        ...HAIR_STYLES.map((hair) => ({ ...BASE, hair, gender })),
        ...Object.entries(slots).flatMap(([slot, ids]) => ids.map((id) => ({ ...BASE, gender, [slot]: id }))),
      ];
      for (const look of looks) for (const f of FACINGS) for (const fr of FRAMES) {
        const m = composeMatrix(look, f, fr);
        expect(m).toHaveLength(SPRITE_H);
        expect(allColours(m), `${JSON.stringify(look)} ${f} ${fr}`).toBe(true);
      }
    }
  }, 60_000); // every item × both bodies × 4 facings × 6 frames: seconds of composing, more on a busy machine
  it("the walk frames differ from idle in the composed sprite", () => {
    for (const f of FACINGS) for (const fr of [1, 2, 3, 4] as const) expect(composeMatrix(BASE, f, fr)).not.toEqual(composeMatrix(BASE, f, 0));
  });
});

describe("fashion models", () => {
  const wear = (base: Look, id: string): Look => {
    const a = GARMENT_ART[id];
    return a.slot === "outfit" ? { ...base, outfit: id } : { ...base, [a.slot]: id };
  };
  it("draws exactly the contract's 23 ids", () => {
    const doc = readFileSync(join(process.cwd(), "docs/superpowers/fashion-models-contract.md"), "utf8");
    const ids = [...new Set([...doc.matchAll(/`?(fm_[a-z_]+)`?/g)].map((m) => m[1]))].sort();
    expect(ids).toHaveLength(23);
    expect([...GARMENT_ART_IDS].sort()).toEqual(ids);
  });
  it("every garment composes on both bodies in all facings and frames with no unknown codes", () => {
    for (const id of GARMENT_ART_IDS) for (const gender of ["nam", "nu"] as const) {
      const look = wear({ ...BASE, gender }, id);
      const pal = { ...resolveWear(look).pal, ...GARMENT_ART[id].colors };
      for (const d of DIRS) for (const fr of FRAMES) {
        const L = drawGarment(GARMENT_ART[id], d, gender, POSES[fr]);
        for (const layer of [L.behind, L.under, L.tip, L.over]) {
          for (const ch of layer.rows().join("")) if (ch !== ".") expect(pal[ch], `${id} ${d} code ${ch}`).toBeTruthy();
        }
      }
      for (const f of FACINGS) for (const fr of FRAMES) expect(allColours(composeMatrix(look, f, fr))).toBe(true);
    }
  }, 60_000); // every garment × both bodies × every facing and frame: slow on a busy machine
  it("each garment changes the silhouette or pixels, not just the plain look", () => {
    const plain = composeMatrix(BASE, "down", 0);
    for (const id of GARMENT_ART_IDS) expect(composeMatrix(wear(BASE, id), "down", 0), id).not.toEqual(plain);
  });
  it("an outfit hides the top and bottom (they are kept on the look, not drawn)", () => {
    const a = composeMatrix({ ...BASE, outfit: "fm_kimono" }, "down", 0);
    const b = composeMatrix({ ...BASE, top: "top_tee_red", bottom: "bottom_jeans", outfit: "fm_kimono" }, "down", 0);
    expect(b).toEqual(a);
  });
  it("loose parts sway: the áo dài's flaps move on the walk frames", () => {
    const look = wear({ ...BASE, gender: "nu" }, "fm_ao_dai");
    expect(composeMatrix(look, "left", 1)).not.toEqual(composeMatrix(look, "left", 3));
  });
});

describe("item art", () => {
  it("covers exactly the starter, store and accessory ids and slots seeded by migrations 0011, 0022 and 0029", () => {
    const read = (f: string) => readFileSync(join(process.cwd(), "supabase/migrations", f), "utf8");
    const sql = [read("0011_v13_game_mode.sql"), read("0022_fashion_store.sql"), read("0029_fashion2.sql")].join("\n");
    const seeded = [...sql.matchAll(/\('([a-z]+_[a-z_]+)',\s*'(hat|top|bottom|shoes|neck|wrist|hairpin|hand|pet)'/g)]
      .map((m) => `${m[1]}:${m[2]}`)
      .sort();
    const art = Object.entries(ITEM_ART).map(([id, a]) => `${id}:${a.slot}`).sort();
    expect(seeded).toHaveLength(140);
    expect(art).toEqual(seeded);
  });
});

describe("underwear and accessories (v18.6)", () => {
  const SKIN_S = SKIN[BASE.skin].s;
  const colours = (m: string[][], y0: number, y1: number) => new Set(m.slice(y0, y1 + 1).flat());
  it("no top: nam shows skin on the torso and none of the placeholder top", () => {
    for (const fr of FRAMES) {
      const m = composeMatrix({ ...BASE, gender: "nam", top: null }, "down", fr);
      const c = colours(m, 22, 29);
      expect(c.has("#9aa0a8")).toBe(false);
      expect(c.has("#7d838c")).toBe(false);
      expect(c.has(SKIN_S)).toBe(true);
    }
  });
  it("no top: nữ has the bra band on rows 22–25 in every facing", () => {
    for (const f of FACINGS) {
      const m = composeMatrix({ ...BASE, gender: "nu", top: null }, f, 0);
      const band = colours(m, 22, 25);
      expect(band.has(BRA[0]) || band.has(BRA[1]), f).toBe(true);
      expect(colours(m, 22, 30).has("#9aa0a8")).toBe(false);
    }
  });
  it("no bottom: both bodies wear briefs on the hip rows", () => {
    for (const f of FACINGS) for (const fr of FRAMES) {
      expect(colours(composeMatrix({ ...BASE, gender: "nam", bottom: null }, f, fr), 31, 34).has(BRIEF_NAM[0]), `nam ${f} ${fr}`).toBe(true);
      expect(colours(composeMatrix({ ...BASE, gender: "nu", bottom: null }, f, fr), 31, 34).has(BRIEF_NU[0]), `nu ${f} ${fr}`).toBe(true);
    }
  });
  it("each accessory changes the composed sprite", () => {
    for (const [id, a] of Object.entries(ITEM_ART)) {
      if (!(a.slot === "wrist" || a.slot === "hairpin" || (a.slot === "neck" && a.style))) continue;
      for (const gender of ["nam", "nu"] as const) {
        const base = { ...BASE, gender };
        const worn = { ...base, [a.slot]: id };
        expect(composeMatrix(worn, "down", 0), `${id} ${gender}`).not.toEqual(composeMatrix(base, "down", 0));
        expect(composeMatrix(worn, "left", 0), `${id} ${gender} side`).not.toEqual(composeMatrix(base, "left", 0));
      }
    }
  });
});
