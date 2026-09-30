import * as THREE from "three";
import type { ChibiSpec } from "./spec";
import { hash3, mix, rgb, shade, type Painter, type RGB, type Shape, type Texel, type VoxelModel } from "./voxel-atlas";
import { lathe, roundBlock, strand, type Ring } from "./voxel-shapes";
import { solid } from "./voxel-material";

// Browser only (DOM-free): the dedicated 3D detail of every garment kind (wear3d.ts) on the chibi, in the old flat-colour
// ink style — painted trims (necklines, collars, lapels, plackets, pockets, stripes, checks, prints) drawn as clean
// vector shapes (the atlas anti-aliases their edges), plus the few sculpted pieces a garment needs to read as itself
// (a hood, a sailor collar's back flap, a tie, bows, an obi, áo dài panels, kimono sleeves, cuffs, buttons). All of it
// goes into the look's existing segments: no extra draw calls.

type Seg = "head" | "torso" | "hips" | "upperL" | "upperR" | "foreL" | "foreR" | "thighL" | "thighR" | "calfL" | "calfR" | "footL" | "footR" | "rod";
type M = VoxelModel<Seg>;
type V3 = readonly [number, number, number];

const WHITE: RGB = [246, 243, 236];
const SILVER: RGB = [196, 200, 208];
const GOLD: RGB = [226, 184, 72];
const INK: RGB = [42, 30, 28];

const front = (t: Texel) => t.z > 0.2 && t.n[2] > 0.1;
const back = (t: Texel) => t.z < -0.2 && t.n[2] < -0.1;
/** Distance from (x, y) to the segment a→b. */
function segDist(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax, vy = by - ay, k = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1)));
  return Math.hypot(x - ax - vx * k, y - ay - vy * k);
}
/** A soft low-frequency pattern in [-1, 1] (camo blotches, prints). */
const wave = (x: number, y: number, z: number, k = 1) => (Math.sin(x * 1.3 * k + y * 0.7 * k + 1.3) + Math.sin(y * 1.7 * k - z * 1.1 * k + x * 0.4 * k) + Math.sin(z * 0.9 * k + x * 0.8 * k - 0.4)) / 3;

/** A crew neckline: true above it (skin). */
const aboveCrew = (ax: number, y: number, deep = 0) => ax < 1.75 && y > 8.75 - deep + 0.55 * (ax / 1.7) ** 2;
/** Inside a V opening whose point is at y0 and which widens by k per unit up. */
const inV = (ax: number, y: number, y0: number, k: number) => y > y0 && ax < (y - y0) * k;
/** Digit strokes (a 7-segment style numeral) centred at (cx, cy), size 1 unit tall. */
function digit(d: number, x: number, y: number, cx: number, cy: number, w = 0.13): boolean {
  const SEG = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f][d] ?? 0;
  const hx = 0.32, hy = 0.5;
  const P: readonly [number, number, number, number][] = [
    [-hx, hy, hx, hy], [hx, hy, hx, 0], [hx, 0, hx, -hy], [-hx, -hy, hx, -hy], [-hx, 0, -hx, -hy], [-hx, hy, -hx, 0], [-hx, 0, hx, 0],
  ];
  return P.some((p, i) => (SEG >> i) & 1 && segDist(x - cx, y - cy, p[0], p[1], p[2], p[3]) < w);
}

