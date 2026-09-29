// Rừng tràm's trees in 2D (0097): the world scenery's choppable tràm (near.ts cellTrees) inside the map's window,
// in map px, and how to draw one (a slim pale trunk and a feathery grey-green crown) or its stump once felled
// (felled-store.ts). Pure geometry + a canvas painter (browser only for the drawing).
import { RT_H, RT_ORIGIN, RT_W } from "@/lib/game/maps/rung-tram";
import { cellTrees } from "./near";
import { treeKey } from "./catalog";

export interface Tree2D { key: string; cx: number; cy: number; k: number; x: number; y: number }

let cache: Tree2D[] | null = null;

/** Every choppable tree of Rừng tràm, in its px. */
export function rungTramTrees(): readonly Tree2D[] {
  if (cache) return cache;
  const out: Tree2D[] = [];
  const cx0 = Math.floor(RT_ORIGIN.x / 64), cy0 = Math.floor(RT_ORIGIN.y / 64);
  for (let cy = cy0; cy < cy0 + RT_H / 64; cy++) for (let cx = cx0; cx < cx0 + RT_W / 64; cx++) {
    cellTrees(cx, cy).forEach((t, k) => out.push({ key: treeKey(cx, cy, k), cx, cy, k, x: t.x - RT_ORIGIN.x, y: t.y - RT_ORIGIN.y }));
  }
  cache = out;
  return out;
}

type Ctx = CanvasRenderingContext2D;
const px = (b: Ctx, x: number, y: number, w: number, h: number, c: string) => { b.fillStyle = c; b.fillRect(Math.round(x), Math.round(y), w, h); };

/** A tràm at its foot (sx, sy) in screen px; `sway` 0…1 moves the crown a pixel. */
export function drawTram(b: Ctx, sx: number, sy: number, seed: number, sway: number): void {
  const h = 22 + (seed % 7), s = sway > 0.5 ? 1 : 0;
  b.globalAlpha = 0.25; px(b, sx - 5, sy - 1, 10, 2, "#14110c"); b.globalAlpha = 1;
  px(b, sx - 1, sy - h, 2, h, "#d8d0bc"); px(b, sx, sy - h, 1, h, "#b8ae98");
  for (let k = 0; k < 4; k++) px(b, sx - 1 + (k % 2), sy - 4 - k * 5, 1, 2, "#8a8270");
  const top = sy - h - 10;
  px(b, sx - 6 + s, top + 3, 12, 8, "#6f8c4e"); px(b, sx - 4 + s, top, 8, 12, "#7f9a5a");
  px(b, sx - 3 + s, top + 1, 4, 3, "#94a86a"); px(b, sx - 7 + s, top + 6, 3, 3, "#6f8c4e"); px(b, sx + 5 + s, top + 5, 3, 3, "#6f8c4e");
}

/** A felled tràm's stump and a few chips. */
export function drawStump(b: Ctx, sx: number, sy: number): void {
  px(b, sx - 3, sy - 4, 6, 4, "#b8ae98"); px(b, sx - 2, sy - 5, 4, 1, "#e8dcc0"); px(b, sx - 1, sy - 5, 1, 1, "#a8946a");
  px(b, sx + 4, sy - 1, 1, 1, "#e8dcc0"); px(b, sx - 6, sy, 2, 1, "#e8dcc0");
}
