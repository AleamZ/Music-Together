import type { Facing, Gender, Look } from "@/lib/game/types";
import { HAIRPINS, NECKLACES, WRIST_ROW } from "./accessories";
import { GEO, POSES, ROW, buildBodyParts, type BodyOpts, type Lower, type Pose, type ShoeShape } from "./body";
import { GARMENT_ART, drawGarment, type GarmentArt, type GarmentLayers } from "./garments";
import { HAIR, SWAYING_HAIR } from "./hair";
import { HATS, HAT_CLIP } from "./hats";
import { ITEM_ART, type ItemArt } from "./items";
import { uniformArtFor } from "./uniforms";
import { EYE, EYE_SHINE, HAIR_COLOR, OUTLINE, SKIN, SOCK } from "./palettes";
import { R, SPRITE_H, SPRITE_W, type Dir3, type Frame, type Layer } from "./layers";

/** Region code → CSS colour; null = not drawn. */
export type Palette = Record<string, string | null>;

const PLACEHOLDER_TOP = ["#9aa0a8", "#7d838c", "#c3c7cc", "#7d838c"] as const;
const PLACEHOLDER_BOTTOM = ["#6b6f76", "#50545a", "#6b6f76"] as const;
const PLACEHOLDER_SHOES = ["#6b6f76", "#50545a"] as const;
/** Underwear (no top / no bottom): plain solid colours, modest cuts. [main, shade, stripe = main] */
export const BRIEF_NAM = ["#4a6fa5", "#35507a", "#4a6fa5"] as const;
export const BRIEF_NU = ["#e8e0f0", "#c8bcd8", "#e8e0f0"] as const;
/** nữ with no top: a sports-bra band over the chest (rows 22–25). */
export const BRA = ["#e8e0f0", "#c8bcd8"] as const;
export const BRA_ROWS = [22, 25] as const;

function artFor<S extends ItemArt["slot"]>(id: string | null | undefined, slot: S): Extract<ItemArt, { slot: S }> | null {
  if (!id) return null;
  const a = ITEM_ART[id];
  return a && a.slot === slot ? (a as Extract<ItemArt, { slot: S }>) : null;
}
function garmentFor(id: string | null | undefined, slot: GarmentArt["slot"], belt?: number | null): GarmentArt | null {
  if (!id) return null;
  const a = GARMENT_ART[id] ?? uniformArtFor(id, belt);                   // v20.2: the võ phục (v20.3: in the rank's belt)
  return a && a.slot === slot ? a : null;
}

/** A look's body type; looks saved before body types existed are "nam". */
export function genderOf(look: Look): Gender {
  return look.gender === "nu" ? "nu" : "nam";
}

// nữ extras drawn over the hair (under the hat): a small pink hair clip (codes c/C). Rosy lips come from the palette.
const LIPS_NU = "#d2566e";
const CLIP_PALETTE: Palette = { c: "#d23a67", C: "#ff9ec0" };
export const HAIR_CLIP: Record<Dir3, Layer> = {
  down: { top: 5, rows: [R(15, "cCc"), R(16, "c")] },
  left: { top: 5, rows: [R(12, "cCc"), R(13, "c")] },
  up: { top: 7, rows: [R(10, "cCCc"), R(11, "cc")] },
};

/** Stable cache key for a look. */
export function lookKey(look: Look): string {
  return [look.skin, look.hair, look.hairColor, look.hat ?? "-", look.top ?? "-", look.bottom ?? "-", look.shoes, look.neck ?? "-", genderOf(look), look.outfit ?? "-",
    look.wrist ?? "-", look.hairpin ?? "-", look.belt ?? "-"].join("|");
}

/** The old shoe items' shapes, by name (their art only has colours). */
function shoeShapeOf(id: string): ShoeShape {
  if (id.includes("sneaker")) return "sneakers";
  if (id.includes("boots")) return "boots";
  if (id.includes("oxford")) return "shoe";
  if (id.includes("sandal")) return "sandals";
  return "dep";
}

