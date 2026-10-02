import type { Gender } from "@/lib/game/types";
import { GEO, ROW, skirtSpan, type BodyOpts, type Geo, type Pose } from "./body";
import { SPRITE_H, SPRITE_W, type Dir3 } from "./layers";

// The fashion models (fashion-models-contract.md): garments with their own silhouettes, not recolours. Each one is
//   - colours for the body's regions (t/T/u/K top, a/A sleeves, p/P/l bottom, f/F shoes, …) and for its own codes
//     (digits 1–9),
//   - body options (sleeve length, skirt or robe instead of trousers, knee-length shorts, rolled cuffs, a shoe shape),
//   - and a `draw` that adds its own pieces on four layers, in unposed coordinates (compose.ts moves them with the pose):
//       behind: only where nothing else is drawn (a hood behind the neck, a back flap between the legs);
//       under:  over the torso, under the arms (collars, pockets, a bib, a coat's hem), moves with the body;
//       tip:    the loose parts that lag a pixel behind the body while walking (áo dài flaps, kimono sleeves);
//       over:   over the arms (puffer sleeves).
// Slots: "top" replaces the top, "bottom" the bottom, "shoes" the shoes. An "outfit" is full-body: while worn, the
// look's top and bottom are kept but not drawn (the outfit brings its own colours for both regions).

export type GarmentSlot = "top" | "bottom" | "outfit" | "shoes";
export interface GarmentCtx { dir: Dir3; gender: Gender; pose: Pose; g: Geo }

/** A layer being drawn: a 24×48 grid of region codes ("." = nothing). */
export class Pix {
  readonly g: string[][] = Array.from({ length: SPRITE_H }, () => new Array<string>(SPRITE_W).fill("."));
  set(x: number, y: number, c: string): void {
    if (x >= 0 && x < SPRITE_W && y >= 0 && y < SPRITE_H) this.g[y][x] = c;
  }
  h(x0: number, x1: number, y: number, c: string): void { for (let x = x0; x <= x1; x++) this.set(x, y, c); }
  v(x: number, y0: number, y1: number, c: string): void { for (let y = y0; y <= y1; y++) this.set(x, y, c); }
  rect(x0: number, y0: number, x1: number, y1: number, c: string): void { for (let y = y0; y <= y1; y++) this.h(x0, x1, y, c); }
  rows(): string[] { return this.g.map((r) => r.join("")); }
}
export interface GarmentLayers { behind: Pix; under: Pix; tip: Pix; over: Pix }

export interface GarmentArt {
  slot: GarmentSlot;
  gender: Gender | "unisex";
  colors: Record<string, string>;
  body?: BodyOpts;
  /** Bottoms and outfits: the legs are covered in the bottom's colours. */
  long?: boolean;
  draw?: (c: GarmentCtx, L: GarmentLayers) => void;
}

// ---- helpers (front/back columns come from the body type's geometry; the side view's torso is columns 8–15) ----

export function span(c: GarmentCtx, y: number): [number, number] {
  if (c.dir === "left") return [8, 15];
  const g = c.g;
  if (y <= ROW.torso + 2) return [g.tL, g.tR];
  if (c.gender === "nu" && (y === 26 || y === 27)) return [g.wL, g.wR];
  return [g.bL, g.bR];
}
/** A coat hem hanging `n` rows over the hips, a pixel wider than them, shaded on the right, darker last row. */
function hemExt(c: GarmentCtx, p: Pix, n: number, main = "t", shade = "T"): void {
  const [l, r] = c.dir === "left" ? [7, 16] : [c.g.hL - 1, c.g.hR + 1];
  for (let i = 0; i < n; i++) {
    const y = ROW.hips + i;
    p.h(l, r, y, i === n - 1 ? shade : main);
    p.set(r, y, shade);
  }
}
/** A hood lying behind the neck: seen from the front it frames the chin, from the side it bulges behind the neck. */
function hoodBehind(c: GarmentCtx, p: Pix, main = "t", shade = "T"): void {
  if (c.dir === "down") {
    p.rect(c.g.tL - 1, 17, c.g.tR + 1, 21, main);
    p.v(c.g.tR + 1, 17, 21, shade);
  } else if (c.dir === "left") {
    p.rect(14, 17, 17, 22, main);
    p.v(17, 18, 22, shade);
  }
}
/** A hood hanging down the back (back view). */
function hoodBack(c: GarmentCtx, p: Pix, shade = "T", rim = "u"): void {
  const mid = Math.round((c.g.tL + c.g.tR) / 2);
  p.h(mid - 5, mid + 4, 21, rim);
  p.rect(mid - 4, 22, mid + 3, 24, shade);
  p.h(mid - 3, mid + 2, 25, shade);
  p.h(mid - 2, mid + 1, 26, "o");
  p.set(mid - 5, 22, "o"); p.set(mid + 4, 22, "o");
  p.v(mid - 5, 23, 24, "o"); p.v(mid + 4, 23, 24, "o");
}
/** The side view's flap swing: +1 near leg forward swings a flap back (right), and the other way. */
const sway = (c: GarmentCtx) => (c.dir === "left" ? c.pose.stride : 0);