/** The torso's clothed colour at a texel (y ≥ 1.5: the chest; hips below are the bottom's). */
export function topPainter(s: ChibiSpec): (t: Texel) => RGB {
  const T = rgb(s.torso), TS = rgb(s.torsoShade), D = rgb(s.detail), SK = rgb(s.skin);
  const tr = s.trim.map(rgb) as [RGB, RGB, RGB, RGB];
  const B = rgb(s.bottom);
  const kind = s.top3d ?? "tee";
  const nu = s.gender === "nu";
  const rib = shade(T, 0.82);
  return (t) => {
    const x = t.x, y = t.y, ax = Math.abs(x), f = front(t), bk = back(t);
    let c: RGB = T;
    const hem = y < 2.05 && y > 1.5;
    switch (kind) {
      case "tee": case "striped": case "camo": case "fighter": {
        if (kind === "striped" && Math.floor(y / 0.85) % 2 === 0) c = tr[1];
        if (kind === "camo") { const w = wave(x, y, t.z); c = w > 0.35 ? tr[1] : w < -0.3 ? TS : T; }
        if (aboveCrew(ax, y)) return SK;
        if (aboveCrew(ax, y, 0.32)) return rib;
        if (hem) return rib;
        if (kind === "fighter" && y > 7.2 && ax > 2.2) return SK;
        return c;
      }
      case "tank": {
        if (y > 7.2 && ax > 2.25) return SK;
        if (f && inV(ax, y, 6.9, 0.9) && ax > 0 && y > 6.9 + 0.35 * (ax * ax)) return SK;
        if (bk && y > 7.9 && ax < 1.9) return SK;
        if (y > 7.2 && ax > 1.95) return rib;
        return hem ? rib : T;
      }
      case "baba": case "kungfu": {
        if (aboveCrew(ax, y, 0.25)) return SK;
        if (kind === "kungfu") {
          if (y > 8.55 && y < 9.3 && ax < 1.9) return tr[3];                               // mandarin collar
          if (f && ax < 0.1 && y < 8.6 && y > 2.2) return shade(T, 0.7);
          if (f && [7.6, 6.5, 5.4, 4.3].some((yy) => Math.abs(y - yy) < 0.13 && ax < 0.6)) return tr[3];   // frog buttons
          return c;
        }
        if (f && ax < 0.07 && y < 8.4) return shade(T, 0.72);                                // placket seam
        if (f && [7.6, 6.3, 5.0, 3.7].some((yy) => Math.hypot(x - 0.28, y - yy) < 0.2)) return tr[0];
        if (f && y > 2.0 && y < 3.5 && Math.abs(ax - 2.05) < 0.7) {                          // hip pockets
          if (Math.abs(ax - 2.05) > 0.58 || y < 2.12 || Math.abs(y - 3.2) < 0.08) return shade(T, 0.78);
        }
        return hem ? TS : c;
      }
      case "polo": case "shirt": case "flannel": case "denimshirt": case "school": {
        if (kind === "flannel") {
          const a = Math.floor((x + 10) / 0.7) % 2, b2 = Math.floor((y + 10) / 0.7) % 2;
          c = a && b2 ? tr[0] : a || b2 ? mix(T, tr[0], 0.45) : T;
        }
        if (aboveCrew(ax, y, 0.2)) return SK;
        const collar = kind === "school" ? WHITE : kind === "polo" ? mix(T, tr[1], 0.35) : shade(T, 1.08);
        // pointed collar points on the chest
        if (f && y > 7.7 && y < 9.3 && ax < 1.75 && ax > 0.08 && y < 9.05 - 0.25 * ax) {
          const d = segDist(ax, y, 0.15, 8.2, 1.35, 8.95);
          if (d < 0.3) return ax < 0.2 ? shade(collar, 0.8) : collar;
          if (d < 0.42) return shade(collar, kind === "school" ? 0.7 : 0.8);          // the collar's edge line
        }
        if (y > 8.7 && ax < 1.9 && !f) return collar;
        if (f && ax < 0.09 && y < 8.1) return kind === "denimshirt" ? tr[0] : shade(c, 0.72);
        const buttons = kind === "polo" ? [7.6, 6.9] : [7.4, 6.2, 5.0, 3.8, 2.6];
        if (f && buttons.some((yy) => Math.hypot(x - 0.24, y - yy) < 0.17)) return kind === "polo" ? tr[1] : kind === "school" ? [210, 214, 220] : kind === "denimshirt" ? tr[0] : WHITE;
        if (f && (kind === "school" || kind === "denimshirt") && x > 0.9 && x < 2.3 && y > 5.5 && y < 7.1) {
          if (x < 1.0 || x > 2.2 || y < 5.6 || Math.abs(y - 6.75) < 0.07) return kind === "denimshirt" ? tr[0] : shade(c, 0.8);
        }
        if (f && kind === "denimshirt" && x < -0.9 && x > -2.3 && y > 5.5 && y < 7.1 && (x > -1.0 || x < -2.2 || y < 5.6 || Math.abs(y - 6.75) < 0.07)) return tr[0];
        return hem ? shade(c, 0.85) : c;
      }
      case "hoodie": case "raincoat": {
        if (aboveCrew(ax, y, 0.1)) return SK;
        if (aboveCrew(ax, y, 0.45)) return shade(T, 0.85);
        if (kind === "hoodie") {
          if (f && y > 6.4 && y < 8.5 && Math.abs(ax - 0.62) < 0.07) return tr[0];            // drawstrings
          if (f && y > 6.2 && y < 6.5 && Math.abs(ax - 0.62) < 0.13) return shade(tr[0], 0.8);
          const pw = 2.3 - (y - 2.2) * 0.32;
          if (f && y > 2.2 && y < 4.4 && ax < pw) {                                             // kangaroo pocket
            if (ax > pw - 0.12 || y > 4.28) return shade(T, 0.72);
            return shade(T, 0.94);
          }
          return hem ? rib : c;
        }
        if (f && ax < 0.08) return shade(T, 0.7);
        if (f && [7.8, 6.4, 5.0, 3.6, 2.4].some((yy) => Math.hypot(x - 0.3, y - yy) < 0.17)) return tr[0];
        return c;
      }
      case "vest": case "suit": case "leather": {
        const y0 = kind === "vest" ? 4.6 : kind === "suit" ? 4.8 : 5.4;
        if (aboveCrew(ax, y, -0.2)) return SK;
        if (f && inV(ax, y, y0, 0.46)) {
          // the shirt (and tie) inside the V
          if (kind === "leather") return tr[1] ?? WHITE;
          if (kind === "suit" && !nu && ax < 0.22 + (8.6 - y) * 0.03 && y < 8.6) return tr[1];
          if (y > 8.55 && ax < 1.3 && ax > 0.15) return WHITE;
          return kind === "suit" ? tr[0] : WHITE;
        }
        // lapels: a lighter band beside the V with a notch
        if (f && kind !== "vest" && y > y0 - 0.2 && ax < (y - y0) * 0.46 + (kind === "leather" ? 1.0 : 0.75)) {
          if (Math.abs(y - 7.9) < 0.1 && ax > (y - y0) * 0.46 + 0.3) return shade(T, 0.6);
          return shade(T, kind === "leather" ? 1.35 : 1.28);
        }
        if (f && kind === "leather" && Math.abs(x - 0.55) < 0.07 && y < y0) return SILVER;
        if (f && kind !== "leather" && [y0 - 0.55, y0 - 1.35, y0 - 2.15].some((yy) => Math.hypot(x, yy - y) < 0.17)) return kind === "vest" ? GOLD : shade(T, 0.55);
        if (f && kind === "suit" && x > 1.3 && x < 2.3 && y > 6.4 && y < 6.9) return y > 6.72 ? tr[2] : shade(T, 0.7);   // pocket square
        if (f && kind === "suit" && y > 2.2 && y < 2.45 && Math.abs(ax - 1.9) < 0.65) return shade(T, 0.7);
        if (kind === "leather" && hem) return shade(T, 0.75);
        return c;
      }
      case "denimjacket": case "cardigan": case "varsity": {
        const inner = kind === "varsity" ? T : tr[0];
        if (aboveCrew(ax, y, 0)) return SK;
        if (kind === "cardigan") {
          if (f && inV(ax, y, 5.2, 0.5)) return aboveCrew(ax, y, 0.3) ? shade(inner, 0.9) : inner;
          if (f && ax < (y - 5.2) * 0.5 + 0.25 && y > 5.0) return shade(T, 0.85);
          if (f && x > 0 && x < 0.3 && [4.6, 3.6, 2.6].some((yy) => Math.abs(y - yy) < 0.17)) return tr[1];
          if (f && ax < 0.12 && y < 5.2) return shade(T, 0.78);
          return hem || (y > 1.5 && y < 2.35 && Math.floor(t.u / 2) % 2 === 0) ? shade(T, 0.86) : c;
        }
        if (kind === "varsity") {
          if (aboveCrew(ax, y, 0.45)) return Math.abs(y - 8.55 - 0.55 * (ax / 1.7) ** 2) < 0.1 ? tr[1] : tr[0];   // ribbed collar
          if (hem || (y > 2.05 && y < 2.3)) return y > 2.12 && y < 2.22 ? tr[1] : tr[0];
          if (f && ax < 0.06) return shade(T, 0.7);
          if (f && [7.4, 6.1, 4.8, 3.5].some((yy) => Math.hypot(x - 0.28, y - yy) < 0.15)) return tr[1];
          // a letter patch on the left chest: a rounded badge with a thick "A"
          if (f && Math.hypot((x + 1.55) / 0.85, (y - 6.4) / 0.95) < 1) {
            const lx = x + 1.55, ly = y - 6.4;
            const A = segDist(lx, ly, -0.45, -0.6, 0, 0.6) < 0.15 || segDist(lx, ly, 0.45, -0.6, 0, 0.6) < 0.15 || segDist(lx, ly, -0.22, -0.1, 0.22, -0.1) < 0.12;
            return A ? tr[0] : tr[1];
          }
          return c;
        }
        // denim jacket: shirt collar, open front over a white tee, chest pockets with flaps, gold stitching
        if (f && ax < 0.85 && y > 2.3) return aboveCrew(ax, y, 0.3) ? shade(inner, 0.9) : inner;
        if (f && ax < 1.9 && y > 7.9 && y < 9.3 && segDist(ax, y, 0.85, 8.1, 1.75, 9.0) < 0.42) return shade(T, 1.12);
        if (f && ax > 1.05 && ax < 2.35 && y > 5.5 && y < 7.2) {
          if (y > 6.6) return y < 6.7 ? tr[1] : shade(T, 1.08);
          if (ax < 1.12 || ax > 2.28 || y < 5.6) return D;
        }
        if (f && Math.abs(ax - 0.95) < 0.05 && y < 7.8) return D;
        if (f && [6.9, 5.3, 3.7].some((yy) => Math.hypot(ax - 1.15, y - yy) < 0.14)) return D;
        if (y > 1.5 && y < 2.3) return y > 2.2 ? D : shade(T, 0.9);
        return c;
      }
      case "sailor": {
        if (f && inV(ax, y, 5.8, 0.52)) return aboveCrew(ax, y) ? SK : WHITE;
        if (f && y > 5.6 && ax < (y - 5.8) * 0.52 + 1.05) {
          const e = ax - (y - 5.8) * 0.52;
          return Math.abs(e - 0.78) < 0.08 ? WHITE : tr[0];
        }
        if (bk && y > 6.6 && ax < 2.9) return Math.abs(ax - 2.55) < 0.08 || Math.abs(y - 6.95) < 0.08 ? WHITE : tr[0];
        if (y > 8.7 && ax < 2.2) return tr[0];
        return c;
      }
      case "jersey": {
        if (aboveCrew(ax, y, 0.1)) return SK;
        if (f && inV(ax, y, 7.9, 0.9)) return SK;
        if (f && inV(ax, y, 7.6, 0.9) || aboveCrew(ax, y, 0.4)) return tr[0];
        if (Math.abs(t.n[0]) > 0.75 && y < 8) return WHITE;                                  // side stripes
        if (f && (digit(1, x, y, -0.55, 5.3) || digit(0, x, y, 0.55, 5.3))) return tr[0];
        if (bk && (digit(1, x, y, 0.55, 5.6, 0.17) || digit(0, x, y, -0.55, 5.6, 0.17))) return tr[0];
        return c;
      }
      case "chef": {
        if (aboveCrew(ax, y, -0.3)) return SK;
        if (f && segDist(x, y, 1.2, 8.8, -0.2, 3.0) < 0.05) return shade(T, 0.78);
        if (f && [7.5, 6.2, 4.9, 3.6].some((yy) => Math.hypot(ax - 1.1, y - yy) < 0.2)) return D;
        return hem ? TS : c;
      }
      case "puffer": {
        if (aboveCrew(ax, y, -0.2)) return SK;
        const q = (y - 1.6) / 1.45, fr = q - Math.floor(q);
        if (fr < 0.08 || fr > 0.94) return shade(T, 0.7);
        c = shade(T, 0.92 + 0.14 * Math.sin(fr * Math.PI));                                 // each quilt puffs out
        if (f && ax < 0.07) return SILVER;
        return c;
      }
      case "aodai": {
        if (y > 8.7 && ax < 1.9) return aboveCrew(ax, y, -0.55) ? SK : y > 9.1 ? tr[0] : c;  // high collar with a trim
        if (f && segDist(x, y, 0.35, 8.7, 2.4, 7.2) < 0.07) return tr[0];                    // diagonal closure
        if (f && [[0.9, 8.3], [1.6, 7.8]].some(([bx, by]) => Math.hypot(x - bx, y - by) < 0.13)) return tr[0];
        if (f && y < 7.4 && y > 4.0 && Math.hypot((x + 0.9) / 0.9, (y - 5.2) / 0.9) < 1) {
          const r = Math.hypot(x + 0.9, y - 5.2);                                             // a small embroidered flower
          if (r < 0.2) return tr[0];
          const a = Math.atan2(y - 5.2, x + 0.9);
          if (r < 0.62 * (0.6 + 0.4 * Math.abs(Math.cos(a * 2.5)))) return mix(T, tr[0], 0.55);
        }
        return c;
      }
      case "kimono": {
        // the white under-collar and the wrap: left over right, down to the obi
        if (y > 8.9 && ax < 1.6) return SK;
        if (f && inV(ax, y, 5.2, 0.45)) return aboveCrew(ax, y, -0.2) ? SK : tr[2];
        if (f && y > 5.1 && ax < (y - 5.2) * 0.45 + 0.42) return tr[2];
        if (f && segDist(x, y, -0.1, 5.2, 1.4, 2.0) < 0.06) return shade(T, 0.75);
        if (Math.hypot(Math.sin(x * 1.7) * 0.8, Math.sin(y * 1.9 + x) * 0.8) < 0.22 && y < 4.8) return tr[3];   // a scattered print
        return c;
      }
      case "maxi": {
        if (y > 7.6 && ax > 2.0) return SK;                                                  // straps
        if (f && y > 7.3 && y > 7.3 + 0.4 * Math.cos(ax * 1.6) && ax < 2.0) return ax > 1.6 && y < 8.9 ? T : SK;   // sweetheart neckline
        if (bk && y > 7.6) return ax > 1.6 && ax < 2.0 ? T : SK;
        if (y > 3.9 && y < 4.35) return tr[0];                                               // waist seam
        return c;
      }
      case "overalls": {
        if (aboveCrew(ax, y, 0.2)) return SK;
        if (hem || y < 2.05) return B;
        if (f && ax < 1.9 && y < 6.9) {                                                     // the bib
          if (ax > 1.8 || y > 6.78) return shade(B, 0.75);
          if (ax < 0.9 && y > 4.6 && y < 5.9) return ax > 0.82 || y < 4.68 || Math.abs(y - 5.6) < 0.06 ? tr[2] : shade(B, 1.05);
          if (Math.hypot(ax - 1.45, y - 6.45) < 0.2) return GOLD;
          return B;
        }
        if (Math.abs(ax - 1.55 - (y > 6.9 ? 0 : 0)) < 0.34 && y > 6.5) return shade(B, 0.95);    // straps over the shoulders
        if (bk && y < 5.5) return B;
        return c;
      }
      case "gi": case "tkd": {
        if (aboveCrew(ax, y, -0.3)) return SK;
        if (kind === "tkd") {
          if (f && inV(ax, y, 6.4, 0.7)) return aboveCrew(ax, y, 0.3) ? SK : WHITE;
          if (f && y > 6.2 && ax < (y - 6.4) * 0.7 + 0.45) return tr[2] ?? INK;
          return c;
        }
        if (f && inV(ax, y, 5.0, 0.4)) return SK;
        if (f && y > 4.8 && ax < (y - 5.0) * 0.4 + 0.55) return tr[1];
        if (f && segDist(x, y, -0.2, 5.0, 1.8, 2.3) < 0.07) return tr[1];
        return c;
      }
      default:
        if (aboveCrew(ax, y)) return SK;
        return hem ? rib : c;
    }
  };
}