/** What is worn, resolved: the garments drawn (an outfit replaces top and bottom), the body options and the palette. */
export interface Wear { garments: GarmentArt[]; opts: BodyOpts; pal: Palette }

/** Colours for the body template and the hair layer (the look's plain items; garments are applied by `resolveWear`). */
export function bodyPalette(look: Look): Palette {
  const skin = SKIN[look.skin] ?? SKIN.warm;
  const hair = HAIR_COLOR[look.hairColor] ?? HAIR_COLOR.black;
  const top = artFor(look.top, "top");
  const bottom = artFor(look.bottom, "bottom");
  const shoes = artFor(look.shoes, "shoes");
  const neckArt = artFor(look.neck, "neck");
  const neck = neckArt && !neckArt.style ? neckArt : null; // a necklace is its own layer, not the scarf regions
  const nu = genderOf(look) === "nu";
  // nothing worn: the torso and sleeves are bare skin (nữ gets a band, see composeMatrix); the hips take underwear
  const [tMain, tShade, tHi, tDetail] = top?.colors ?? (look.top ? PLACEHOLDER_TOP : [skin.s, skin.S, skin.s, skin.s]);
  const [bMain, bShade, bStripe] = bottom?.colors ?? (look.bottom ? PLACEHOLDER_BOTTOM : nu ? BRIEF_NU : BRIEF_NAM);
  const [fStrap, fSole] = shoes?.colors ?? PLACEHOLDER_SHOES;
  const long = bottom?.kind === "long";
  const plain = top?.kind === "tee" || !look.top;
  return {
    i: BRA[0], I: BRA[1],
    o: OUTLINE, s: skin.s, S: skin.S, e: EYE, w: EYE_SHINE, b: skin.b, m: skin.m,
    t: tMain, T: tShade, u: tHi, K: plain ? tMain : tDetail, a: tMain, A: tShade,
    // Scarf colours; without a scarf the band and front tails read as the shirt, side tails disappear.
    q: neck ? neck.colors[0] : tMain, Q: neck ? neck.colors[1] : tMain,
    r: neck ? neck.colors[0] : tMain, R: neck ? neck.colors[1] : tMain,
    v: neck ? neck.colors[0] : null, V: neck ? neck.colors[1] : null, n: neck ? OUTLINE : null,
    p: bMain, P: bShade, l: bStripe,
    j: long || !look.bottom ? bShade : OUTLINE, g: long ? bMain : skin.s, G: long ? bShade : skin.S, k: long ? bMain : SOCK,
    f: fStrap, F: fSole,
    h: hair.h, H: hair.H, d: hair.d,
    ...(genderOf(look) === "nu" ? { m: LIPS_NU } : {}),
  };
}

const isDigit = (k: string) => k >= "0" && k <= "9";
/** A garment's colours for the body's regions (its digit codes stay with its own overlay). */
function applyColors(pal: Palette, art: GarmentArt): void {
  for (const [k, v] of Object.entries(art.colors)) if (!isDigit(k)) pal[k] = v;
}
/** A bottom region's leg colours: long trousers cover the legs, otherwise skin (and a hem line). */
function applyLegs(pal: Palette, look: Look, art: GarmentArt): void {
  const skin = SKIN[look.skin] ?? SKIN.warm;
  const long = !!art.long;
  pal.j = art.colors.j ?? (long ? pal.P : OUTLINE);
  pal.g = long ? pal.p : skin.s;
  pal.G = long ? pal.P : skin.S;
  pal.k = long ? pal.p : SOCK;
}

/** What the look wears below the hips: legs in trousers/shorts ("pants"), or a skirt/dress of some length. */
export function lowerOf(look: Look): Lower {
  return resolveWear(look).opts.lower ?? "pants";
}

/** The colours a seated rider's redrawn arms need, straight from the look's palette (not sampled from pixels, which
 *  long hair can cover): the sleeve (skin for a sleeveless top) and the skin. */
