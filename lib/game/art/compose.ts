import type { Facing, Look } from "@/lib/game/types";
import { buildBody } from "./body";
import { HAIR } from "./hair";
import { HATS } from "./hats";
import { ITEM_ART, type ItemArt } from "./items";
import { EYE, HAIR_COLOR, OUTLINE, SKIN } from "./palettes";
import { SPRITE_H, SPRITE_W, type Dir3, type Frame, type Layer } from "./layers";

/** Region code → CSS colour; null = not drawn. */
export type Palette = Record<string, string | null>;

const PLACEHOLDER_TOP = ["#9aa0a8", "#7d838c", "#c3c7cc", "#7d838c"] as const;
const PLACEHOLDER_BOTTOM = ["#6b6f76", "#50545a", "#6b6f76"] as const;
const PLACEHOLDER_SHOES = ["#6b6f76", "#50545a"] as const;

function artFor<S extends ItemArt["slot"]>(id: string | null, slot: S): Extract<ItemArt, { slot: S }> | null {
  if (!id) return null;
  const a = ITEM_ART[id];
  return a && a.slot === slot ? (a as Extract<ItemArt, { slot: S }>) : null;
}

/** Stable cache key for a look. */
export function lookKey(look: Look): string {
  return [look.skin, look.hair, look.hairColor, look.hat ?? "-", look.top, look.bottom, look.shoes, look.neck ?? "-"].join("|");
}

/** Colours for the body template and the hair layer. */
export function bodyPalette(look: Look): Palette {
  const skin = SKIN[look.skin] ?? SKIN.warm;
  const hair = HAIR_COLOR[look.hairColor] ?? HAIR_COLOR.black;
  const top = artFor(look.top, "top");
  const bottom = artFor(look.bottom, "bottom");
  const shoes = artFor(look.shoes, "shoes");
  const neck = artFor(look.neck, "neck");
  const [tMain, tShade, tHi, tDetail] = top?.colors ?? PLACEHOLDER_TOP;
  const [bMain, bShade, bStripe] = bottom?.colors ?? PLACEHOLDER_BOTTOM;
  const [fStrap, fSole] = shoes?.colors ?? PLACEHOLDER_SHOES;
  const long = bottom?.kind === "long";
  const plain = top?.kind === "tee";
  return {
    o: OUTLINE, s: skin.s, S: skin.S, e: EYE, b: skin.b, m: skin.m,
    t: tMain, T: tShade, u: tHi, K: plain ? tMain : tDetail,
    // Scarf colours; without a scarf the band and front tails read as the shirt, side tails disappear.
    q: neck ? neck.colors[0] : tMain, Q: neck ? neck.colors[1] : tMain,
    r: neck ? neck.colors[0] : tMain, R: neck ? neck.colors[1] : tMain,
    v: neck ? neck.colors[0] : null, V: neck ? neck.colors[1] : null, n: neck ? OUTLINE : null,
    p: bMain, P: bShade, l: bStripe,
    j: long ? bShade : OUTLINE, g: long ? bMain : skin.s, G: long ? bShade : skin.S,
    f: fStrap, F: fSole,
    h: hair.h, H: hair.H,
  };
}

export function hatLayerFor(look: Look): { layer: Layer; palette: Palette } | null {
  const hat = artFor(look.hat, "hat");
  if (!hat) return null;
  return { layer: HATS[hat.shape], palette: { o: OUTLINE, ...hat.colors } };
}

/** 48 rows × 24 columns of CSS colours ("" = transparent). Layers: body → hair → hat; "right" mirrors "left". */
export function composeMatrix(look: Look, facing: Facing, frame: Frame): string[][] {
  const dir: Dir3 = facing === "right" ? "left" : facing;
  const m: string[][] = Array.from({ length: SPRITE_H }, () => new Array<string>(SPRITE_W).fill(""));
  const paint = (rows: readonly string[], top: number, pal: Palette) => {
    rows.forEach((row, i) => {
      const y = top + i;
      if (y < 0 || y >= SPRITE_H) return;
      for (let x = 0; x < SPRITE_W; x++) {
        const ch = row[x];
        if (ch === undefined || ch === ".") continue;
        const col = pal[ch];
        if (col) m[y][x] = col;
      }
    });
  };
  const pal = bodyPalette(look);
  paint(buildBody(dir, frame), 0, pal);
  const hair = (HAIR[look.hair] ?? HAIR.short)[dir];
  paint(hair.rows, hair.top, pal);
  const hat = hatLayerFor(look);
  if (hat) paint(hat.layer.rows, hat.layer.top, hat.palette);
  if (facing === "right") for (const row of m) row.reverse();
  return m;
}