/** The hips/bottom's colour at a texel (pelvis, seat, below the waist), by bottom kind. */
export function bottomPainter(s: ChibiSpec, base: (t: Texel) => RGB): (t: Texel) => RGB {
  const B = rgb(s.bottom), BT = rgb(s.bottomTrim);
  const kind = s.bottom3d;
  return (t) => {
    const x = t.x, y = t.y, ax = Math.abs(x), f = front(t);
    let c = base(t);
    switch (kind) {
      case "jeans": case "rolled": case "denimskirt":
        if (f && y < 0.8 && y > -1.4 && Math.abs(ax - 1.75) < 0.9 && Math.abs(Math.hypot(ax - 2.7, y - 0.8) - 1.25) < 0.05) c = [214, 170, 80];   // pocket stitching
        if (y > 0.8 && y < 1.5 && Math.abs(Math.abs(x) - 1.3) < 0.12) c = shade(B, 0.8);                                                     // belt loops
        break;
      case "cargo": case "cargoshorts":
        if (y > 0.9 && y < 1.5) c = shade(B, 0.82);
        break;
      case "jogger":
        if (y > 0.9 && y < 1.5) c = Math.abs(ax - 0.4) < 0.06 && f && y < 1.2 ? WHITE : shade(B, 0.85);
        if (Math.abs(t.n[0]) > 0.8 && y < 0.9) c = BT;
        break;
      case "silk":
        if (f && Math.abs(ax - 1.3) < 0.35) c = mix(c, [255, 255, 255], 0.14);
        break;
      case "camoshorts": {
        const w = wave(x, y, t.z, 1.2);
        if (y < 0.9) c = w > 0.3 ? BT : w < -0.3 ? shade(B, 0.75) : B;
        break;
      }
      case "hawaii":
        if (y < 0.9 && flower(x, y, t.z)) c = BT;
        break;
      case "pleated": {
        const a = Math.atan2(t.z, t.x), k = ((a / (Math.PI * 2)) + 1) * 28, fr = k - Math.floor(k);
        if (y < 1.4 && fr < 0.12) c = shade(c, 0.78);
        else if (y < 1.4 && fr < 0.5) c = shade(c, 0.93);
        break;
      }
      default: break;
    }
    return c;
  };
}

