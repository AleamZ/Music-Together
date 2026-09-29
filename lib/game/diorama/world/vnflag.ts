// Pure: the national flag of Việt Nam to its official specification — a red field (#DA251D) whose width : length is
// 2 : 3, with a regular five-pointed yellow star (#FFFF00) at its exact centre, one point straight up, the star's
// circumscribed radius 1/5 of the flag's length, its inner radius that × 0.381966 (the golden-ratio star). The star is
// an exact 10-vertex polygon; `flagPixels` paints it into RGBA texels (supersampled edges, no blob) so the waving cloth
// carries it on both sides without a second layer to fight.

export const VN_RED = 0xda251d;
export const VN_YELLOW = 0xffff00;
/** width (height) : length */
export const VN_RATIO = 2 / 3;
export const STAR_OUTER = 1 / 5;
export const STAR_INNER_K = 0.381966;

/** The star's 10 vertices (outer, inner, …), the first straight up, for a flag `length` long centred at (cx, cy).
 *  Y up. */
export function vnStar(length: number, cx = 0, cy = 0): Array<{ x: number; y: number }> {
  const R = length * STAR_OUTER, r = R * STAR_INNER_K;
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5, k = i % 2 ? r : R;
    out.push({ x: cx + Math.cos(a) * k, y: cy + Math.sin(a) * k });
  }
  return out;
}

function inside(poly: ReadonlyArray<{ x: number; y: number }>, x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** The flag as RGBA texels, `w` wide (its height follows 2 : 3), row 0 = the top; 4×4 samples per texel at the star's
 *  edge. */
export function flagPixels(w = 300): { w: number; h: number; rgba: Uint8Array } {
  const h = Math.round(w * VN_RATIO);
  const star = vnStar(w, w / 2, h / 2);
  const rgba = new Uint8Array(w * h * 4);
  const red = [(VN_RED >> 16) & 255, (VN_RED >> 8) & 255, VN_RED & 255], yel = [(VN_YELLOW >> 16) & 255, (VN_YELLOW >> 8) & 255, VN_YELLOW & 255];
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    let n = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if (inside(star, px + (sx + 0.5) / 4, h - (py + (sy + 0.5) / 4))) n++;
    const f = n / 16, i = (py * w + px) * 4;
    for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(red[c] + (yel[c] - red[c]) * f);
    rgba[i + 3] = 255;
  }
  return { w, h, rgba };
}