// digits: 1–9 are each garment's own colours (see `colors`)
export const GARMENT_ART: Record<string, GarmentArt> = {
  fm_hoodie: {
    slot: "top", gender: "unisex",
    colors: { t: "#9b8bd0", T: "#7564ad", u: "#c2b6ea", K: "#9b8bd0", a: "#9b8bd0", A: "#7564ad", 1: "#f6f2ea", 2: "#5d4e92" },
    draw(c, L) {
      if (c.dir === "up") { hoodBack(c, L.under); L.under.h(c.g.tL, c.g.tR, 30, "2"); return; }
      hoodBehind(c, L.behind);
      if (c.dir === "left") {
        L.under.h(8, 13, 21, "u");
        L.under.v(8, 22, 25, "1"); L.under.set(8, 26, "2");
        L.under.rect(8, 27, 11, 29, "T"); L.under.h(8, 11, 27, "o");
        L.under.h(8, 15, 30, "2");
        return;
      }
      const [l, r] = span(c, 28);
      L.under.h(c.g.tL, c.g.tR, 21, "u");
      L.under.h(c.g.tL + 1, c.g.tR - 1, 22, "T");
      L.under.h(10, 13, 22, "t");
      L.under.v(10, 23, 26, "1"); L.under.v(13, 23, 26, "1");
      L.under.set(10, 27, "2"); L.under.set(13, 27, "2");
      L.under.h(l + 2, r - 2, 27, "o");
      L.under.rect(l + 2, 28, r - 2, 29, "T");
      L.under.set(l + 2, 28, "o"); L.under.set(r - 2, 28, "o");
      L.under.h(c.g.tL, c.g.tR, 30, "2");
    },
  },
  fm_denim_jacket: {
    slot: "top", gender: "unisex",
    colors: { t: "#5079b3", T: "#3a5b8f", u: "#77a0d6", K: "#e0b44c", a: "#5079b3", A: "#3a5b8f", 1: "#f6f2ea", 2: "#d6cfc0" },
    draw(c, L) {
      const u = L.under;
      if (c.dir === "up") {
        u.h(c.g.tL, c.g.tR, 21, "u");
        u.h(c.g.tL, c.g.tR, 24, "T");
        u.set(9, 27, "K"); u.set(14, 27, "K");
        u.h(c.g.tL, c.g.tR, 30, "K");
        return;
      }
      if (c.dir === "left") {
        u.h(8, 12, 21, "u"); u.set(8, 22, "u");
        u.v(8, 23, 30, "1"); u.v(9, 22, 30, "o");
        u.h(10, 12, 24, "T"); u.set(11, 25, "K");
        u.h(9, 15, 30, "K");
        return;
      }
      u.rect(10, 22, 13, 30, "1"); u.v(13, 22, 30, "2");
      u.v(9, 22, 30, "o"); u.v(14, 22, 30, "o");
      u.h(c.g.tL, 9, 21, "u"); u.h(14, c.g.tR, 21, "u");
      u.set(8, 22, "u"); u.set(15, 22, "u");
      const [l, r] = span(c, 24);
      u.h(l + 1, 8, 24, "T"); u.h(15, r - 1, 24, "T");
      u.set(l + 2, 25, "K"); u.set(r - 2, 25, "K");
      u.h(l, 8, 30, "K"); u.h(15, r, 30, "K");
    },
  },
  fm_school_shirt: {
    slot: "top", gender: "unisex", body: { sleeve: "short" },
    colors: { t: "#f8f8f5", T: "#d3d7de", u: "#ffffff", K: "#b9bec8", a: "#f8f8f5", A: "#d3d7de", 1: "#cf3a3a", 2: "#8e2525" },
    draw(c, L) {
      const u = L.under;
      if (c.dir === "up") { u.h(c.g.tL + 2, c.g.tR - 2, 21, "u"); u.h(c.g.tL + 2, c.g.tR - 2, 22, "o"); return; }
      if (c.dir === "left") {
        u.set(8, 21, "u"); u.set(8, 22, "u"); u.set(9, 22, "o");
        if (c.gender === "nam") { u.v(8, 23, 27, "1"); u.set(8, 28, "2"); }
        else { u.set(7, 23, "1"); u.set(8, 23, "2"); u.set(8, 24, "1"); }
        u.v(10, 25, 29, "K");
        return;
      }
      u.h(9, 14, 21, "u"); u.set(9, 22, "u"); u.set(10, 22, "o"); u.set(14, 22, "u"); u.set(13, 22, "o");
      if (c.gender === "nam") {
        u.set(11, 21, "2"); u.set(12, 21, "2");
        u.v(11, 22, 27, "1"); u.v(12, 22, 26, "2"); u.set(11, 28, "2");
        const [l] = span(c, 24);
        u.h(l + 1, l + 3, 24, "K"); u.v(l + 1, 25, 26, "K"); u.v(l + 3, 25, 26, "K");
      } else {
        u.h(9, 10, 22, "1"); u.h(11, 12, 22, "2"); u.h(13, 14, 22, "1");
        u.set(9, 23, "1"); u.set(14, 23, "1"); u.set(10, 24, "1"); u.set(13, 24, "1");
        for (const y of [25, 27, 29]) u.set(11, y, "K");
      }
    },
  },
  fm_ao_dai: {
    slot: "outfit", gender: "nu", long: true, body: { sleeve: "long" },
    colors: { t: "#d8435f", T: "#a92c47", u: "#f27e95", K: "#f4c542", a: "#d8435f", A: "#a92c47", p: "#fbf7ef", P: "#ddd6c8", l: "#fbf7ef", 1: "#f4c542", 2: "#a92c47" },
    draw(c, L) {
      const u = L.under, tip = L.tip;
      const flap = (p: Pix, x0: number, x1: number, flowers: boolean) => {
        // starts a row above the hips so a lagging flap (drawn a pixel lower) leaves no gap under the bodice
        for (let y = ROW.hips - 1; y <= 41; y++) { p.h(x0, x1, y, "t"); p.set(x0, y, "u"); p.set(x1, y, "T"); }
        p.h(x0, x1, 41, "T");
        if (flowers) { p.set(x0 + 2, 36, "1"); p.set(x0 + 3, 35, "1"); p.set(x0 + 3, 37, "1"); p.set(x1 - 2, 39, "1"); }
      };
      if (c.dir === "left") {
        u.h(8, 12, 21, "K"); u.h(8, 12, 20, "t");
        const s = sway(c);
        flap(tip, 13 + Math.max(0, s), 16 + Math.max(0, s), false);
        flap(tip, 7 + Math.min(0, s), 10 + Math.min(0, s), true);
        return;
      }
      u.h(9, 14, 20, "t"); u.h(9, 14, 21, "K");
      if (c.dir === "down") {
        for (let i = 0; i < 4; i++) u.set(13 + i, 22 + i, "K");
        u.set(8, 26, "1"); u.set(9, 27, "1"); u.set(8, 28, "1");
        L.behind.rect(c.g.hL, 36, c.g.hR, 41, "T");
        flap(tip, c.g.wL, c.g.wR, true);
      } else {
        flap(tip, c.g.wL, c.g.wR, false);
      }
    },
  },
  fm_ao_ba_ba: {
    slot: "top", gender: "unisex",
    colors: { t: "#3e5180", T: "#2c3b5f", u: "#5a70a2", K: "#dccba4", a: "#3e5180", A: "#2c3b5f", 1: "#dccba4" },
    draw(c, L) {
      const u = L.under;
      hemExt(c, u, 2);
      if (c.dir === "left") { u.h(9, 13, 21, "T"); for (const y of [23, 26, 29]) u.set(8, y, "1"); return; }
      u.h(9, 14, 21, "T");
      if (c.dir === "up") return;
      u.v(11, 22, 32, "o");
      for (const y of [23, 26, 29]) u.set(12, y, "1");
      const [l, r] = span(c, 28);
      u.h(l + 1, l + 3, 28, "T"); u.h(r - 3, r - 1, 28, "T");
      u.h(l + 1, l + 3, 29, "u"); u.h(r - 3, r - 1, 29, "u");
      u.set(c.g.hL - 1, 32, "o"); u.set(c.g.hR + 1, 32, "o");
    },
  },
  fm_sailor_top: {
    slot: "top", gender: "unisex", body: { sleeve: "short" },
    colors: { t: "#f7f7f2", T: "#d2d6de", u: "#ffffff", K: "#f7f7f2", a: "#f7f7f2", A: "#23407a", 1: "#23407a", 2: "#ffffff", 3: "#d63c50", 4: "#99233a" },
    draw(c, L) {
      const u = L.under;
      if (c.dir === "up") {
        u.rect(c.g.tL + 1, 21, c.g.tR - 1, 25, "1");
        u.h(c.g.tL + 2, c.g.tR - 2, 24, "2");
        u.v(c.g.tL + 2, 21, 24, "2"); u.v(c.g.tR - 2, 21, 24, "2");
        u.h(c.g.tL + 1, c.g.tR - 1, 26, "o");
        return;
      }
      if (c.dir === "left") {
        u.rect(13, 21, 16, 24, "1"); u.v(14, 21, 23, "2"); u.h(13, 16, 25, "o");
        u.h(8, 12, 21, "1");
        u.set(7, 24, "3"); u.set(8, 24, "4"); u.set(7, 25, "3");
        return;
      }
      for (let i = 0; i < 5; i++) {
        const y = 21 + i;
        u.h(c.g.tL + i, c.g.tL + i + 3, y, "1"); u.set(c.g.tL + i + 3, y, "2");
        u.h(c.g.tR - i - 3, c.g.tR - i, y, "1"); u.set(c.g.tR - i - 3, y, "2");
      }
      u.h(11, 12, 25, "4"); u.set(10, 25, "3"); u.set(13, 25, "3");
      u.set(10, 26, "3"); u.set(13, 26, "3"); u.set(10, 27, "4"); u.set(13, 27, "4");
    },
  },
  fm_varsity: {
    slot: "top", gender: "unisex",
    colors: { t: "#1f2f5c", T: "#141f40", u: "#f2e6c8", K: "#f2e6c8", a: "#f2e6c8", A: "#c8323c", 1: "#c8323c", 2: "#f2e6c8" },
    draw(c, L) {
      const u = L.under;
      const [l0, r0] = c.dir === "left" ? [8, 15] : [c.g.tL, c.g.tR];
      u.h(l0, r0, 21, "1"); u.h(l0 + 1, r0 - 1, 21, "2");
      u.h(l0, r0, 29, "2"); u.h(l0, r0, 30, "1");
      if (c.dir === "up") { u.rect(9, 23, 14, 26, "1"); u.h(10, 13, 24, "2"); u.set(9, 23, "t"); u.set(14, 23, "t"); return; }
      if (c.dir === "left") { for (const y of [23, 25, 27]) u.set(8, y, "K"); return; }
      u.v(11, 22, 30, "o");
      for (const y of [23, 25, 27]) u.set(12, y, "K");
      const [l] = span(c, 24);
      u.rect(l + 1, 24, l + 3, 26, "1"); u.set(l + 2, 26, "t"); u.set(l + 2, 24, "2");
    },
  },
  fm_cardigan: {
    slot: "top", gender: "unisex",
    colors: { t: "#e3a4b6", T: "#c58398", u: "#f3c9d4", K: "#fbf6ec", a: "#e3a4b6", A: "#c58398", 1: "#fbf6ec", 2: "#dcd4c4" },
    draw(c, L) {
      const u = L.under;
      hemExt(c, u, 2);
      const knit = (x0: number, x1: number) => {
        for (let y = 23; y <= 29; y += 2) for (let x = x0 + ((y >> 1) & 1); x <= x1; x += 3) u.set(x, y, "T");
      };
      if (c.dir === "up") { knit(c.g.bL + 1, c.g.bR - 1); return; }
      if (c.dir === "left") { u.v(8, 21, 23, "1"); u.v(9, 21, 23, "o"); u.v(8, 24, 32, "o"); u.set(9, 26, "K"); u.set(9, 29, "K"); return; }
      for (let i = 0; i < 4; i++) { u.h(9 + i, 14 - i, 21 + i, "1"); u.set(9 + i, 21 + i, "o"); u.set(14 - i, 21 + i, "o"); }
      u.v(12, 21, 23, "2");
      u.v(12, 25, 32, "o");
      for (const y of [26, 28, 30]) u.set(11, y, "K");
      knit(c.g.bL + 1, 10); knit(14, c.g.bR - 1);
    },
  },
  fm_tank_top: {
    slot: "top", gender: "unisex", body: { sleeve: "none" },
    colors: { t: "#3a9d8f", T: "#2a766b", u: "#6cc4b7", K: "#3a9d8f", 1: "#2a766b" },
    draw(c, L) {
      const u = L.under;
      if (c.dir === "left") { u.h(8, 9, 21, "s"); u.set(8, 22, "s"); u.set(10, 22, "o"); u.h(8, 15, 30, "1"); return; }
      const { tL, tR } = c.g;
      for (let y = 21; y <= 23; y++) { u.h(tL, tL + 1, y, "s"); u.h(tR - 1, tR, y, "S"); u.set(tL + 2, y, "o"); u.set(tR - 2, y, "o"); }
      u.h(tL + 4, tR - 4, 21, "s");
      if (c.dir === "down") { u.h(tL + 5, tR - 5, 22, "s"); u.h(tL + 5, tR - 5, 23, "o"); u.set(tL + 4, 22, "o"); u.set(tR - 4, 22, "o"); }
      else u.h(tL + 4, tR - 4, 22, "o");
      u.h(c.g.bL, c.g.bR, 30, "1");
    },
  },
  fm_raincoat: {
    slot: "top", gender: "unisex",
    colors: { t: "#f2c230", T: "#c99a1c", u: "#fbe07a", K: "#6b4a1c", a: "#f2c230", A: "#c99a1c", 1: "#6b4a1c" },
    draw(c, L) {
      hoodBehind(c, L.behind);
      if (c.dir === "up") hoodBack(c, L.under);
      hemExt(c, L.under, 3);
      // the coat's skirt: three more rows, wider, lagging behind the body
      const [l, r] = c.dir === "left" ? [7 + Math.min(0, sway(c)), 17 + Math.max(0, sway(c))] : [c.g.hL - 2, c.g.hR + 2];
      for (let y = ROW.hips + 2; y <= ROW.hips + 6; y++) { L.tip.h(l, r, y, "t"); L.tip.set(r, y, "T"); }
      L.tip.h(l, r, ROW.hips + 6, "T");
      if (c.dir === "down") {
        L.under.v(11, 22, 33, "o"); L.tip.v(11, 33, 37, "o");
        for (const y of [23, 26, 29, 32]) { L.under.set(12, y, "1"); L.under.set(10, y, "1"); }
        L.under.h(c.g.tL, c.g.tR, 21, "u");
      } else if (c.dir === "left") {
        L.under.h(8, 13, 21, "u");
        for (const y of [23, 26, 29]) L.under.set(8, y, "1");
      }
    },
  },
  fm_kimono: {
    slot: "outfit", gender: "unisex", long: true, body: { lower: "robe", sleeve: "long" },
    colors: { t: "#2f5d8a", T: "#22466a", u: "#4f7fb0", K: "#2f5d8a", a: "#2f5d8a", A: "#22466a", p: "#2f5d8a", P: "#22466a", l: "#22466a", 1: "#c8323c", 2: "#8e2230", 3: "#f4ecd8", 4: "#9fc3e6" },
    draw(c, L) {
      const u = L.under;
      const [l, r] = span(c, 28);
      u.h(l, r, 27, "2"); u.h(l, r, 28, "1"); u.h(l, r, 29, "2");
      const sleeve = (x0: number, x1: number) => {
        for (let y = 22; y <= 28; y++) { L.tip.h(x0, x1, y, "t"); L.tip.set(x1, y, "T"); }
        L.tip.h(x0, x1, 28, "T");
      };
      if (c.dir === "left") {
        u.set(8, 21, "3"); u.set(8, 22, "3"); u.set(9, 21, "3"); u.v(8, 23, 26, "o");
        u.rect(15, 26, 17, 29, "1"); u.v(17, 26, 29, "2");
        const s = sway(c);
        sleeve(10 + 2 * s, 13 + 2 * s);
        for (const y of [33, 37, 40]) u.set(11, y, "4");
        return;
      }
      sleeve(c.g.armL - 1, c.g.armL + 1);
      sleeve(c.g.armR, c.g.armR + 2);
      if (c.dir === "up") {
        u.h(10, 13, 21, "3");
        u.rect(9, 26, 14, 30, "1"); u.v(9, 26, 30, "2"); u.v(14, 26, 30, "2"); u.h(11, 12, 28, "2");
        return;
      }
      for (let i = 0; i < 6; i++) { u.set(15 - i, 21 + i, "3"); u.set(14 - i, 21 + i, "3"); }
      for (let i = 0; i < 3; i++) u.set(8 + i, 21 + i, "3");
      u.v(9, 30, 42, "T");
      for (const [x, y] of [[13, 33], [15, 36], [12, 38], [14, 41], [c.g.hL + 1, 35]] as const) u.set(x, y, "4");
    },
  },
  fm_jersey: {
    slot: "top", gender: "unisex", body: { sleeve: "short" },
    colors: { t: "#d32f2f", T: "#a52323", u: "#f4d03f", K: "#d32f2f", a: "#d32f2f", A: "#f4d03f", 1: "#f4d03f", 2: "#ffffff" },
    draw(c, L) {
      const u = L.under;
      if (c.dir === "up") {
        u.h(c.g.tL + 2, c.g.tR - 2, 21, "u");
        u.h(9, 14, 22, "2");
        u.v(9, 24, 29, "1"); u.set(8, 25, "1");
        u.rect(11, 24, 14, 29, "1"); u.rect(12, 25, 13, 28, "t");
        return;
      }
      if (c.dir === "left") { u.h(8, 12, 21, "u"); u.v(12, 23, 29, "2"); u.v(9, 24, 26, "1"); return; }
      u.h(9, 14, 21, "u"); u.h(11, 12, 21, "s"); u.h(11, 12, 22, "u");
      const [l, r] = span(c, 25);
      const x = r - 5;
      u.v(x, 24, 27, "1"); u.set(x - 1, 25, "1");
      u.rect(x + 2, 24, x + 4, 27, "1"); u.v(x + 3, 25, 26, "t");
      u.v(l, 24, 29, "2"); u.v(r, 24, 29, "2");
    },
  },
  fm_chef_coat: {
    slot: "top", gender: "unisex",
    colors: { t: "#fbfbf8", T: "#d8dbe0", u: "#ffffff", K: "#3a3a3a", a: "#fbfbf8", A: "#d8dbe0", 1: "#2f6fb0" },
    draw(c, L) {
      const u = L.under;
      hemExt(c, u, 3);
      if (c.dir === "left") { u.h(8, 13, 21, "u"); u.h(8, 13, 20, "o"); for (const y of [23, 26, 29]) u.set(9, y, "K"); u.set(7, 22, "1"); return; }
      u.h(9, 14, 21, "u"); u.h(9, 14, 20, "o");
      if (c.dir === "up") return;
      u.h(11, 12, 21, "1"); u.set(11, 22, "1");
      for (const y of [23, 26, 29]) { u.set(9, y, "K"); u.set(14, y, "K"); }
      for (let y = 22; y <= 33; y++) u.set(y < 25 ? 16 - (y - 22) : 13, y, "o");
    },
  },
  fm_suit: {
    slot: "top", gender: "unisex",
    colors: { t: "#2e3440", T: "#1f242d", u: "#4a5263", K: "#11141a", a: "#2e3440", A: "#f5f5f0", 1: "#f5f5f0", 2: "#b3262f", 3: "#e8c3c7" },
    draw(c, L) {
      const u = L.under;
      hemExt(c, u, 2);
      if (c.dir === "up") { u.v(11, 23, 32, "T"); u.h(c.g.tL + 2, c.g.tR - 2, 21, "T"); return; }
      if (c.dir === "left") { u.v(8, 21, 24, "1"); u.v(9, 21, 25, "u"); u.set(9, 26, "o"); u.set(9, 28, "K"); return; }
      for (let i = 0; i < 6; i++) {
        const y = 21 + i, a = 9 + Math.floor(i / 2), b = 14 - Math.floor(i / 2);
        u.h(a, b, y, "1");
        u.set(a - 1, y, "u"); u.set(b + 1, y, "u");
      }
      if (c.gender === "nam") { u.h(11, 12, 21, "2"); u.v(11, 22, 26, "2"); u.v(12, 22, 25, "2"); }
      else { u.set(11, 22, "3"); u.set(12, 22, "3"); }
      u.v(11, 27, 32, "o"); u.set(12, 28, "K"); u.set(12, 30, "K");
      const [, r] = span(c, 24);
      u.set(r - 2, 24, "3"); u.set(r - 1, 24, "3");
      const [l2, r2] = span(c, 30);
      u.h(l2 + 1, l2 + 3, 30, "T"); u.h(r2 - 3, r2 - 1, 30, "T");
    },
  },
  fm_puffer: {
    slot: "top", gender: "unisex",
    colors: { t: "#e86a3a", T: "#b8492a", u: "#f7a06f", K: "#b8492a", a: "#e86a3a", A: "#b8492a", 1: "#b8492a" },
    draw(c, L) {
      const u = L.under;
      hemExt(c, u, 1);
      if (c.dir === "left") {
        for (let y = 22; y <= 30; y++) u.set(7, y, y % 2 ? "t" : "1");
        for (const y of [23, 25, 27, 29]) u.h(8, 15, y, "1");
        u.h(8, 14, 21, "u"); u.h(9, 13, 20, "t");
        for (let y = 23; y <= 27; y++) L.over.set(9 + 2 * c.pose.stride * (y >= 25 ? 1 : 0), y, y % 2 ? "1" : "t");
        return;
      }
      u.h(c.g.tL, c.g.tR, 21, "u"); u.h(9, 14, 20, "t");
      for (const y of [23, 25, 27, 29]) { const [l, r] = span(c, y); u.h(l, r, y, "1"); }
      if (c.dir === "down") u.v(12, 21, 31, "K");
      for (let y = 22; y <= 27; y++) {
        L.over.set(c.g.armL - 1, y, y % 2 ? "1" : "t");
        L.over.set(c.g.armR + 2, y, y % 2 ? "1" : "T");
      }
    },
  },
  fm_pleated_skirt: {
    slot: "bottom", gender: "nu", body: { lower: "pleated" },
    colors: { p: "#3b5a8a", P: "#253c61", l: "#f2f2ee" },
  },
  fm_maxi_dress: {
    slot: "outfit", gender: "nu", long: true, body: { lower: "maxi", sleeve: "short" },
    colors: { t: "#f2a7c3", T: "#d77f9f", u: "#fcd3e2", K: "#ffffff", a: "#f2a7c3", A: "#d77f9f", p: "#f2a7c3", P: "#d77f9f", l: "#d77f9f", 1: "#b04a6f", 2: "#ffffff" },
    draw(c, L) {
      const u = L.under;
      const [l, r] = span(c, 27);
      u.h(l, r, 27, "1");
      if (c.dir === "down") { u.h(10, 13, 21, "s"); u.h(11, 12, 22, "s"); u.set(10, 22, "o"); u.set(13, 22, "o"); u.set(11, 26, "1"); u.set(12, 26, "1"); u.set(11, 28, "1"); u.set(12, 28, "1"); }
      else if (c.dir === "up") { u.rect(11, 26, 12, 29, "1"); }
      else { u.h(8, 10, 21, "s"); u.rect(15, 26, 16, 28, "1"); }
      for (let i = 1; i < 11; i++) {
        const [sl, sr] = skirtSpan(c.dir, c.g, "maxi", i);
        for (let x = sl + 1 + (i % 2) * 2; x < sr - 1; x += 4) u.set(x, ROW.hips + i, "2");
      }
    },
  },
  fm_overalls: {
    slot: "outfit", gender: "unisex", long: true, body: { sleeve: "short" },
    colors: { t: "#f4f1ea", T: "#d6cfc0", u: "#ffffff", K: "#e05a4f", a: "#f4f1ea", A: "#e05a4f", p: "#4a6fa5", P: "#35527e", l: "#e0b44c", 1: "#4a6fa5", 2: "#35527e", 3: "#e0b44c" },
    draw(c, L) {
      const u = L.under;
      if (c.dir === "left") {
        for (const y of [23, 26, 29]) u.h(8, 15, y, "K");
        u.rect(8, 25, 10, 30, "1"); u.v(11, 25, 30, "o"); u.v(11, 21, 24, "1"); u.set(10, 25, "3");
        return;
      }
      for (const y of [23, 26, 29]) { const [l, r] = span(c, y); u.h(l, r, y, "K"); }
      const { bL, bR } = c.g;
      if (c.dir === "up") {
        for (let i = 0; i < 6; i++) { u.set(bL + 1 + i, 21 + i, "1"); u.set(bR - 1 - i, 21 + i, "1"); }
        u.rect(bL + 1, 27, bR - 1, 30, "1"); u.v(bR - 1, 27, 30, "2");
        return;
      }
      u.v(bL + 1, 21, 24, "1"); u.v(bR - 1, 21, 24, "1");
      u.rect(bL + 1, 25, bR - 1, 30, "1"); u.v(bR - 1, 25, 30, "2");
      u.h(bL + 1, bR - 1, 25, "2");
      u.set(bL + 1, 25, "3"); u.set(bR - 1, 25, "3");
      u.rect(bL + 4, 27, bR - 4, 28, "2"); u.h(bL + 4, bR - 4, 27, "o");
    },
  },
  fm_cargo_shorts: {
    slot: "bottom", gender: "unisex", body: { thigh: 3 },
    colors: { p: "#8a7a52", P: "#6b5d3c", l: "#a8966a", j: "#8a7a52" },
  },
  fm_rolled_jeans: {
    slot: "bottom", gender: "unisex", long: true, body: { cuff: true },
    colors: { p: "#3f5f95", P: "#2e4775", l: "#8fb0dd" },
  },
  fm_boots: { slot: "shoes", gender: "unisex", body: { shoe: "boots" }, colors: { f: "#7a4a2a", F: "#4a2c18" } },
  fm_sneakers: { slot: "shoes", gender: "unisex", body: { shoe: "sneakers" }, colors: { f: "#e8453c", F: "#ffffff" } },
  fm_sandals: { slot: "shoes", gender: "unisex", body: { shoe: "sandals" }, colors: { f: "#8b5a33", F: "#5e3a1f" } },
};