/** A small repeating flower print. */
function flower(x: number, y: number, z: number): boolean {
  const cx = Math.round(x / 1.1) * 1.1 + (Math.round(y / 1.1) % 2 ? 0.55 : 0), cy = Math.round(y / 1.1) * 1.1;
  const r = Math.hypot(x - cx, y - cy);
  const a = Math.atan2(y - cy, x - cx);
  return r < 0.36 * (0.55 + 0.45 * Math.abs(Math.cos(a * 2.5))) && hash3(cx * 3, cy * 3, z > 0 ? 1 : 0) > 0.25;
}

/** Leg cloth detail (thigh or calf, in its own limb space: y down from the joint, x sideways, `outer` = +x·side). */
export function legCloth(s: ChibiSpec, side: -1 | 1, part: "thigh" | "calf", base: RGB, L: number): (t: Texel) => RGB {
  const BT = rgb(s.bottomTrim), kind = s.bottom3d;
  return (t) => {
    const outer = t.x * side > 0.55 && Math.abs(t.n[0]) > 0.45;
    let c = base;
    switch (kind) {
      case "jogger":
        if (outer && Math.abs(t.z) < 0.28) c = BT;
        if (part === "calf" && t.y < -5.3 * L) c = shade(base, 0.8);
        break;
      case "cargo": case "cargoshorts":
        if (part === "thigh" && outer && t.y < -1.9 * L && t.y > -3.6 * L && Math.abs(t.z) < 0.85) {
          c = t.y > -2.3 * L ? shade(base, 0.8) : Math.abs(t.z) > 0.75 || t.y < -3.5 * L ? shade(base, 0.8) : shade(base, 1.05);
        }
        break;
      case "jeans": case "rolled":
        if (outer && Math.abs(t.z) < 0.07) c = [214, 170, 80];
        break;
      case "silk":
        if (t.z > 0.4 && Math.abs(t.x) < 0.35) c = mix(base, [255, 255, 255], 0.14);
        break;
      case "camoshorts": {
        const w = wave(t.x * 1.3, t.y, t.z, 1.2);
        c = w > 0.3 ? BT : w < -0.3 ? shade(base, 0.75) : base;
        break;
      }
      case "hawaii":
        if (flower(t.x + side * 3, t.y, t.z)) c = BT;
        break;
      default: break;
    }
    return c;
  };
}

