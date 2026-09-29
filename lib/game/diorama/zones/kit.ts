import type { GameMap, MapId, PropPlacement, Rect, SignIcon } from "@/lib/game/maps/types";
import { rng } from "../layout";

// Pure: the shared vocabulary of the zone dioramas (the hall, Chợ Lớn, Khu nhà): what a zone builds — ground tiles,
// boxes and pitched roofs, instanced plants, lantern bulbs, night lights and a marker over every interactable — all in
// the map's px (x right, y down; `z0`/`h` are heights in px, the same scale: a character stands 48 px tall).
// render.ts turns a ZoneLayout into Three.js meshes; nothing here needs WebGL, so the layouts are unit-tested.

export type ZGround = "grass" | "dirt" | "sand" | "water" | "cobble" | "pave" | "road" | "soil" | "bamboo" | "stone";

/** An axis-aligned box: footprint (x, y = its north-west corner, w along x, d along y), from `z0` up `h`. */
export interface Box {
  x: number; y: number; w: number; d: number; z0: number; h: number;
  color: number;
  /** Part of a roof/awning group that fades while the player is under or just behind it. */
  roof?: string;
  /** Lit at night (a window, a neon board, a lamp head). */
  glow?: boolean;
}

/** A pitched roof: a prism over the footprint, its ridge along x ("x") or y ("y"), `h` tall from `z0`. */
export interface Gable { x: number; y: number; w: number; d: number; z0: number; h: number; color: number; ridge: "x" | "y"; roof?: string }

export interface ZPlant { x: number; y: number; h: number; seed: number }
export interface ZPalm extends ZPlant { lean: number }
/** A lantern/string-light bulb at height `z` (px). */
export interface Bulb { x: number; y: number; z: number; color: number; size?: number }
/** A floating marker over an interactable, so every thing you can use shows in 3D. */
export interface Marker { id: string; x: number; y: number; z: number }
/** A walkable floor above the ground (a deck, a dock, a stage): characters stand at `top` px on it. */
export interface Deck { rect: Rect; top: number }

export interface ZoneLayout {
  id: MapId;
  width: number;
  height: number;
  tile: number;
  cols: number;
  rows: number;
  ground: ZGround[];
  /** Water surfaces (the first one ripples). */
  water: Rect[];
  decks: Deck[];
  boxes: Box[];
  gables: Gable[];
  /** Fading roof groups: the footprint that makes them fade (px). */
  roofs: Array<Rect & { id: string }>;
  trees: ZPlant[];
  bamboo: ZPlant[];
  bananas: ZPlant[];
  palms: ZPalm[];
  bulbs: Bulb[];
  /** Night point lights (at most MAX_LIGHTS, they cost a shader each). */
  lights: Array<{ x: number; y: number; r: number }>;
  markers: Marker[];
  fences: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  /** Every map prop this zone drew (for the tests: nothing on the map is forgotten). */
  pieces: Array<{ kind: PropPlacement["kind"]; x: number; y: number }>;
}

export interface ZoneOpts {
  /** 0.5 … 1: how many decorative plants. */
  density?: number;
  /** "center" (default): the group's origin is the map's middle, like the pond; "corner": its north-west corner. */
  origin?: "center" | "corner";
  /** The world map: Sông Cái's river runs out through the zone's west and east edges to meet the wild river. */
  openEnds?: boolean;
}

export const MAX_LIGHTS = 8;
/** Above this height (px) a box is overhead: people walk under it. */
export const HEADROOM = 40;
/** Boxes at most this tall (px) are flat enough to walk over (a mat, a path stone, a low bench). */
export const FLAT = 10;

export const COL = {
  wood: 0xb07a45, woodDark: 0x8a5a30, woodDeep: 0x5a3a1e, woodPale: 0xd8b07a, outline: 0x3a2418,
  red: 0xd23a3a, redDark: 0x9a2a2a, gold: 0xe0b33c, goldLight: 0xf6d27a, white: 0xf4f1e8, cream: 0xeadcb8,
  leaf: 0x4f9a3a, green: 0x5caa4a, teal: 0x2e9a94, tealDark: 0x1f6e6a, blue: 0x3a7bd5, grey: 0x8a8e98, greyDark: 0x62666e,
  tile: 0xb0503a, tileDark: 0x8a3a2a, tileGrey: 0x6a6e7a, glass: 0xf6d890, glassDim: 0x8aa0b8, interior: 0x5a3a2a,
  stone: 0x8a7868, stoneLight: 0xa08a74, brick: 0x9a5a44, paper: 0xf4ead0,
} as const;

