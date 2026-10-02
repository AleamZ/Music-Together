import type { Gender } from "@/lib/game/types";

// Pure: the chibi's face as a transparent decal laid over the skin, drawn from clean flat shapes (antialiased
// ellipses, arcs and strokes — no pixel noise) at 24 texels per face unit: brows, big anime eyes (sclera, a two-tone
// iris, pupil, two glints, the upper lash line), a hint of a nose, blush, mouth. Boys: slightly smaller eyes with a
// plain lash line, thick straight brows, a flat mouth; girls: taller eyes with a thick winged lash line and a lower
// lash, thin arched brows, stronger blush, a small smile. Expressions: open, blink (swapped in for a moment every few
// seconds), happy (waving), surprised.

export type FaceExpr = "open" | "blink" | "happy" | "surprised";
export const FACE_EXPRS: readonly FaceExpr[] = ["open", "blink", "happy", "surprised"];
/** Texels per face unit; the face is 8×9 units. */
const R = 24;
export const FACE_W = 8 * R;
export const FACE_H = 9 * R;

type C = readonly [number, number, number, number];
const LASH: C = [44, 26, 24, 1];
const BROW: C = [84, 52, 40, 0.92];
const BROW_M: C = [60, 38, 30, 0.96];
const PUPIL: C = [34, 18, 16, 1];
const HI: C = [255, 255, 255, 1];
const WHITE: C = [250, 246, 240, 1];
const BLUSH: C = [240, 124, 120, 1];
const NOSE: C = [170, 96, 76, 1];
const MOUTH: C = [150, 66, 60, 1];
const MOUTH_IN: C = [120, 40, 46, 1];
const TONGUE: C = [232, 118, 118, 1];
const LIP: C = [222, 118, 120, 1];

type Sdf = (x: number, y: number) => number;

/** Signed distance (units, approx.) to an axis-aligned ellipse. */
const ellipse = (cx: number, cy: number, rx: number, ry: number): Sdf => (x, y) => {
  const dx = (x - cx) / rx, dy = (y - cy) / ry;
  return (Math.hypot(dx, dy) - 1) * Math.min(rx, ry);
};
/** A stroke along a segment, radius r. */
const seg = (ax: number, ay: number, bx: number, by: number, r: number): Sdf => (x, y) => {
  const vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1)));
  return Math.hypot(x - ax - vx * t, y - ay - vy * t) - r;
};
/** A stroke along an ellipse's outline (thickness w), kept where `keep` holds. */
const ring = (e: Sdf, w: number, keep: (x: number, y: number) => boolean): Sdf => (x, y) => (keep(x, y) ? Math.abs(e(x, y)) - w / 2 : 1);
const both = (a: Sdf, b: Sdf): Sdf => (x, y) => Math.max(a(x, y), b(x, y));
const either = (a: Sdf, b: Sdf): Sdf => (x, y) => Math.min(a(x, y), b(x, y));

/** The eyes' look (the Look's body sliders): size (×), extra spacing (face units, ±), iris colours (top, bottom). */
export interface FaceEyes {
  size: number; spacing: number; iris: readonly [string, string];
  /** Boys: a beard drawn in the hair colour (flat shapes like everything else). */
  beard?: "none" | "stubble" | "goatee" | "full"; beardColor?: string;
}
const DEFAULT_EYES: FaceEyes = { size: 1, spacing: 0, iris: ["#965830", "#d6924c"] };

const hexC = (h: string, k = 1): C => {
  const n = parseInt(h.slice(1, 7), 16) || 0;
  return [((n >> 16) & 255) * k, ((n >> 8) & 255) * k, (n & 255) * k, 1];
};