/** A small bow (two loops and a knot), facing +z, centred at c. */
function bow(m: M, seg: Seg, c: V3, size: number, color: string, knot?: string): void {
  const [x, y, z] = c, k = size;
  for (const sx of [-1, 1]) m.surface(seg, roundBlock([x + sx * 0.62 * k, y, z], [0.62 * k, 0.45 * k, 0.24 * k], 0.7, { seg: [8, 5], deform: (p) => { p.y += (p.x - x) * sx * 0.15; } }), solid(color, 0.02));
  m.surface(seg, roundBlock([x, y, z + 0.1 * k], [0.24 * k, 0.3 * k, 0.24 * k], 0.7, { seg: [6, 4] }), solid(knot ?? color, 0.02));
}

/** A hood lying behind the neck (hoodie, raincoat). */
function hood(m: M, color: string, shadeHex: string, depth: number): void {
  const a = rgb(color), b = rgb(shadeHex);
  m.surface("torso", roundBlock([0, 9.75, -1.35 * depth], [3.05, 1.6, 1.55], 0.75, { seg: [14, 8], deform: (p) => { if (p.y > 9.75) p.z -= (p.y - 9.75) * 0.4; } }),
    (t) => (t.z > -1.2 * depth && t.y > 9.5 ? shade(b, 0.8) : t.n[1] > 0.5 ? a : mix(a, b, 0.3)));
}

export interface TorsoGeo {
  /** The torso's front surface z at (x, y) (hips space units), or the centre z when off it. */
  frontZ: (x: number, y: number) => number;
  depth: number;
  hips: number;
  low: boolean;
}

/** The sculpted pieces of the worn top/outfit on the torso, hips and arms. */
export function buildTopPieces(m: M, s: ChibiSpec, g: TorsoGeo): void {
  const kind = s.top3d;
  const tr = s.trim, nu = s.gender === "nu";
  const fz = g.frontZ;
  const button = (x: number, y: number, color: string, r = 0.2) => { if (!g.low) m.surface("torso", roundBlock([x, y, fz(x, y) + 0.02], [r, r, 0.12], 0.8, { seg: [6, 3] }), solid(color, 0.02)); };
  switch (kind) {
    case "hoodie": hood(m, s.torso, s.torsoShade, g.depth); break;
    case "raincoat": {
      hood(m, s.torso, s.torsoShade, g.depth);
      // a coat hem over the hips
      m.surface("hips", lathe(ringsOf([[1.4, 3.7 * g.hips, 2.25 * g.depth], [-2.6, 4.2 * g.hips, 2.6 * g.depth], [-2.75, 4.0 * g.hips, 2.45 * g.depth]]), 0.8, 20), solid(s.torso, 0.02));
      break;
    }
    case "sailor":
      m.surface("torso", roundBlock([0, 7.7, -1.95 * g.depth - 0.12], [2.75, 1.45, 0.16], 0.35, { seg: [10, 6] }), (t) => {
        const c = rgb(tr[0]);
        return Math.abs(Math.abs(t.x) - 2.35) < 0.09 || Math.abs(t.y - 6.6) < 0.09 ? rgb("#ffffff") : c;
      }, undefined, 2);
      bow(m, "torso", [0, 5.95, fz(0, 5.95) + 0.12], 0.95, tr[2], tr[3]);
      break;
    case "school":
      if (nu) bow(m, "torso", [0, 8.25, fz(0, 8.25) + 0.15], 0.75, tr[0], tr[1]);
      else {
        m.surface("torso", roundBlock([0, 8.2, fz(0, 8.2) + 0.12], [0.3, 0.26, 0.15], 0.7, { seg: [6, 4] }), solid(tr[0], 0.02));
        m.surface("torso", roundBlock([0, 6.4, fz(0, 6.4) + 0.08], [0.34, 1.6, 0.08], 0.5, { seg: [6, 6], deform: (p) => { p.x *= 0.7 + 0.3 * Math.max(0, (8 - p.y) / 3.2); if (p.y < 5.0) p.x *= 0.4 + 0.6 * (p.y - 4.8) / 0.2; } }), solid(tr[0], 0.02));
      }
      break;
    case "suit":
      if (!nu) {
        m.surface("torso", roundBlock([0, 8.3, fz(0, 8.3) + 0.1], [0.28, 0.24, 0.14], 0.7, { seg: [6, 4] }), solid(tr[1], 0.02));
        m.surface("torso", roundBlock([0, 6.6, fz(0, 6.6) + 0.06], [0.3, 1.65, 0.07], 0.5, { seg: [6, 6], deform: (p) => { p.x *= 0.75 + 0.35 * (6.6 - p.y) / 1.65; } }), solid(tr[1], 0.02));
      } else button(0, 7.9, tr[2], 0.26);
      break;
    case "vest": bow(m, "torso", [0, 8.4, fz(0, 8.4) + 0.12], 0.55, "#111418"); break;
    case "chef":
      m.surface("torso", lathe(ringsOf([[10.2, 1.35, 1.25], [9.2, 1.55, 1.45]]), 0.9, 14), solid(s.torso, 0.02));
      for (const y of [7.5, 6.2, 4.9, 3.6]) { button(1.1, y, s.detail, 0.17); button(-1.1, y, s.detail, 0.17); }
      break;
    case "puffer":
      m.surface("torso", lathe(ringsOf([[10.1, 1.55, 1.45], [9.0, 2.1, 1.75]]), 0.9, 14), solid(s.torsoShade, 0.02));
      break;
    case "aodai": case "kungfu":
      // the high mandarin collar round the neck
      m.surface("torso", lathe(ringsOf([[10.35, 1.18, 1.1], [9.4, 1.4, 1.28]]), 0.9, 14), (t) => (t.y > 10.15 ? rgb(tr[kind === "kungfu" ? 3 : 0]) : rgb(s.torso)));
      if (kind === "aodai") aoDaiPanels(m, s, g);
      break;
    case "kimono": {
      // obi: a wide band round the waist with a cord, a big bow at the back
      const band: [number, number, number][] = [[5.2, 3.05, 2.05], [4.9, 3.15, 2.12], [3.2, 3.15, 2.1], [2.9, 3.1, 2.05]];
      m.surface("torso", lathe(ringsOf(band.map(([y, rx, rz]) => [y, rx * g.hips * 0.97, rz * g.depth + 0.05])), 0.8, 20), (t) => (Math.abs(t.y - 4.05) < 0.1 ? rgb(tr[1]) : rgb(tr[0])), undefined, 1.5);
      m.surface("torso", roundBlock([0, 4.2, -2.35 * g.depth], [1.9, 1.05, 0.55], 0.6, { seg: [10, 6], deform: (p) => { p.y += Math.abs(p.x) * 0.18; } }), solid(tr[0], 0.02));
      m.surface("torso", roundBlock([0, 4.1, -2.9 * g.depth], [0.55, 0.6, 0.4], 0.6, { seg: [6, 4] }), solid(tr[1], 0.02));
      break;
    }
    case "maxi":
      m.surface("torso", lathe(ringsOf([[4.4, 2.75 * g.hips * 0.93, 1.85 * g.depth + 0.04], [3.85, 2.7 * g.hips * 0.93, 1.8 * g.depth + 0.04]]), 0.8, 18), solid(tr[0], 0.02));
      break;
    case "overalls": button(1.45, 6.45, "#e0b44c", 0.2); button(-1.45, 6.45, "#e0b44c", 0.2); break;
    case "gi": case "tkd":
      break;
    default: break;
  }
}