const SIGN_COL: Record<SignIcon, number> = { fish: 0x3a7bd5, note: 0xd23a3a, rice: 0x9ab83a, cards: 0x7a2e2e, market: 0xe07a2e, home: 0x2e9a94 };

/** Collects a zone's pieces; the zone files call its helpers, then `done()`. */
export class ZoneKit {
  readonly L: ZoneLayout;
  readonly R: () => number;
  readonly density: number;
  private allLights: Array<{ x: number; y: number; r: number; pri: number }> = [];

  constructor(map: GameMap, ground: (x: number, y: number) => ZGround, opts: ZoneOpts = {}, seed = 7) {
    this.density = Math.max(0.3, Math.min(1, opts.density ?? 1));
    this.R = rng(seed);
    const tile = map.cell;
    const cols = Math.ceil(map.width / tile), rows = Math.ceil(map.height / tile);
    const g: ZGround[] = new Array(cols * rows);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) g[r * cols + c] = ground(c * tile + tile / 2, r * tile + tile / 2);
    this.L = {
      id: map.id, width: map.width, height: map.height, tile, cols, rows, ground: g, water: [], decks: [], boxes: [], gables: [],
      roofs: [], trees: [], bamboo: [], bananas: [], palms: [], bulbs: [], lights: [], markers: [], fences: [], pieces: [],
    };
    // every interactable keeps a visible marker, floating just in front of it (where you use it from)
    for (const it of map.interactables) {
      const x = it.rect.x + it.rect.w / 2;
      const y = Math.max(it.rect.y + 2, Math.min(it.rect.y + it.rect.h, it.use.y - 8));
      this.L.markers.push({ id: it.id, x, y, z: 62 });
    }
  }

  box(x: number, y: number, w: number, d: number, h: number, color: number, o: { z0?: number; roof?: string; glow?: boolean } = {}): Box {
    const b: Box = { x, y, w, d, z0: o.z0 ?? 0, h, color, roof: o.roof, glow: o.glow };
    if (w > 0 && d > 0 && h > 0) this.L.boxes.push(b);
    return b;
  }

  /** A box centred on (cx, cy). */
  boxC(cx: number, cy: number, w: number, d: number, h: number, color: number, o: { z0?: number; roof?: string; glow?: boolean } = {}): Box {
    return this.box(cx - w / 2, cy - d / 2, w, d, h, color, o);
  }

  gable(x: number, y: number, w: number, d: number, z0: number, h: number, color: number, ridge: "x" | "y" = "x", roof?: string): void {
    this.L.gables.push({ x, y, w, d, z0, h, color, ridge, roof });
  }

  /** A fading roof group. For a building the camera sees from the south, pass its footprint trimmed so it only fades
   *  when the player is under it or right behind it. */
  roofGroup(id: string, r: Rect): string {
    this.L.roofs.push({ id, ...r });
    return id;
  }

  bulb(x: number, y: number, z: number, color: number, size?: number): void {
    this.L.bulbs.push({ x, y, z, color, size });
  }

  /** A night light; `pri` decides which survive the MAX_LIGHTS cap (higher first). */
  light(x: number, y: number, r: number, pri = 1): void {
    this.allLights.push({ x, y, r, pri });
  }

  fence(x1: number, y1: number, x2: number, y2: number): void {
    this.L.fences.push({ x1, y1, x2, y2 });
  }

  fenceRect(r: Rect): void {
    this.fence(r.x + 1, r.y + 1, r.x + r.w - 1, r.y + 1);
    this.fence(r.x + 1, r.y + r.h - 1, r.x + r.w - 1, r.y + r.h - 1);
    this.fence(r.x + 1, r.y + 1, r.x + 1, r.y + r.h - 1);
    this.fence(r.x + r.w - 1, r.y + 1, r.x + r.w - 1, r.y + r.h - 1);
  }

  /** A string of coloured bulbs from a to b (px ground points and heights), sagging in the middle. */
  lightString(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, sag: number, cols: readonly number[], step = 14): void {
    const n = Math.max(2, Math.round(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / step));
    for (let i = 1; i < n; i++) {
      const f = i / n;
      this.bulb(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f - Math.sin(Math.PI * f) * sag, cols[i % cols.length], 1.8);
    }
  }

  /** A shop/house front: a wall box with windows on its south face. */
  windows(x: number, face: number, w: number, zs: readonly number[], n: number, lit: (i: number, row: number) => boolean, wh = 14, ww = 14): void {
    const gap = w / n;
    zs.forEach((z, row) => {
      for (let i = 0; i < n; i++) {
        const wx = x + gap * i + (gap - ww) / 2;
        this.box(wx - 1, face - 1.2, ww + 2, 1.5, wh + 2, COL.outline, { z0: z - 1 });
        this.box(wx, face - 1, ww, 1.6, wh, lit(i, row) ? COL.glass : COL.glassDim, { z0: z, glow: lit(i, row) });
      }
    });
  }

  /** The props every zone shares (signs, palms, posts, tables…). Returns false for a kind the zone draws itself. */
  prop(p: PropPlacement): boolean {
    const pieces = this.L.pieces;
    const rec = () => pieces.push({ kind: p.kind, x: p.x, y: p.y });
    switch (p.kind) {
      case "palm":
        this.L.palms.push({ x: p.x, y: p.y - 2, h: p.h, lean: Math.abs(p.lean) > 1 ? p.lean / 8 : p.lean, seed: p.seed });
        break;
      case "banana":
        this.L.bananas.push({ x: p.x, y: p.y - 4, h: 34, seed: Math.round(p.x) });
        break;
      case "sign": {
        this.boxC(p.x, p.y - 5, 3, 3, 22, COL.woodDeep);
        this.boxC(p.x, p.y - 5, 16, 3, 10, COL.outline, { z0: 13 });
        this.boxC(p.x, p.y - 4, 14, 2, 8, p.icon ? SIGN_COL[p.icon] : COL.cream, { z0: 14 });
        break;
      }
      case "city_map_post": {
        this.boxC(p.x, p.y - 2, 4, 4, 30, COL.woodDeep);
        this.boxC(p.x, p.y - 2, 20, 3, 15, COL.outline, { z0: 15 });
        this.boxC(p.x, p.y - 1, 18, 2, 13, 0x9ecf8a, { z0: 16 });
        this.boxC(p.x - 3, p.y, 5, 1, 4, 0x3a7bd5, { z0: 20 });
        this.boxC(p.x + 3, p.y, 4, 1, 6, 0xe0b33c, { z0: 18 });
        break;
      }
      case "lightpole": {
        this.boxC(p.x, p.y - 2, 3, 3, 44, 0x3a3a44);
        this.boxC(p.x, p.y - 2, 8, 6, 4, 0x3a3a44, { z0: 44 });
        this.bulb(p.x, p.y - 2, 41, 0xfff1c0, 2.6);
        this.light(p.x, p.y - 2, 46, 3);
        break;
      }
      case "lantern_post": {
        this.boxC(p.x, p.y - 2, 3, 3, 40, COL.woodDeep);
        this.boxC(p.x + 3, p.y - 2, 8, 2, 2, COL.woodDeep, { z0: 40 });
        this.bulb(p.x + 6, p.y - 2, 35, COL.red, 3.4);
        this.light(p.x + 6, p.y - 2, 46, 2);
        break;
      }
      case "board": {
        for (const sx of [-10, 10]) this.boxC(p.x + sx, p.y - 6, 2, 2, 28, COL.woodDeep);
        this.boxC(p.x, p.y - 6, 24, 3, 14, COL.outline, { z0: 12 });
        this.boxC(p.x, p.y - 5, 22, 2, 12, 0xd06a3a, { z0: 13 });
        for (let k = 0; k < 3; k++) this.boxC(p.x - 6 + k * 6, p.y - 4, 4, 1, 5, COL.paper, { z0: 16 });
        this.boxC(p.x, p.y - 6, 26, 5, 2, COL.woodDark, { z0: 27 });
        break;
      }
      case "news_stand": {
        this.boxC(p.x, p.y - 5, 20, 8, 20, 0x3a6e8a);
        this.boxC(p.x, p.y - 2, 18, 2, 8, COL.paper, { z0: 8 });
        this.boxC(p.x, p.y - 5, 24, 10, 3, COL.red, { z0: 24 });
        this.boxC(p.x, p.y - 8, 3, 3, 4, COL.red, { z0: 20 });
        break;
      }
      case "table": {                                       // a café table (the seats stand behind it)
        this.boxC(p.x, p.y - 6, 4, 4, 10, COL.woodDeep);
        this.boxC(p.x, p.y - 6, 26, 10, 2, COL.woodPale, { z0: 10 });
        this.boxC(p.x - 6, p.y - 4, 3, 3, 4, 0xf4f1ea, { z0: 12 });
        break;
      }
      case "eat_table": {
        this.boxC(p.x, p.y - 5, 3, 3, 10, COL.woodDeep);
        this.boxC(p.x, p.y - 5, 22, 7, 2, 0xc0392b, { z0: 10 });
        for (const sx of [-14, 14]) this.boxC(p.x + sx, p.y - 5, 5, 5, 7, 0x3d6fd1);
        break;
      }
      case "shop_counter": {
        this.boxC(p.x, p.y - 8, 76, 8, 14, COL.woodDark);
        this.boxC(p.x, p.y - 8, 78, 9, 2, COL.woodPale, { z0: 14 });
        break;
      }
      case "punch_bag": {
        this.boxC(p.x + 2, p.y - 3, 10, 4, 3, COL.woodDeep);
        this.boxC(p.x + 6, p.y - 3, 2, 2, 42, COL.woodDeep);
        this.boxC(p.x + 2, p.y - 3, 10, 2, 2, COL.woodDeep, { z0: 40 });
        this.boxC(p.x, p.y - 3, 7, 5, 20, 0xb03a2a, { z0: 12 });
        break;
      }
      case "hammock": {                                     // palm A → the light pole
        const x1 = p.x + 6, x2 = p.x2 - 4;
        this.box(x1, p.y - 11, x2 - x1, 7, 2, 0xd9534f, { z0: 9 });
        for (let x = x1 + 4; x < x2; x += 10) this.box(x, p.y - 11, 4, 7, 2.2, 0xf6d27a, { z0: 9 });
        this.box(x1 - 4, p.y - 8, 4, 1, 1, COL.paper, { z0: 16 });
        break;
      }
      case "mixer": {                                       // the DJ booth on the stage's front
        this.boxC(p.x, p.y - 6, 40, 12, 14, 0x2a2a34, { z0: 12 });
        this.boxC(p.x, p.y - 6, 42, 13, 2, 0x4a4a58, { z0: 26 });
        for (let k = 0; k < 5; k++) this.boxC(p.x - 14 + k * 7, p.y - 1, 4, 1, 3, [0xff6f91, 0xffd166, 0x06d6a0, 0x4cc9f0, 0xff6f91][k], { z0: 18, glow: true });
        break;
      }
      case "card_table": {
        const felt = p.game === "poker" ? 0x2f7a4a : p.game === "xidach" ? 0x7a2e2e : p.game === "tienlen" ? 0x3a5aa8 : 0xd8b07a;
        if (p.game === "cao") {                            // a straw mat with cushions (Cào is played on the floor)
          this.boxC(p.x, p.y - 13, 34, 16, 2, felt, { z0: 1 });
          for (const [sx, sy] of [[-20, -13], [20, -13], [-10, -3], [10, -3], [0, -3]]) this.boxC(p.x + sx, p.y + sy, 6, 5, 3, 0xd9534f, { z0: 1 });
        } else {
          this.boxC(p.x, p.y - 13, 4, 4, 11, COL.woodDeep);
          this.boxC(p.x, p.y - 13, 26, 14, 2, felt, { z0: 11 });
          for (const [sx, sy] of [[-17, -13], [17, -13], [0, -3]]) this.boxC(p.x + sx, p.y + sy, 6, 5, 8, COL.woodDark);
        }
        break;
      }
      default:
        return false;
    }
    rec();
    return true;
  }

  /** Plants tucked into a blocked rect (a grove, a hedge): only where the map blocks, so they never stop a walker. */
  fill(r: Rect, spacing: number, add: (x: number, y: number) => void, blocked: (x: number, y: number) => boolean): void {
    const s = spacing / this.density;
    for (let y = r.y + s / 2; y < r.y + r.h; y += s) for (let x = r.x + s / 2; x < r.x + r.w; x += s) {
      const jx = x + (this.R() - 0.5) * s * 0.6, jy = y + (this.R() - 0.5) * s * 0.6;
      if (blocked(jx, jy)) add(jx, jy);
    }
  }

  done(): ZoneLayout {
    this.L.lights = [...this.allLights].sort((a, b) => b.pri - a.pri).slice(0, MAX_LIGHTS).map(({ x, y, r }) => ({ x, y, r }));
    return this.L;
  }
}

/** Is map px (x, y) on a blocked cell (outside the map counts as blocked)? */
export function blockedAt(map: GameMap, x: number, y: number): boolean {
  const c = Math.floor(x / map.cell), r = Math.floor(y / map.cell);
  if (c < 0 || r < 0 || c >= map.cols || r >= map.rows) return true;
  return map.blocked[r * map.cols + c] === 1;
}

/** The height (px) a character stands at on a zone's decks. */
export function zoneHeightAt(L: ZoneLayout, x: number, y: number): number {
  let top = 0;
  for (const d of L.decks) if (x >= d.rect.x && x < d.rect.x + d.rect.w && y >= d.rect.y && y < d.rect.y + d.rect.h) top = Math.max(top, d.top);
  return top;
}