export function armColoursOf(look: Look): { sleeve: string; skin: string } {
  const { pal, opts } = resolveWear(look);
  const skin = pal.s ?? "#f2c7a0";
  return { sleeve: opts.sleeve === "none" ? skin : pal.a ?? skin, skin };
}

export function resolveWear(look: Look): Wear {
  const pal = bodyPalette(look);
  const gender = genderOf(look);
  const outfit = garmentFor(look.outfit, "outfit", look.belt);
  const top = outfit ? null : garmentFor(look.top, "top");
  const bottom = outfit ? null : garmentFor(look.bottom, "bottom");
  const shoes = garmentFor(look.shoes, "shoes");
  const opts: BodyOpts = { shoe: shoes?.body?.shoe ?? shoeShapeOf(look.shoes) };
  if (!outfit && !bottom) {
    const plain = artFor(look.bottom, "bottom");
    if (plain?.kind === "shorts" && (look.bottom?.includes("skirt") || gender === "nu")) opts.lower = "skirt";
    // nam's boxer briefs run down to mid-thigh (two leg rows and a hem); nữ's briefs end at the hips
    if (!look.bottom && gender === "nam") opts.thigh = 2;
  }
  const garments: GarmentArt[] = [];
  for (const art of [outfit, bottom, top]) {
    if (!art) continue;
    applyColors(pal, art);
    if (art.slot !== "top") applyLegs(pal, look, art);
    if (art.body?.lower) opts.lower = art.body.lower;
    if (art.body?.sleeve) opts.sleeve = art.body.sleeve;
    if (art.body?.thigh) opts.thigh = art.body.thigh;
    if (art.body?.cuff) opts.cuff = art.body.cuff;
    garments.push(art);
  }
  if (shoes) applyColors(pal, shoes);
  return { garments, opts, pal };
}

export function hatLayerFor(look: Look, dir: Dir3 = "down"): { layer: Layer; palette: Palette; clip: number } | null {
  const hat = artFor(look.hat, "hat");
  if (!hat) return null;
  return { layer: HATS[hat.shape][dir], palette: { o: OUTLINE, ...hat.colors }, clip: HAT_CLIP[hat.shape] };
}

type M = string[][];
const blank = (): M => Array.from({ length: SPRITE_H }, () => new Array<string>(SPRITE_W).fill(""));
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Paints code rows (row i at `top + i`); `onlyEmpty` paints behind what is already there. */
function paintRows(m: M, rows: readonly string[], top: number, pal: Palette, onlyEmpty = false): void {
  rows.forEach((row, i) => {
    const y = top + i;
    if (y < 0 || y >= SPRITE_H) return;
    for (let x = 0; x < SPRITE_W; x++) {
      const ch = row[x];
      if (ch === undefined || ch === ".") continue;
      const col = pal[ch];
      if (!col || (onlyEmpty && m[y][x])) continue;
      m[y][x] = col;
    }
  });
}
/** Paints a layer and traces a 1-px line around it, over whatever it borders (hair over the face draws the bangs'
 *  edge). `behind(y)` rows go only where nothing is drawn yet, and are left to the final silhouette pass. */