/** RGBA bytes, row 0 = top of the face. */
export function facePixels(expr: FaceExpr, gender: Gender, eyes: FaceEyes = DEFAULT_EYES): Uint8Array {
  const IRIS = hexC(eyes.iris[0]), IRIS2 = hexC(eyes.iris[1]), TOP = hexC(eyes.iris[0], 0.5);
  const acc = new Float32Array(FACE_W * FACE_H * 4);                              // premultiplied rgb + alpha
  /** Composites a shape over what is there; `soft` feathers the edge (units). `col` may vary per point. */
  const draw = (sdf: Sdf, col: C | ((x: number, y: number) => C), alpha = 1, soft = 0) => {
    const f = Math.max(0.5 / R, soft);
    for (let py = 0; py < FACE_H; py++) for (let px = 0; px < FACE_W; px++) {
      const x = (px + 0.5) / R, y = (py + 0.5) / R;
      const d = sdf(x, y);
      if (d > f) continue;
      const cov = Math.max(0, Math.min(1, 0.5 - d / (2 * f)));
      if (cov <= 0) continue;
      const c = typeof col === "function" ? col(x, y) : col;
      const a = cov * alpha * c[3], i = (py * FACE_W + px) * 4;
      acc[i] = c[0] * a + acc[i] * (1 - a);
      acc[i + 1] = c[1] * a + acc[i + 1] * (1 - a);
      acc[i + 2] = c[2] * a + acc[i + 2] * (1 - a);
      acc[i + 3] = a + acc[i + 3] * (1 - a);
    }
  };
  const nu = gender === "nu";
  const es = Math.max(0.8, Math.min(1.2, eyes.size));
  const rx = (nu ? 0.72 : 0.6) * es, ry = (nu ? 0.94 : 0.74) * es, cyE = nu ? 4.6 : 4.75;
  for (const sd of [-1, 1] as const) {
    const cx = 4 + sd * (1.72 + Math.max(-0.25, Math.min(0.25, eyes.spacing))), inw = -sd;                                          // inw: toward the nose
    // brows
    if (nu) {
      draw(either(seg(cx - inw * 0.62, cyE - ry - 0.26, cx, cyE - ry - 0.46, 0.06), seg(cx, cyE - ry - 0.46, cx + inw * 0.5, cyE - ry - 0.38, 0.06)), BROW);
    } else {
      draw(seg(cx - inw * 0.62, cyE - ry - 0.44, cx + inw * 0.55, cyE - ry - 0.3, 0.11), BROW_M);
    }
    const eye = ellipse(cx, cyE, rx, ry);
    if (expr === "open" || expr === "surprised") {
      const s = expr === "surprised";
      draw(eye, WHITE);
      const ix = cx + inw * rx * 0.06, iy = cyE + ry * 0.06, irx = rx * (s ? 0.58 : 0.84), iry = ry * (s ? 0.62 : 0.9);
      draw(both(ellipse(ix, iy, irx, iry), eye), (_x, y) => {
        const k = Math.max(0, Math.min(1, (y - (iy - iry * 0.7)) / (iry * 1.5)));
        const a = k < 0.5 ? TOP : IRIS, b = k < 0.5 ? IRIS : IRIS2, t = k < 0.5 ? k * 2 : (k - 0.5) * 2;
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 1];
      });
      draw(ellipse(ix, iy - iry * 0.05, irx * 0.42, iry * 0.48), PUPIL);
      draw(ellipse(cx - rx * 0.3, cyE - ry * 0.34, rx * 0.27, rx * 0.27), HI);
      draw(ellipse(cx + rx * 0.3, cyE + ry * 0.42, rx * 0.13, rx * 0.13), HI, 0.9);
      // the upper lash line (thicker for girls, winged at the outer corner), a short lower lash for girls
      draw(ring(ellipse(cx, cyE + 0.02, rx * 1.02, ry * 1.02), nu ? 0.2 : 0.13, (_x, y) => y < cyE - ry * 0.18), LASH);
      if (nu) {
        draw(seg(cx - inw * rx * 0.9, cyE - ry * 0.5, cx - inw * (rx + 0.3), cyE - ry * 0.86, 0.075), LASH);
        draw(ring(ellipse(cx, cyE, rx * 1.02, ry * 1.02), 0.06, (x, y) => y > cyE + ry * 0.5 && (x - cx) * inw < 0), LASH, 0.6);
      } else draw(seg(cx - inw * rx * 0.95, cyE - ry * 0.4, cx - inw * (rx + 0.08), cyE - ry * 0.1, 0.06), LASH);
    } else if (expr === "blink") {
      draw(ring(ellipse(cx, cyE - ry * 0.25, rx * 0.98, ry * 0.55), nu ? 0.13 : 0.1, (_x, y) => y > cyE - ry * 0.25), LASH);
      if (nu) draw(seg(cx - inw * rx * 0.95, cyE - ry * 0.2, cx - inw * (rx + 0.28), cyE - ry * 0.45, 0.065), LASH);
    } else {
      // happy: ^ ^
      draw(ring(ellipse(cx, cyE + ry * 0.35, rx * 0.9, ry * 0.62), 0.13, (_x, y) => y < cyE + ry * 0.35), LASH);
      if (nu) draw(seg(cx - inw * rx * 0.88, cyE + ry * 0.2, cx - inw * (rx + 0.25), cyE - ry * 0.05, 0.06), LASH);
    }
    // blush under the outer eye
    draw(ellipse(cx - inw * 0.2, cyE + ry + 0.5, nu ? 0.55 : 0.45, nu ? 0.24 : 0.18), BLUSH, nu ? 0.5 : 0.2, 0.18);
  }
  // the beard, under the mouth (drawn before it)
  const bc = eyes.beardColor ? hexC(eyes.beardColor) : LASH;
  const my0 = nu ? 6.95 : 7.05;
  if (eyes.beard === "stubble") draw(both(ellipse(4, 7.35, 2.1, 1.15), (_x, y) => 6.6 - y), bc, 0.2, 0.35);
  else if (eyes.beard === "goatee") {
    draw(ellipse(4, my0 + 0.72, 0.5, 0.42), bc, 0.95);
    draw(seg(3.55, my0 - 0.3, 4.45, my0 - 0.3, 0.08), bc, 0.9);
  } else if (eyes.beard === "full") {
    draw(both(ring(ellipse(4, 6.4, 3.05, 2.1), 1.0, (_x, y) => y > 6.5), ellipse(4, 6.4, 3.6, 2.6)), bc, 0.95);
    draw(ellipse(4, my0 + 0.7, 0.62, 0.45), bc, 0.95);
    draw(seg(3.5, my0 - 0.28, 4.5, my0 - 0.28, 0.1), bc, 0.95);
  }
  // nose: a soft hint
  if (nu) draw(ellipse(4, 6.2, 0.07, 0.05), NOSE, 0.45, 0.06);
  else draw(seg(4.08, 5.9, 4.12, 6.22, 0.05), NOSE, 0.45, 0.04);
  // mouth
  const my = nu ? 6.95 : 7.05;
  if (expr === "happy") {
    const open = both(ellipse(4, my - 0.08, 0.42, 0.4), (x, y) => my - 0.08 - y);
    draw(open, MOUTH_IN);
    draw(both(ellipse(4, my + 0.28, 0.22, 0.14), open), TONGUE);
  } else if (expr === "surprised") {
    draw(ellipse(4, my, 0.2, 0.26), MOUTH_IN);
  } else if (nu) {
    draw(ring(ellipse(4, my - 0.2, 0.3, 0.22), 0.07, (_x, y) => y > my - 0.2), MOUTH);
    draw(ellipse(4, my + 0.1, 0.16, 0.06), LIP, 0.45, 0.05);
  } else {
    draw(seg(3.72, my, 4.28, my - 0.02, 0.055), MOUTH);
  }
  const px = new Uint8Array(FACE_W * FACE_H * 4);
  for (let i = 0; i < px.length; i += 4) {
    const a = acc[i + 3];
    if (a <= 0) continue;
    px[i] = Math.round(acc[i] / a); px[i + 1] = Math.round(acc[i + 1] / a); px[i + 2] = Math.round(acc[i + 2] / a);
    px[i + 3] = Math.round(a * 255);
  }
  // bleed the colours a few texels into the transparent area (smooth filtering then never pulls in black fringes)
  for (let pass = 0; pass < 3; pass++) {
    const src = px.slice();
    for (let y = 0; y < FACE_H; y++) for (let x = 0; x < FACE_W; x++) {
      const i = (y * FACE_W + x) * 4;
      if (src[i + 3] || src[i] || src[i + 1] || src[i + 2]) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= FACE_W || Y >= FACE_H) continue;
        const j = (Y * FACE_W + X) * 4;
        if (!(src[j + 3] || src[j] || src[j + 1] || src[j + 2])) continue;
        px[i] = src[j]; px[i + 1] = src[j + 1]; px[i + 2] = src[j + 2];
        break;
      }
    }
  }
  return px;
}
