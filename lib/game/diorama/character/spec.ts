import { genderOf, lookKey, resolveWear } from "@/lib/game/art/compose";
import type { Lower, ShoeShape, Sleeve } from "@/lib/game/art/body";
import type { HatShape } from "@/lib/game/art/hats";
import type { HairpinKind, NeckStyle, WristKind } from "@/lib/game/art/accessories";
import { ITEM_ART } from "@/lib/game/art/items";
import { HAIR_COLOR, SKIN } from "@/lib/game/art/palettes";
import { HAIR_STYLES, type Gender, type HairStyle, type Look } from "@/lib/game/types";
import { bodyKey, normalizeBody, type BodyShape } from "@/lib/game/body";
import { wear3d, type BottomKind, type HatKind, type NeckKind, type ShoeKind, type TopKind } from "./wear3d";

// Pure: a Look → the parts of a 3D chibi and their colours. It goes through the 2D compositor's own resolution
// (`resolveWear`: the same palette regions, sleeves, skirt lengths and shoe shapes), so every catalog item that the 2D
// sprite understands shows in 3D the same colours, and anything unknown falls back to the 2D placeholders.

const HEX = /^#[0-9a-f]{6}$/i;
/** A CSS colour → a safe `#rrggbb` (anything else → the fallback). */
export function hex(c: string | null | undefined, fallback: string): string {
  if (c && HEX.test(c)) return c.toLowerCase();
  if (c && /^#[0-9a-f]{3}$/i.test(c)) return ("#" + c[1] + c[1] + c[2] + c[2] + c[3] + c[3]).toLowerCase();
  return fallback;
}

export interface ChibiHat { shape: HatShape; kind: HatKind; main: string; shade: string; brim: string; accent: string }
export interface ChibiNeck { kind: "scarf" | NeckStyle; model: NeckKind; main: string; shade: string; accent: string }
export interface ChibiWrist { kind: WristKind; main: string; accent: string }
export interface ChibiHairpin { kind: HairpinKind; main: string; accent: string }

export interface ChibiSpec {
  key: string;
  gender: Gender;
  skin: string;
  skinShade: string;
  blush: string;
  mouth: string;
  hair: { style: HairStyle; main: string; hi: string; shade: string };
  /** Torso cloth (skin when nothing is worn), its shade and its collar/detail colour. */
  torso: string;
  torsoShade: string;
  detail: string;
  /** nữ with no top: a band over the chest. */
  band: string | null;
  sleeve: Sleeve;
  sleeveColor: string;
  lower: Lower;
  /** The hips/bottom cloth; the thighs and calves (cloth for long trousers, else skin). */
  bottom: string;
  bottomShade: string;
  thigh: string;
  calf: string;
  shoe: { shape: ShoeShape; kind: ShoeKind; main: string; sole: string };
  /** The dedicated 3D models of the worn top (or outfit) and bottom (wear3d.ts); null = none worn / plain. */
  top3d: TopKind | null;
  bottom3d: BottomKind | null;
  /** The garment's own trim colours (its codes 1–4: collars, stripes, bows, prints), with fallbacks. */
  trim: readonly [string, string, string, string];
  /** The bottom's stripe / print colour. */
  bottomTrim: string;
  /** A võ phục's belt. */
  belt: string | null;
  hat: ChibiHat | null;
  neck: ChibiNeck | null;
  wrist: ChibiWrist | null;
  hairpin: ChibiHairpin | null;
  /** The body proportions (Look.body, normalized; all 0 = the body type's defaults). */
  body: BodyShape;
}

const LOWERS: readonly Lower[] = ["pants", "skirt", "pleated", "maxi", "robe"];
const SHOES: readonly ShoeShape[] = ["dep", "shoe", "sneakers", "boots", "sandals"];
const SLEEVES: readonly Sleeve[] = ["long", "short", "none"];

function hatOf(id: string | null | undefined): ChibiHat | null {
  const a = id ? ITEM_ART[id] : undefined;
  if (!a || a.slot !== "hat") return null;
  const c = a.colors;
  const main = hex(c.x ?? c.y, "#8a8f98");
  const shade = hex(c.X ?? c.Y, main);
  const kind = wear3d(id, "hat") ?? (a.shape as HatKind);
  return { shape: a.shape, kind, main, shade, brim: hex(c.b ?? c.y, main), accent: hex(c.g ?? c.Z ?? c.B, shade) };
}

function neckOf(id: string | null | undefined): ChibiNeck | null {
  const a = id ? ITEM_ART[id] : undefined;
  if (!a || a.slot !== "neck") return null;
  const model: NeckKind = wear3d(id, "neck") ?? (a.style ?? "scarf");
  if (!a.style) return { kind: "scarf", model, main: hex(a.colors[0], "#f1ece0"), shade: hex(a.colors[1], "#2b2524"), accent: hex(a.colors[1], "#2b2524") };
  return { kind: a.style, model, main: hex(a.colors[0], "#e8c43a"), shade: hex(a.colors[1], "#b08a20"), accent: hex(a.colors[2], "#3f9b43") };
}

function wristOf(id: string | null | undefined): ChibiWrist | null {
  const a = id ? ITEM_ART[id] : undefined;
  if (!a || a.slot !== "wrist") return null;
  return { kind: a.kind, main: hex(a.colors[0], "#8b5a33"), accent: hex(a.colors[2], "#e8c43a") };
}

function hairpinOf(id: string | null | undefined): ChibiHairpin | null {
  const a = id ? ITEM_ART[id] : undefined;
  if (!a || a.slot !== "hairpin") return null;
  return { kind: a.kind, main: hex(a.colors[0], "#d23a67"), accent: hex(a.colors[2], "#ffffff") };
}

/** The belt colour of a worn võ phục (the garment's code "1", already in the wearer's rank colour). */
function beltOf(look: Look): string | null {
  if (!look.outfit?.startsWith("vp_")) return null;                              // only a võ phục has a belt (code 1 is a trim elsewhere)
  const { garments } = resolveWear(look);
  for (const g of garments) if (g.slot === "outfit" && g.colors["1"]) return hex(g.colors["1"], "#f6f6f2");
  return null;
}

const SHOE_KIND: Record<ShoeShape, ShoeKind> = { dep: "dep", shoe: "oxford", sneakers: "sneakers", boots: "boots", sandals: "sandals" };

/** A worn garment's trim colours: a fashion model's codes 1–4, or an item's highlight and detail colours. */
function trimOf(look: Look, detail: string): readonly [string, string, string, string] {
  const { garments } = resolveWear(look);
  const g = garments.find((x) => x.slot === "outfit") ?? garments.find((x) => x.slot === "top");
  if (g) {
    const c = g.colors;
    const a = hex(c["1"] ?? c.K ?? c.u, detail);
    return [a, hex(c["2"], a), hex(c["3"], a), hex(c["4"], a)];
  }
  const it = look.top ? ITEM_ART[look.top] : undefined;
  if (it && it.slot === "top") return [hex(it.colors[3], detail), hex(it.colors[2], detail), hex(it.colors[1], detail), hex(it.colors[2], detail)];
  return [detail, detail, detail, detail];
}

function bottomTrimOf(look: Look, bottom: string): string {
  const it = look.bottom ? ITEM_ART[look.bottom] : undefined;
  return it && it.slot === "bottom" ? hex(it.colors[2], bottom) : bottom;
}

const specCache = new Map<string, ChibiSpec>();
const MAX_SPECS = 2000;

/** The chibi's parts for a look (cached by the 2D look key plus the body proportions). Never throws: unknown ids fall
 *  back to placeholders. */
export function chibiSpec(look: Look): ChibiSpec {
  const bk = bodyKey(look.body, genderOf(look));
  const key = bk ? `${lookKey(look)}|b${bk}` : lookKey(look);
  const hit = specCache.get(key);
  if (hit) return hit;
  const spec = buildSpec(look, key);
  if (specCache.size >= MAX_SPECS) specCache.clear();
  specCache.set(key, spec);
  return spec;
}

function buildSpec(look: Look, key: string): ChibiSpec {
  const gender = genderOf(look);
  const skinP = SKIN[look.skin] ?? SKIN.warm;
  const hairP = HAIR_COLOR[look.hairColor] ?? HAIR_COLOR.black;
  const { pal, opts } = resolveWear(look);
  const skin = hex(pal.s ?? skinP.s, "#f2c7a0");
  const skinShade = hex(pal.S ?? skinP.S, skin);
  const style: HairStyle = HAIR_STYLES.includes(look.hair) ? look.hair : "short";
  const sleeve: Sleeve = SLEEVES.includes(opts.sleeve as Sleeve) ? (opts.sleeve as Sleeve) : "long";
  const lower: Lower = LOWERS.includes(opts.lower as Lower) ? (opts.lower as Lower) : "pants";
  const shape: ShoeShape = SHOES.includes(opts.shoe as ShoeShape) ? (opts.shoe as ShoeShape) : "dep";
  const noTop = !look.top && !look.outfit;
  const bottom = hex(pal.p, "#6b6f76");
  const thighCloth = !!opts.thigh && opts.thigh > 0;
  const calf = hex(pal.g, skin);
  return {
    key,
    gender,
    skin, skinShade,
    blush: hex(pal.b ?? skinP.b, skinShade),
    mouth: hex(pal.m ?? skinP.m, "#b35f4a"),
    hair: { style, main: hex(pal.h ?? hairP.h, "#2a2230"), hi: hex(pal.H ?? hairP.H, "#4a4258"), shade: hex(pal.d ?? hairP.d, "#16111a") },
    torso: hex(pal.t, skin),
    torsoShade: hex(pal.T, skinShade),
    detail: hex(pal.K ?? pal.t, skin),
    band: noTop && gender === "nu" ? hex(pal.i, "#e8e0f0") : null,
    sleeve,
    sleeveColor: sleeve === "none" ? skin : hex(pal.a, skin),
    lower,
    bottom,
    bottomShade: hex(pal.P, bottom),
    // shorts: the thigh in the bottom's cloth (knee-length ones and briefs down to mid-thigh) or skin; long: the cloth
    thigh: calf !== skin || thighCloth ? (calf !== skin ? calf : bottom) : skin,
    calf,
    shoe: { shape, kind: wear3d(look.shoes, "shoes") ?? SHOE_KIND[shape], main: hex(pal.f, "#6b6f76"), sole: hex(pal.F, "#50545a") },
    top3d: look.outfit && wear3d(look.outfit, "outfit") ? wear3d(look.outfit, "outfit") : look.top && !noTop ? wear3d(look.top, "top") ?? "tee" : null,
    bottom3d: wear3d(look.bottom, "bottom"),
    trim: trimOf(look, hex(pal.K ?? pal.t, skin)),
    bottomTrim: bottomTrimOf(look, bottom),
    belt: beltOf(look),
    hat: hatOf(look.hat),
    neck: neckOf(look.neck),
    wrist: wristOf(look.wrist),
    hairpin: hairpinOf(look.hairpin),
    body: normalizeBody(look.body, gender),
  };
}
