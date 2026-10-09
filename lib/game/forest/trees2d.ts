// Rừng tràm's trees in 2D (0097): the world scenery's choppable tràm (near.ts cellTrees) inside the map's window,
// in map px, and how to draw one (a slim pale trunk and a feathery grey-green crown) or its stump once felled
// (felled-store.ts). Pure geometry + a canvas painter (browser only for the drawing).
import { RT_H, RT_ORIGIN, RT_W } from "@/lib/game/maps/rung-tram";
import { cellTrees } from "./near";
import { treeKey, treeOf, type TreeId } from "./catalog";

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

/** 0121: a crown palette [shade, body, light] by tree kind, so the rarer trees (worth more logs) stand out in 2D; the
 *  common kinds keep the tràm's grey-green. */
export const CROWN: Partial<Record<TreeId, readonly [string, string, string]>> = {
  cay_soi: ["#4f7a3a", "#5f8c44", "#7aa456"],
  cay_go_do: ["#8a4a32", "#a0583a", "#c07a52"],
  cay_tram_huong: ["#6a5a2e", "#8a7838", "#b8a050"],
  cay_than_moc: ["#2e5a4a", "#3a7a62", "#e8d070"],
};
const TRAM_CROWN = ["#6f8c4e", "#7f9a5a", "#94a86a"] as const;

/** 0123: the kind of the choppable tràm at world px (x, y) — the tree k of its cell (near.ts cellTrees) — or null. The 3D
 *  forest tints the rarer kinds' instances with it (CROWN's body colour). */
export function choppableKindAt(x: number, y: number): TreeId | null {
  const cx = Math.floor(x / 64), cy = Math.floor(y / 64);
  const k = cellTrees(cx, cy).findIndex((t) => Math.round(t.x) === Math.round(x) && Math.round(t.y) === Math.round(y));
  return k < 0 ? null : treeOf(cx, cy, k).id;
}

/** A tràm at its foot (sx, sy) in screen px; `sway` 0…1 moves the crown a pixel; `kind` tints a rarer tree's crown. */
export function drawTram(b: Ctx, sx: number, sy: number, seed: number, sway: number, kind?: TreeId): void {
  const h = 22 + (seed % 7), s = sway > 0.5 ? 1 : 0;
  const [shade, body, light] = (kind && CROWN[kind]) ?? TRAM_CROWN;
  b.globalAlpha = 0.25; px(b, sx - 5, sy - 1, 10, 2, "#14110c"); b.globalAlpha = 1;
  px(b, sx - 1, sy - h, 2, h, "#d8d0bc"); px(b, sx, sy - h, 1, h, "#b8ae98");
  for (let k = 0; k < 4; k++) px(b, sx - 1 + (k % 2), sy - 4 - k * 5, 1, 2, "#8a8270");
  const top = sy - h - 10;
  px(b, sx - 6 + s, top + 3, 12, 8, shade); px(b, sx - 4 + s, top, 8, 12, body);
  px(b, sx - 3 + s, top + 1, 4, 3, light); px(b, sx - 7 + s, top + 6, 3, 3, shade); px(b, sx + 5 + s, top + 5, 3, 3, shade);
}

/** 0123: a trap on the forest floor at (sx, sy): a wooden cage with its door propped, or iron jaws; `ready` glints. */
export function drawTrap(b: Ctx, sx: number, sy: number, iron: boolean, ready: boolean, t: number): void {
  if (iron) {
    px(b, sx - 5, sy - 2, 10, 2, "#4a4c54");
    for (let i = 0; i < 4; i++) { px(b, sx - 4 + i * 3, sy - 4, 1, 2, "#c8ccd4"); }
    px(b, sx - 5, sy - 3, 1, 1, "#5a5f68"); px(b, sx + 4, sy - 3, 1, 1, "#5a5f68");
  } else {
    px(b, sx - 5, sy - 1, 10, 1, "#6e4424");
    for (const x of [-5, 4]) px(b, sx + x, sy - 6, 1, 5, "#8b5a33");
    for (let i = 0; i < 3; i++) px(b, sx - 5, sy - 6 + i * 2, 10, 1, "#8b5a33");
    px(b, sx + 5, sy - 9, 1, 4, "#6e4424"); px(b, sx + 6, sy - 5, 1, 4, "#a8743f");
  }
  if (ready) { const on = Math.floor(t / 300) % 2 === 0; px(b, sx, sy - 11, 1, 1, on ? "#fff6c0" : "#f6c945"); px(b, sx - 1, sy - 10, 3, 1, "#f6c945"); }
}

/** A felled tràm's stump and a few chips. */
export function drawStump(b: Ctx, sx: number, sy: number): void {
  px(b, sx - 3, sy - 4, 6, 4, "#b8ae98"); px(b, sx - 2, sy - 5, 4, 1, "#e8dcc0"); px(b, sx - 1, sy - 5, 1, 1, "#a8946a");
  px(b, sx + 4, sy - 1, 1, 1, "#e8dcc0"); px(b, sx - 6, sy, 2, 1, "#e8dcc0");
}