function paintOutlined(m: M, rows: readonly string[], top: (i: number) => number, pal: Palette, behind: (y: number) => boolean = () => false): void {
  const mine: boolean[][] = Array.from({ length: SPRITE_H }, () => new Array<boolean>(SPRITE_W).fill(false));
  const lines: [number, number][] = [];
  rows.forEach((row, i) => {
    const y = top(i);
    if (y < 0 || y >= SPRITE_H) return;
    for (let x = 0; x < SPRITE_W; x++) {
      const ch = row[x];
      if (ch === undefined || ch === ".") continue;
      const col = pal[ch];
      if (!col) continue;
      if (behind(y)) { if (!m[y][x]) m[y][x] = col; continue; }
      m[y][x] = col;
      mine[y][x] = true;
      if (ch !== "o") lines.push([x, y]);
    }
  });
  for (const [x, y] of lines) for (const [dx, dy] of N4) {
    const X = x + dx, Y = y + dy;
    if (X >= 0 && X < SPRITE_W && Y >= 0 && Y < SPRITE_H && !mine[Y][X] && !(behind(Y) && m[Y][X])) m[Y][X] = OUTLINE;
  }
}
/** The silhouette: a 1-px line in every empty pixel that touches a drawn one (outline pixels do not spread). */
function traceSilhouette(m: M): void {
  const add: [number, number][] = [];
  for (let y = 0; y < SPRITE_H; y++) for (let x = 0; x < SPRITE_W; x++) {
    if (m[y][x]) continue;
    for (const [dx, dy] of N4) {
      const c = m[y + dy]?.[x + dx];
      if (c && c !== OUTLINE) { add.push([x, y]); break; }
    }
  }
  for (const [x, y] of add) m[y][x] = OUTLINE;
}

function paintGarments(m: M, layers: GarmentLayers[], wear: Wear, which: keyof GarmentLayers, pose: Pose, onlyEmpty = false): void {
  layers.forEach((L, i) => {
    const pal = { ...wear.pal, ...wear.garments[i].colors };
    paintRows(m, L[which].rows(), which === "tip" ? pose.tip : pose.dy, pal, onlyEmpty);
  });
}

function accPalette(colors: readonly [string, string, string]): Palette {
  return { c: colors[0], C: colors[1], D: colors[2] };
}

/** A necklace over the collar (over a scarf too) and a wrist band that follows the arm's swing. */
function paintAccessoriesOnBody(m: M, look: Look, dir: Dir3, gender: Gender, pose: Pose): void {
  const neck = artFor(look.neck, "neck");
  if (neck?.style) {
    const L = NECKLACES[neck.style][dir];
    paintRows(m, L.rows, L.top + pose.dy, accPalette(neck.colors));
  }
  const wrist = artFor(look.wrist, "wrist");
  if (wrist) {
    const g = GEO[gender];
    const code = WRIST_ROW[wrist.kind];
    let x: number, y: number;
    if (dir === "left") {
      // the side arm's cuff row (see drawArmSide): rows[upper + 1], shifted by the full swing
      const upper = g.armLen - 4;
      x = 10 + pose.stride * 2 + 1;
      y = ROW.torso + 1 + pose.dy + upper + 1;
    } else {
      // the viewer's-left arm column: the character's right wrist from the front, the left one from the back
      const swing = dir === "down" ? pose.arm[0] : pose.arm[1];
      x = g.armL;
      y = ROW.torso + pose.dy + 1 + (g.armLen - 4 + swing);
    }
    paintRows(m, [R(x, code)], y, accPalette(wrist.colors));
  }
}

/** 48 rows × 24 columns of CSS colours ("" = transparent). Layers: body → garments → arms → hair → hat, then the
 *  silhouette line; "right" mirrors "left". The frame's pose moves the body (`dy`) and makes hair tips, skirt hems and
 *  loose garment parts lag a pixel (`tip`). */
export function composeMatrix(look: Look, facing: Facing, frame: Frame): string[][] {
  const dir: Dir3 = facing === "right" ? "left" : facing;
  const pose = POSES[frame] ?? POSES[0];
  const gender = genderOf(look);
  const wear = resolveWear(look);
  const pal = wear.pal;
  const m = blank();
  const body = buildBodyParts(dir, frame, gender, wear.opts);
  const layers = wear.garments.map((art) => drawGarment(art, dir, gender, pose));

  const bare = !look.outfit && !look.top;
  const base = gender === "nu" && bare
    ? body.base.map((r, y) => (y >= BRA_ROWS[0] + pose.dy && y <= BRA_ROWS[1] + pose.dy ? r.replace(/[tuKrRqQ]/g, "i").replace(/T/g, "I") : r))
    : body.base;
  paintRows(m, base, 0, pal);
  paintGarments(m, layers, wear, "under", pose);
  paintGarments(m, layers, wear, "tip", pose);
  // a scarf stays on top of the garment's collar
  if (look.neck && layers.length) paintRows(m, body.base.map((r) => r.replace(/[^qQrRvV]/g, ".")), 0, pal);
  paintRows(m, body.arms, 0, pal);
  paintGarments(m, layers, wear, "over", pose);
  paintAccessoriesOnBody(m, look, dir, gender, pose);
  traceSilhouette(m);
  paintGarments(m, layers, wear, "behind", pose, true);
  traceSilhouette(m);
  paintHeadwear(m, look, dir, gender, pal, pose);
  if (facing === "right") for (const row of m) row.reverse();
  return m;
}