/** Lathe rings from (y, rx, rz) triples, closed by the lathe's own ends. */
function ringsOf(pts: readonly (readonly [number, number, number])[]): Ring[] {
  return pts.map(([y, rx, rz]) => ({ y, rx, rz }));
}

/** Áo dài: two long flowing panels (front and back) from the waist to below the knee, the side slits showing the
 *  trousers; on the skinned hips (the panels follow the legs as a skirt does). */
function aoDaiPanels(m: M, s: ChibiSpec, g: TorsoGeo): void {
  const T = rgb(s.torso), TR = rgb(s.trim[0]);
  for (const dir of [1, -1]) {
    const z0 = dir * 2.0 * g.depth;
    const shape: Shape = roundBlock([0, -3.5, z0], [2.2 * g.hips, 6.5, 0.17], 0.3, {
      seg: [12, 14],
      deform: (p) => {
        const k = Math.max(0, (2.0 - p.y) / 12.0);                                                  // 0 at the waist → 1 at the hem
        p.x *= 0.92 + 0.3 * k;                                                          // flares a little
        p.z += dir * (0.32 * Math.min(1, k * 5) + 0.55 * k - 0.15 * p.x * p.x + 0.5 * k * k);   // tucked in at the waist, falls clear of the legs
      },
    });
    m.surface("hips", shape, (t) => {
      const hem = t.y < -9.6;
      if (hem) return shade(T, 0.85);
      if (dir > 0 && Math.hypot((t.x - 0.9) / 0.9, (t.y + 5.2) / 1.2) < 1) {             // a painted flower sprig on the front
        const r = Math.hypot(t.x - 0.9, t.y + 5.2), a = Math.atan2(t.y + 5.2, t.x - 0.9);
        if (r < 0.22) return TR;
        if (r < 0.7 * (0.6 + 0.4 * Math.abs(Math.cos(a * 2.5)))) return mix(T, TR, 0.6);
      }
      if (dir > 0 && segDist(t.x, t.y, 0.9, -6.2, 0.2, -8.6) < 0.06) return mix(T, TR, 0.5);
      return T;
    }, undefined, 1.5);
  }
}

/** Kimono sleeves: wide, hanging "furisode" pouches under the upper arms and a flared cuff on the forearms. */
export function buildSleevePieces(m: M, s: ChibiSpec, up: Seg, fo: Seg, k: number, L: number): void {
  if (s.top3d !== "kimono") return;
  const T = rgb(s.torso), TS = rgb(s.torsoShade), TR = rgb(s.trim[3]);
  m.surface(up, roundBlock([0, -3.2 * L, -0.25], [0.55 * k, 2.7 * L, 1.75], 0.45, { seg: [8, 8], deform: (p) => { if (p.y > -1.2 * L) p.z *= 0.6; } }),
    (t) => (t.y < -5.5 * L ? TS : Math.hypot(Math.sin(t.z * 2.1) * 0.7, Math.sin(t.y * 1.5) * 0.7) < 0.2 ? TR : T));
  m.surface(fo, lathe(ringsOf([[-0.2, 1.25 * k, 1.25 * k], [-2.4 * L, 1.55 * k, 1.5 * k], [-3.4 * L, 1.65 * k, 1.6 * k], [-3.45 * L, 1.45 * k, 1.4 * k]]), 0.85, 12), (t) => (t.y < -3.2 * L ? TS : T));
}

/** A rolled-up cuff at the calf's bottom (rolled jeans) and joggers' ankle cuffs. */
export function buildLegPieces(m: M, s: ChibiSpec, ca: Seg, ck: number, A: number): void {
  if (s.bottom3d === "rolled") {
    m.surface(ca, lathe(ringsOf([[-A + 1.7, 1.12 * ck, 1.12 * ck], [-A + 1.65, 1.22 * ck, 1.22 * ck], [-A + 0.85, 1.22 * ck, 1.22 * ck], [-A + 0.8, 1.05 * ck, 1.05 * ck]]), 0.9, 12),
      (t) => (Math.abs(t.y - (-A + 1.25)) < 0.06 ? rgb(s.bottomShade) : mix(rgb(s.bottom), [255, 255, 255], 0.28)));
  }
}