// ---- 0118 "Kỷ niệm Beta": cream + gold, a gold collar and a small β on the chest ----
/** The β emblem, 3×6 px, its top-left at (x, y). */
function betaGlyph(p: Pix, x: number, y: number, c = "1"): void {
  p.v(x, y, y + 5, c);
  p.set(x + 1, y, c); p.set(x + 2, y + 1, c); p.set(x + 1, y + 2, c);
  p.set(x + 2, y + 3, c); p.set(x + 1, y + 4, c);
}
function betaChest(c: GarmentCtx, L: GarmentLayers, coat: boolean): void {
  const u = L.under;
  if (c.dir === "left") {
    u.h(9, 13, 21, "1");
    if (coat) { hemExt(c, u, 3); u.h(7, 16, ROW.hips + 2, "1"); }
    return;
  }
  u.h(9, 14, 21, "1"); u.h(c.g.tL + 1, c.g.tR - 1, 22, "2");
  if (coat) { hemExt(c, u, 3); u.h(c.g.hL - 1, c.g.hR + 1, ROW.hips + 2, "1"); }
  if (c.dir === "up") return;
  if (coat) u.v(12, 23, ROW.hips + 2, "1");
  const [l] = span(c, 24);
  betaGlyph(u, l + 1, 23);
}
GARMENT_ART.beta_ao = {
  slot: "top", gender: "unisex", body: { sleeve: "short" },
  colors: { t: "#f6ecd2", T: "#dccb9f", u: "#fffaf0", K: "#d4a72c", a: "#f6ecd2", A: "#dccb9f", 1: "#d4a72c", 2: "#a87e1c" },
  draw(c, L) { betaChest(c, L, false); },
};
GARMENT_ART.beta_set = {
  slot: "outfit", gender: "unisex", long: true, body: { sleeve: "long" },
  colors: { t: "#f6ecd2", T: "#dccb9f", u: "#fffaf0", K: "#d4a72c", a: "#f6ecd2", A: "#dccb9f", p: "#d4b25a", P: "#a8842f", l: "#f6ecd2",
    1: "#d4a72c", 2: "#a87e1c" },
  draw(c, L) { betaChest(c, L, true); },
};

/** The ids drawn here (the store agent seeds exactly these). */
export const GARMENT_ART_IDS: readonly string[] = Object.keys(GARMENT_ART);

/** A garment's pieces for a facing and pose, on the four layers (unposed coordinates). */
export function drawGarment(art: GarmentArt, dir: Dir3, gender: Gender, pose: Pose): GarmentLayers {
  const L: GarmentLayers = { behind: new Pix(), under: new Pix(), tip: new Pix(), over: new Pix() };
  art.draw?.({ dir, gender, pose, g: GEO[gender] }, L);
  return L;
}
