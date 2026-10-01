import { FISH_ICONS } from "@/lib/game/art/fish";
import type { PixelIcon } from "@/lib/game/art/icons";

// Pure: each fish species' 3D silhouette, derived from its 2D 16×16 icon (lib/game/art/fish.ts, gear-v3.ts) so the
// held fish, the landed catch and the leaping fish read as the same species in 3D: the body's length and depth from
// the icon's bounding box, its colours from the palette (body = the most painted, belly = the most painted below the
// middle, fins = the most painted at the tail end), a pattern from the leftover colour, and the tail's shape from the
// last column. The odd ones (eels, the shrimp, the turtles, the stingray) are a `kind` with their own model.

export type FishKind = "fish" | "eel" | "shrimp" | "turtle" | "ray";
export type FishPattern = "plain" | "stripes" | "spots";

export interface Fish3D {
  kind: FishKind;
  /** Body length and depth (units; the held fish is drawn at this size, ~0.3–0.7). */
  len: number;
  depth: number;
  /** Width (side to side) as a share of depth: flat fish (cá thát lát, cá chim) are thin. */
  thin: number;
  body: number;
  belly: number;
  fin: number;
  accent: number;
  pattern: FishPattern;
  /** Forked (V) or round (fan) tail; a dorsal fin along the back. */
  tail: "fork" | "round";
  dorsal: boolean;
}

const KIND: Readonly<Record<string, FishKind>> = {
  luon_dong: "eel", ca_chinh: "eel", tom_cang: "shrimp", rua_mai_vang: "turtle", ba_ba: "turtle", ca_duoi_song: "ray",
};

const hex = (s: string): number => parseInt(s.replace("#", "").slice(0, 6), 16);

function lighten(c: number, k: number): number {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k >= 1 ? v + (255 - v) * (k - 1) : v * k)));
  return (f(r) << 16) | (f(g) << 8) | f(b);
}

/** The most frequent letter among `cells` (excluding `skip`), or null. */
function top(cells: readonly string[], skip: ReadonlySet<string>): string | null {
  const n = new Map<string, number>();
  for (const c of cells) if (!skip.has(c)) n.set(c, (n.get(c) ?? 0) + 1);
  let best: string | null = null, bn = 0;
  for (const [c, k] of n) if (k > bn) { best = c; bn = k; }
  return best;
}

/** A species' 3D parameters from its icon. */
export function fishParamsFromIcon(id: string, icon: PixelIcon): Fish3D {
  const rows = icon.rows;
  let x0 = 99, x1 = -1, y0 = 99, y1 = -1;
  const all: { x: number; y: number; c: string }[] = [];
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === ".") return;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    if (c !== "o" && icon.pal[c]) all.push({ x, y, c });
  }));
  const w = Math.max(1, x1 - x0 + 1), h = Math.max(1, y1 - y0 + 1);
  const NONE = new Set<string>(["k"]);
  const bodyL = top(all.map((p) => p.c), NONE) ?? Object.keys(icon.pal)[0];
  const midY = (y0 + y1) / 2;
  const bellyL = top(all.filter((p) => p.y > midY).map((p) => p.c), new Set([...NONE, bodyL]));
  const tailX = x1 - w * 0.25;
  const finL = top(all.filter((p) => p.x >= tailX || p.y <= y0 + 1).map((p) => p.c), new Set([...NONE, bodyL, bellyL ?? ""]));
  const accentL = top(all.map((p) => p.c), new Set([...NONE, bodyL, bellyL ?? "", finL ?? ""]));
  const body = hex(icon.pal[bodyL]);
  const accentCells = accentL ? all.filter((p) => p.c === accentL) : [];
  let pattern: FishPattern = "plain";
  if (accentCells.length >= 4) {
    const cols = new Set(accentCells.map((p) => p.x)).size, rws = new Set(accentCells.map((p) => p.y)).size;
    pattern = rws >= cols ? "stripes" : "spots";
  }
  // the tail: the last painted column with a gap between its cells (a V) or solid (a fan)
  const lastCol = rows.map((r) => r[x1 - 1] ?? ".").map((c, y) => ({ c, y })).filter((q) => q.c !== ".").map((q) => q.y);
  const gap = lastCol.length > 1 && lastCol.some((y, i) => i > 0 && y - lastCol[i - 1] > 1);
  const dorsal = all.some((p) => p.y <= y0 + 1 && p.c !== bodyL);
  const kind = KIND[id] ?? "fish";
  const len = 0.28 + (w / 16) * 0.42, depth = len * Math.min(0.58, Math.max(0.2, h / w * 0.8));
  return {
    kind, len, depth, thin: h / w > 0.7 ? 0.45 : 0.62,
    body, belly: bellyL ? hex(icon.pal[bellyL]) : lighten(body, 1.45), fin: finL ? hex(icon.pal[finL]) : lighten(body, 0.75),
    accent: accentL ? hex(icon.pal[accentL]) : lighten(body, 0.6), pattern, tail: gap ? "fork" : "round", dorsal,
  };
}

/** Every species with a 2D icon (FISH_ICONS also holds no gear: its keys are the species). */
export const FISH_SPECIES_3D: readonly string[] = Object.keys(FISH_ICONS);

const cache = new Map<string, Fish3D>();
/** A species' 3D parameters (an unknown id gets a plain grey-gold fish). */
export function fishParams(id: string): Fish3D {
  let f = cache.get(id);
  if (!f) {
    const icon = FISH_ICONS[id];
    f = icon ? fishParamsFromIcon(id, icon) : { kind: "fish", len: 0.5, depth: 0.2, thin: 0.6, body: 0xc8b060, belly: 0xeee0b0, fin: 0x9a8040, accent: 0x7a6030, pattern: "plain", tail: "fork", dorsal: true };
    cache.set(id, f);
  }
  return f;
}