/** The neck accessory's pieces (scarves, ties, bows, chokers, chains, pendants). */
export function buildNeckPieces(m: M, s: ChibiSpec, fz: (x: number, y: number) => number, low: boolean): void {
  const n = s.neck;
  if (!n) return;
  const main = rgb(n.main), dark = rgb(n.shade);
  switch (n.model) {
    case "khanran": case "plaid": case "scarf": {
      const pat: Painter = (t) => {
        if (n.model === "scarf") return Math.abs(t.y - 9.0) < 0.07 ? shade(main, 0.85) : main;
        const a = Math.floor((Math.atan2(t.z, t.x) / (Math.PI * 2)) * 36 + 36) % 2, b = Math.floor((t.y + 10) / 0.45) % 2;
        if (n.model === "khanran") return a && b ? dark : a || b ? mix(main, dark, 0.5) : main;
        return a && b ? dark : a || b ? mix(main, dark, 0.45) : mix(main, [240, 220, 120], a ? 0 : 0.0);
      };
      m.surface("torso", lathe(ringsOf([[10.2, 1.55, 1.4], [9.7, 2.2, 1.95], [9.0, 2.55, 2.2], [8.45, 2.35, 2.05], [8.3, 1.6, 1.5]]), 0.85, 16), pat, undefined, 1.5);
      // the knot and the hanging end(s)
      const zf = fz(1.1, 7.4) + 0.2;
      m.surface("torso", roundBlock([0.9, 8.55, zf + 0.15], [0.55, 0.45, 0.4], 0.7, { seg: [8, 5] }), pat);
      m.surface("torso", roundBlock([1.15, 7.0, zf], [0.55, 1.35, 0.18], 0.4, { seg: [6, 8], deform: (p) => { p.x += (7.8 - p.y) * 0.12; } }), (t) => (t.y < 5.85 ? dark : pat(t) ?? main), undefined, 1.5);
      if (n.model !== "scarf") m.surface("torso", roundBlock([0.45, 7.2, zf - 0.05], [0.45, 1.1, 0.16], 0.4, { seg: [6, 8] }), pat, undefined, 1.5);
      break;
    }
    case "tie":
      m.surface("torso", roundBlock([0, 8.35, fz(0, 8.35) + 0.14], [0.3, 0.26, 0.16], 0.7, { seg: [6, 4] }), solid(n.main, 0.02));
      m.surface("torso", roundBlock([0, 6.6, fz(0, 6.6) + 0.08], [0.32, 1.7, 0.08], 0.5, { seg: [6, 6], deform: (p) => { p.x *= 0.72 + 0.35 * (6.6 - p.y) / 1.7; } }),
        (t) => (Math.abs(t.y - 6.4) < 0.08 || Math.abs(t.y - 7.2) < 0.08 ? dark : main));
      break;
    case "bowtie": bow(m, "torso", [0, 8.4, fz(0, 8.4) + 0.14], 0.6, n.main, n.shade); break;
    case "choker":
      m.surface("torso", lathe(ringsOf([[10.4, 1.2, 1.12], [9.95, 1.2, 1.12]]), 0.9, 14), solid(n.shade, 0.02));
      if (!low) m.surface("torso", roundBlock([0, 9.75, 1.25], [0.32, 0.28, 0.12], 0.8, { seg: [6, 4], deform: (p) => { if (p.y < 9.75) p.x *= 1 - (9.75 - p.y) / 0.34; } }), solid(n.main, 0.02));
      break;
    case "goldchain":
      m.surface("torso", lathe(ringsOf([[9.55, 1.95, 1.7], [9.25, 2.05, 1.8], [8.95, 1.8, 1.6]]), 0.9, 16, (p) => { if (p.z > 0) p.y -= 0.7 * (p.z / 1.8) ** 2; }),
        (t) => (Math.floor((Math.atan2(t.z, t.x) + 4) * 10) % 2 ? main : dark));
      break;
    default: {
      // chain / pearl / jade: painted on the chest (topPainter's neck band) plus a pendant
      const pz = fz(0, 7.25) + 0.12;
      if (!low) m.surface("torso", roundBlock([0, 7.2, pz], n.model === "pearl" ? [0.24, 0.24, 0.2] : [0.34, 0.42, 0.16], 0.8, { seg: [6, 5] }), solid(n.accent, 0.02));
      break;
    }
  }
}