/** v20 fight prototype (the chibi fighter, lib/game/fight/render/chibi.ts): the head alone — the bald head and face,
 *  the hair, the hairpin (or nữ's clip) and the hat — exactly as `composeMatrix` draws them in frame 0, for a painter
 *  that poses its own body. The chin line stays on row 20 (ROW.torso − 1); long hair keeps its tips below it. */
export function composeHeadMatrix(look: Look, facing: Facing): string[][] {
  const dir: Dir3 = facing === "right" ? "left" : facing;
  const gender = genderOf(look);
  const wear = resolveWear(look);
  const m = blank();
  paintRows(m, buildBodyParts(dir, 0, gender, wear.opts).base.slice(0, ROW.torso), 0, wear.pal);
  traceSilhouette(m);
  paintHeadwear(m, look, dir, gender, wear.pal, POSES[0]);
  if (facing === "right") for (const row of m) row.reverse();
  return m;
}

/** The hair (its loose tips lagging), the hairpin or nữ's clip and the hat over a painted body, then the silhouette. */
function paintHeadwear(m: M, look: Look, dir: Dir3, gender: Gender, pal: Palette, pose: Pose): void {
  const hair = (HAIR[look.hair] ?? HAIR.short)[dir];
  const hairRows = [...hair.rows];
  // only long hair, the ponytail and the braids have loose tips; the rest move stiffly with the head
  const sways = SWAYING_HAIR.has(look.hair);
  const hairY = hair.rows.map((_, i) => hair.top + i + (sways && hair.top + i >= ROW.lag ? pose.tip : pose.dy));
  // a lagging tip leaves no gap: the last head row is drawn at the tip offset too (in the same outlined layer)
  const gap = ROW.lag - 1 - hair.top;
  if (sways && pose.tip > pose.dy && gap >= 0 && gap < hair.rows.length) { hairRows.push(hair.rows[gap]); hairY.push(ROW.lag - 1 + pose.tip); }
  const behind = (y: number) => dir === "down" && y >= ROW.torso + pose.dy;
  paintOutlined(m, hairRows, (i) => hairY[i], pal, behind);
  const pin = artFor(look.hairpin, "hairpin");
  if (pin) {
    // a worn hairpin replaces nữ's default clip; bands lie flat on the hair (no line of their own)
    const L = HAIRPINS[pin.kind][dir];
    const pinPal = accPalette(pin.colors);
    if (pin.kind === "headband" || pin.kind === "bandana" || pin.kind === "tie") paintRows(m, L.rows, L.top + pose.dy, pinPal);
    else paintOutlined(m, L.rows, (i) => L.top + i + pose.dy, pinPal);
  } else if (gender === "nu") paintOutlined(m, HAIR_CLIP[dir].rows, (i) => HAIR_CLIP[dir].top + i + pose.dy, CLIP_PALETTE);
  const hat = hatLayerFor(look, dir);
  if (hat) {
    for (let y = 0; y < Math.min(SPRITE_H, hat.clip + pose.dy); y++) m[y].fill("");
    paintOutlined(m, hat.layer.rows, (i) => hat.layer.top + i + pose.dy, hat.palette);
  }
  traceSilhouette(m);
}