/** Extra hat shapes (the kinds the 2D sprite shares with another silhouette). Returns false for kinds build.ts draws. */
export function buildHatKind(m: M, h: NonNullable<ChibiSpec["hat"]>): boolean {
  const surf = (sh: Shape, p: Painter, sharp = 1) => m.surface("head", sh, p, undefined, sharp);
  const main = rgb(h.main), sh = rgb(h.shade), acc = rgb(h.accent);
  switch (h.kind) {
    case "cap":
      surf(roundBlock([0, 8.7, -0.1], [4.75, 2.9, 4.7], 0.75, { seg: [16, 8], deform: (p) => { if (p.y < 7.6) p.y = 7.6; } }),
        (t) => (t.y < 7.95 && t.n[1] < 0.7 ? sh : Math.abs(Math.sin(Math.atan2(t.z, t.x) * 3)) < 0.04 && t.y > 8.3 ? sh : main));
      surf(roundBlock([0, 7.85, 5.1], [3.6, 0.28, 2.3], 0.4, { seg: [12, 4], deform: (p) => { p.y -= 0.05 * p.z; } }), solid(h.brim === h.main ? h.shade : h.brim));
      surf(roundBlock([0, 11.55, -0.1], [0.5, 0.3, 0.5], 0.7, { seg: [6, 4] }), solid(h.accent));
      return true;
    case "beret": {
      const tilt = new THREE.Matrix4().makeRotationZ(-0.22);
      m.surface("head", roundBlock([0.4, 10.0, -0.2], [5.4, 1.35, 5.2], 0.8, { seg: [18, 7], deform: (p) => { if (p.y < 9.3) p.y = 9.3 + (p.y - 9.3) * 0.4; } }),
        (t) => (t.n[1] < -0.3 ? sh : main), tilt);
      m.surface("head", lathe(ringsOf([[9.6, 4.55, 4.5], [8.9, 4.55, 4.5]]), 1, 16), solid(h.shade), tilt);
      m.surface("head", roundBlock([0.4, 11.4, -0.2], [0.18, 0.35, 0.18], 0.8, { seg: [5, 3] }), solid(h.shade), tilt);
      return true;
    }
    case "beanie":
      surf(roundBlock([0, 8.7, -0.1], [4.95, 3.7, 4.85], 0.75, { seg: [16, 8], deform: (p) => { if (p.y < 7) p.y = 7; } }),
        (t) => (Math.floor((Math.atan2(t.z, t.x) / (Math.PI * 2)) * 40 + 40) % 2 ? main : shade(main, 0.9)), 1.5);
      surf(lathe(ringsOf([[8.5, 5.12, 5.02], [7.0, 5.12, 5.02]]), 0.85, 16), (t) => (Math.floor((Math.atan2(t.z, t.x) / (Math.PI * 2)) * 40 + 40) % 2 ? rgb(h.brim) : shade(rgb(h.brim), 0.88)), 1.5);
      surf(roundBlock([0, 12.6, -0.3], [1.15, 1.05, 1.15], 0.85, { seg: [8, 6] }), solid(h.accent));
      return true;
    case "bandana":
      surf(roundBlock([0, 8.75, -0.15], [4.85, 3.4, 4.8], 0.7, { seg: [16, 8], deform: (p) => { if (p.y < 7.4) p.y = 7.4; } }),
        (t) => (flowerDot(t.x, t.y, t.z) ? rgb("#ffffff") : main), 1.5);
      surf(roundBlock([0, 7.7, -4.95], [0.7, 0.6, 0.45], 0.7, { seg: [8, 5] }), solid(h.main));
      for (const sx of [-1, 1]) surf(strand([sx * 0.3, 7.6, -5.0], [sx * 0.9, 6.3, -5.4], [sx * 1.2, 5.3, -5.2], [0.6, 0.35], [0.14, 0.1], [1, 0, 0], [4, 5]), solid(h.main));
      return true;
    case "headband":
      surf(lathe(ringsOf([[8.4, 4.72, 4.62], [7.2, 4.72, 4.62]]), 0.85, 18), (t) => {
        if (t.z > 3.6 && Math.abs(t.x) < 1.3 && Math.abs(t.y - 7.8) < 0.45) return Math.abs(t.x) > 1.2 || Math.abs(t.y - 7.8) > 0.37 ? INK : SILVER;
        return main;
      }, 2);
      for (const sx of [-1, 1]) surf(strand([sx * 0.4, 7.8, -4.6], [sx * 1.6, 6.8, -6.2], [sx * 2.2, 5.0, -6.4], [0.8, 0.45], [0.12, 0.1], [1, 0, 0], [4, 6]), solid(h.main));
      return true;
    case "lotus": {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2, r = 1.2;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        m.surface("head", roundBlock([x, 11.3, z], [0.75, 1.4, 0.4], 0.8, { seg: [6, 6] }), (t) => (t.y > 12.2 ? main : mix(main, [255, 255, 255], 0.3)),
          new THREE.Matrix4().makeTranslation(0, 0, 0).multiply(new THREE.Matrix4().makeRotationY(-a + Math.PI / 2)).multiply(new THREE.Matrix4().makeRotationX(0.45)).multiply(new THREE.Matrix4().makeTranslation(0, 0, 0)));
      }
      surf(roundBlock([0, 10.9, 0], [1.4, 0.8, 1.4], 0.8, { seg: [8, 5] }), solid(h.shade));
      surf(roundBlock([0, 11.5, 0], [0.55, 0.35, 0.55], 0.8, { seg: [6, 4] }), solid("#f4d03f"));
      return true;
    }
    case "straw": {
      surf(lathe(ringsOf([[12.0, 0, 0], [12.0, 3.9, 3.9], [11.6, 4.5, 4.5], [9.4, 4.8, 4.8], [9.3, 8.4, 8.4], [9.0, 8.7, 8.7], [8.8, 8.3, 8.3], [9.1, 4.6, 4.6], [9.5, 0, 0]]), 1, 24),
        (t) => {
          const r = Math.hypot(t.x, t.z);
          let c = main;
          if (Math.floor((r + (t.y > 9.5 ? t.y : 0)) / 0.35) % 2) c = shade(main, 0.93);
          if (t.y > 9.45 && t.y < 10.2 && r < 5) c = acc;
          return t.n[1] < -0.3 ? shade(c, 0.85) : c;
        }, 1.5);
      return true;
    }
    case "quaithao": {
      // nón quai thao: a wide, flat round hat with a low crown ring and a long fringed silk strap under the chin
      surf(lathe(ringsOf([[9.9, 0, 0], [10.0, 4.0, 4.0], [9.7, 8.0, 8.0], [9.4, 9.4, 9.4], [9.1, 9.3, 9.3], [9.2, 7.6, 7.6], [9.1, 4.2, 4.2], [8.6, 4.4, 4.4], [8.6, 0, 0]]), 1, 28),
        (t) => {
          const r = Math.hypot(t.x, t.z);
          if (t.n[1] < -0.3) return shade(main, 0.8);
          return [2.2, 4.4, 6.6, 8.6].some((k) => Math.abs(r - k) < 0.1) ? sh : main;
        }, 1.2);
      for (const sx of [-1, 1]) {
        m.surface("head", strand([sx * 4.1, 8.6, 0.4], [sx * 5.0, 3.0, 2.0], [sx * 0.6, -0.7, 2.0], [0.32, 0.26], [0.1, 0.08], [0, 0, 1], [4, 8]), solid(h.accent));
        m.surface("head", strand([sx * 0.6, -0.6, 2.0], [sx * 0.9, -1.8, 2.2], [sx * 1.1, -3.0, 2.1], [0.5, 0.7], [0.08, 0.06], [0, 0, 1], [4, 5]), solid("#1d1b1a"));
      }
      return true;
    }
    default:
      return false;
  }
}

const flowerDot = (x: number, y: number, z: number) => {
  const a = Math.atan2(z, x) * 5, f = a - Math.floor(a), g = (y * 1.4) - Math.floor(y * 1.4);
  return Math.hypot(f - 0.5, g - 0.5) < 0.16;
};

export { WHITE };
