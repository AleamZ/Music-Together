import type { GameMap, MapId, PropPlacement, Rect, SignIcon as MapSignIcon } from "@/lib/game/maps/types";
import { rng } from "../layout";
import { separateCoplanar, type AABB } from "./coplanar";
import type { SeatAnchor } from "./seats";
import type { SignArt, SignIcon } from "./signart";
import { signSize } from "./signart";

// Pure: the shared vocabulary of the zone dioramas (the hall, Chợ Lớn, Khu nhà): what a zone builds — ground tiles,
// boxes, cylinders, beams and pitched roofs, painted sign faces, instanced plants, lantern bulbs, night lights, a
// marker over every interactable and a real seat under every place the game seats someone — all in the map's px (x
// right, y down; `z0`/`h` are heights in px, the same scale: a character stands 48 px tall). render.ts turns a
// ZoneLayout into Three.js meshes; nothing here needs WebGL, so the layouts are unit-tested.
//
// Flicker-free by construction: `done()` pushes apart every pair of box faces that share a plane (see coplanar.ts), and
// every painted face floats DECAL_LIFT px in front of the board it is painted on.

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

/** A cylinder (a leg, a stool, a round table top, a chip stack, a speaker cone): centre (x, y), radius r (ry across y
 *  for an oval), from z0 up h. `axis` "y": lying along y (its face to the south: a woofer, a turntable seen edge-on). */
export interface Cyl {
  x: number; y: number; z0: number; h: number; r: number; ry?: number;
  /** Top radius as a fraction of the bottom's (1: straight). */
  taper?: number;
  seg?: number;
  axis?: "z" | "y";
  color: number;
  roof?: string;
  glow?: boolean;
}

/** A bar between two 3D points (px, heights in px): a rope, a wire, a strut, a hammock's cord. */
export interface Beam { x1: number; y1: number; z1: number; x2: number; y2: number; z2: number; t: number; color: number }

/** A painted face: its centre (x, y px, z height px), size (w × h px), which way it looks, and the painting. */
export interface SignFace { x: number; y: number; z: number; w: number; h: number; face: "s" | "n" | "e" | "w"; art: SignArt }

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
  cyls: Cyl[];
  beams: Beam[];
  signs: SignFace[];
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
  /** Every seat built (a chair/stool/cushion/hammock under each): where sitters go. */
  seats: SeatAnchor[];
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
/** Two parallel faces closer than this (px) flicker: done() pushes them this far apart. */
export const COPLANAR_SEP = 0.35;
/** How far (px) a painted face floats in front of its board. */
export const DECAL_LIFT = 0.4;
/** A sign's texel in px (a 5×7 letter is 3 × 4.2 px: readable from the follow camera). */
export const TEXEL = 0.6;

export const COL = {
  wood: 0xb07a45, woodDark: 0x8a5a30, woodDeep: 0x5a3a1e, woodPale: 0xd8b07a, outline: 0x3a2418,
  red: 0xd23a3a, redDark: 0x9a2a2a, gold: 0xe0b33c, goldLight: 0xf6d27a, white: 0xf4f1e8, cream: 0xeadcb8,
  leaf: 0x4f9a3a, green: 0x5caa4a, teal: 0x2e9a94, tealDark: 0x1f6e6a, blue: 0x3a7bd5, grey: 0x8a8e98, greyDark: 0x62666e,
  tile: 0xb0503a, tileDark: 0x8a3a2a, tileGrey: 0x6a6e7a, glass: 0xf6d890, glassDim: 0x8aa0b8, interior: 0x5a3a2a,
  stone: 0x8a7868, stoneLight: 0xa08a74, brick: 0x9a5a44, paper: 0xf4ead0, metal: 0x3a3a44, black: 0x24232a,
} as const;

const SIGN_COL: Record<MapSignIcon, number> = { fish: 0x3a7bd5, note: 0xd23a3a, rice: 0x9ab83a, cards: 0x7a2e2e, market: 0xe07a2e, home: 0x2e9a94 };
const FELT: Record<string, number> = { poker: 0x2f7a4a, xidach: 0x7a2e2e, tienlen: 0x3a5aa8, cao: 0xd8b07a };

/** Every visible painted board carries its words in capitals (the pixel font draws the Vietnamese marks). */
export const upper = (s: string) => s.normalize("NFC").toLocaleUpperCase("vi");

/** A label in at most two balanced lines (a long name wraps at the space nearest its middle). */
export function wrap(s: string, max = 9): string[] {
  const t = upper(s);
  if ([...t].length <= max || !t.includes(" ")) return [t];
  const mid = t.length / 2;
  let best = -1;
  for (let i = 0; i < t.length; i++) if (t[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return [t.slice(0, best), t.slice(best + 1)];
}

type BoxOpts = { z0?: number; roof?: string; glow?: boolean };

/** Collects a zone's pieces; the zone files call its helpers, then `done()`. */
export class ZoneKit {
  readonly L: ZoneLayout;
  readonly R: () => number;
  readonly density: number;
  readonly map: GameMap;
  private allLights: Array<{ x: number; y: number; r: number; pri: number }> = [];

  constructor(map: GameMap, ground: (x: number, y: number) => ZGround, opts: ZoneOpts = {}, seed = 7) {
    this.map = map;
    this.density = Math.max(0.3, Math.min(1, opts.density ?? 1));
    this.R = rng(seed);
    const tile = map.cell;
    const cols = Math.ceil(map.width / tile), rows = Math.ceil(map.height / tile);
    const g: ZGround[] = new Array(cols * rows);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) g[r * cols + c] = ground(c * tile + tile / 2, r * tile + tile / 2);
    this.L = {
      id: map.id, width: map.width, height: map.height, tile, cols, rows, ground: g, water: [], decks: [], boxes: [], cyls: [], beams: [],
      signs: [], gables: [], roofs: [], trees: [], bamboo: [], bananas: [], palms: [], bulbs: [], lights: [], markers: [], fences: [],
      seats: [], pieces: [],
    };
    // every interactable keeps a visible marker, floating just in front of it (where you use it from)
    for (const it of map.interactables) {
      const x = it.rect.x + it.rect.w / 2;
      const y = Math.max(it.rect.y + 2, Math.min(it.rect.y + it.rect.h, it.use.y - 8));
      this.L.markers.push({ id: it.id, x, y, z: 62 });
    }
  }

  box(x: number, y: number, w: number, d: number, h: number, color: number, o: BoxOpts = {}): Box {
    const b: Box = { x, y, w, d, z0: o.z0 ?? 0, h, color, roof: o.roof, glow: o.glow };
    if (w > 0 && d > 0 && h > 0) this.L.boxes.push(b);
    return b;
  }

  /** A box centred on (cx, cy). */
  boxC(cx: number, cy: number, w: number, d: number, h: number, color: number, o: BoxOpts = {}): Box {
    return this.box(cx - w / 2, cy - d / 2, w, d, h, color, o);
  }

  cyl(x: number, y: number, r: number, h: number, color: number, o: Omit<Cyl, "x" | "y" | "r" | "h" | "color" | "z0"> & { z0?: number } = {}): void {
    if (r > 0 && h > 0) this.L.cyls.push({ x, y, r, h, color, ...o, z0: o.z0 ?? 0 });
  }

  beam(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, t: number, color: number): void {
    this.L.beams.push({ x1, y1, z1, x2, y2, z2, t, color });
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

  /** A paper lantern: the glowing bulb with a dark cap and tassel (so it reads as a lantern, not a floating ball). */
  lantern(x: number, y: number, z: number, color: number, size = 3): void {
    this.bulb(x, y, z, color, size);
    this.cyl(x, y, size * 0.55, 1, COL.outline, { z0: z + size * 1.1, seg: 8 });
    this.cyl(x, y, size * 0.45, 1, COL.outline, { z0: z - size * 1.2 - 1, seg: 8 });
    this.cyl(x, y, 0.35, 3, COL.gold, { z0: z - size * 1.2 - 4, seg: 5 });
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

  /** A string of coloured bulbs from a to b (px ground points and heights), sagging in the middle, on a thin wire. */
  lightString(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, sag: number, cols: readonly number[], step = 14): void {
    const n = Math.max(2, Math.round(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / step));
    const at = (f: number) => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f - Math.sin(Math.PI * f) * sag });
    for (let i = 0; i < n; i++) {
      const p = at(i / n), q = at((i + 1) / n);
      this.beam(p.x, p.y, p.z + 1.4, q.x, q.y, q.z + 1.4, 0.35, COL.outline);
      if (i > 0) { this.bulb(p.x, p.y, p.z, cols[i % cols.length], 1.8); this.cyl(p.x, p.y, 0.8, 1, COL.outline, { z0: p.z + 1.4, seg: 5 }); }
    }
  }

  /** A shop/house front: a wall box with windows on its south face (a frame, the glass, a sill and a mullion). */
  windows(x: number, face: number, w: number, zs: readonly number[], n: number, lit: (i: number, row: number) => boolean, wh = 14, ww = 14): void {
    const gap = w / n;
    zs.forEach((z, row) => {
      for (let i = 0; i < n; i++) {
        const wx = x + gap * i + (gap - ww) / 2, on = lit(i, row);
        this.box(wx - 1, face - 1.2, ww + 2, 1.6, wh + 2, COL.outline, { z0: z - 1 });
        this.box(wx, face - 1, ww, 2, wh, on ? COL.glass : COL.glassDim, { z0: z, glow: on });
        this.box(wx + ww / 2 - 0.5, face - 1, 1, 2.6, wh, COL.outline, { z0: z });
        this.box(wx - 1.5, face - 1, ww + 3, 2.8, 1.2, COL.stoneLight, { z0: z - 2 });
      }
    });
  }

  /** A painted face (px centre, `w` px wide; its height follows the painting's shape). Returns its height. */
  signFace(x: number, y: number, z: number, art: SignArt, face: SignFace["face"] = "s", w?: number): { w: number; h: number } {
    const s = signSize(art);
    const fw = w ?? s.w * TEXEL, fh = fw * (s.h / s.w);
    this.L.signs.push({ x, y, z, w: fw, h: fh, face, art });
    return { w: fw, h: fh };
  }

  /**
   * A signboard: a painted board in a frame, facing south, on 0 / 1 / 2 posts (px: the posts stand at cy). `z0` is the
   * board's bottom. Returns the board's size.
   */
  signboard(cx: number, cy: number, art: SignArt, o: { z0: number; posts?: 0 | 1 | 2; w?: number; frame?: number; post?: number; cap?: number; face?: SignFace["face"]; depth?: number } = { z0: 12 }): { w: number; h: number } {
    const s = signSize(art);
    const w = o.w ?? s.w * TEXEL, h = w * (s.h / s.w), dp = o.depth ?? 1.6, frame = o.frame ?? COL.outline;
    const posts = o.posts ?? 1, post = o.post ?? COL.woodDeep, face = o.face ?? "s";
    const top = o.z0 + h;
    if (posts === 1) this.cyl(cx, cy, 1.3, top + 2, post, { seg: 6 });
    if (posts === 2) for (const sx of [-1, 1]) this.cyl(cx + sx * (w / 2 - 0.5), cy, 1.1, top + 3, post, { seg: 6 });
    const ns = face === "s" || face === "n";
    // the frame: a board 1 px bigger all round, behind the face
    const fy = face === "s" ? cy + 1.2 : face === "n" ? cy - 1.2 : cy;
    if (ns) this.boxC(cx, fy, w + 2, dp, h + 2, frame, { z0: o.z0 - 1 });
    else this.boxC(cx, cy, dp, w + 2, h + 2, frame, { z0: o.z0 - 1 });
    const off = dp / 2 + DECAL_LIFT;
    const fx = face === "e" ? cx + off : face === "w" ? cx - off : cx;
    const fz = face === "s" ? fy + off : face === "n" ? fy - off : cy;
    this.L.signs.push({ x: fx, y: fz, z: o.z0 + h / 2, w, h, face, art });
    if (o.cap !== undefined) {                                   // a little plank roof over the board
      if (ns) this.boxC(cx, fy, w + 4, dp + 1.2, 1.4, o.cap, { z0: top + 1 });
      else this.boxC(cx, cy, dp + 1.2, w + 4, 1.4, o.cap, { z0: top + 1 });
    }
    return { w, h };
  }

  /** The label of the interactable nearest (px) — a sign names what it points at. */
  labelNear(x: number, y: number, within = 40): string | null {
    let best: string | null = null, bd = within;
    for (const it of this.map.interactables) {
      const d = Math.hypot(it.rect.x + it.rect.w / 2 - x, it.rect.y + it.rect.h / 2 - y);
      if (d < bd) { bd = d; best = it.label; }
    }
    return best;
  }

  // ------------------------------------------------------------------ furniture

  /** A round stool: a padded seat on a pedestal with a foot ring (its top at `top` px, from `ground`). */
  stool(x: number, y: number, top: number, ground = 0, seat: number = COL.red): void {
    const h = top - ground;
    this.cyl(x, y, 3, 1.4, seat, { z0: top - 1.4, seg: 10 });
    this.cyl(x, y, 3.2, 0.6, COL.outline, { z0: top - 2, seg: 10 });
    this.cyl(x, y, 0.8, h - 2, COL.metal, { z0: ground, seg: 6 });
    this.cyl(x, y, 2.4, 0.5, COL.metal, { z0: ground + h * 0.35, seg: 10 });
    this.cyl(x, y, 2.2, 0.6, COL.metal, { z0: ground, seg: 10, taper: 0.8 });
  }

  /** A chair with a back (facing `yaw`: its back on the far side), seat top at `top` px from `ground`. */
  chair(x: number, y: number, yaw: number, top: number, ground = 0, color: number = COL.wood): void {
    const h = top - ground, s = 6.5;
    this.boxC(x, y, s, s, 1.2, color, { z0: top - 1.2 });
    for (const [lx, ly] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.cyl(x + lx * (s / 2 - 0.8), y + ly * (s / 2 - 0.8), 0.55, h - 1.2, COL.woodDeep, { z0: ground, seg: 5 });
    // the back on the side away from where the sitter looks (snap to the nearest side)
    const bx = -Math.sin(yaw), by = -Math.cos(yaw);
    const ax = Math.abs(bx) > Math.abs(by);
    const px = x + (ax ? Math.sign(bx) * (s / 2 - 0.5) : 0), py = y + (ax ? 0 : Math.sign(by) * (s / 2 - 0.5));
    if (ax) { this.boxC(px, py, 1, s, 9, color, { z0: top }); for (const sy of [-1, 1]) this.cyl(px, py + sy * (s / 2 - 0.8), 0.55, 9, COL.woodDeep, { z0: top }); }
    else { this.boxC(px, py, s, 1, 9, color, { z0: top }); for (const sx of [-1, 1]) this.cyl(px + sx * (s / 2 - 0.8), py, 0.55, 9, COL.woodDeep, { z0: top }); }
    this.boxC(px, py, ax ? 1.4 : s + 0.6, ax ? s + 0.6 : 1.4, 1, COL.woodDark, { z0: top + 9 });
  }

  /** A floor cushion (Cào is played on a mat). */
  cushion(x: number, y: number, top: number, ground: number, color: number): void {
    this.cyl(x, y, 3.2, top - ground, color, { z0: ground, seg: 8, taper: 0.9 });
    this.cyl(x, y, 1, 0.4, COL.gold, { z0: top, seg: 6 });
  }

  /** A park/yard bench along x (seat top 7 px): slats, legs, a low back on the north side. */
  bench(x: number, y: number, w: number, color: number = COL.wood): void {
    for (let k = 0; k < 3; k++) this.box(x, y + k * 2.2, w, 1.8, 1, color, { z0: 6 });
    // a low back (the park stays walkable: nothing over FLAT px), cast-iron ends
    for (const lx of [x + 1.5, x + w - 3]) { this.box(lx, y, 1.5, 6.6, 6, COL.metal); this.box(lx, y - 0.6, 1.5, 1.2, 9.6, COL.metal); }
    this.box(x, y - 0.8, w, 1.2, 2, color, { z0: 7.4 });
  }

  /** A seat's furniture under an anchor (and the anchor recorded for the sitters). */
  seat(a: SeatAnchor, color?: number): void {
    if (a.kind === "stool") this.stool(a.x, a.y, a.top, a.ground, color ?? COL.red);
    else if (a.kind === "chair") this.chair(a.x, a.y, a.yaw, a.top, a.ground, color ?? COL.wood);
    else if (a.kind === "cushion") this.cushion(a.x, a.y, a.top, a.ground, color ?? COL.red);
    this.L.seats.push(a);
  }

  /** Playing cards and chip stacks on a table top at `z` px, around (cx, cy) inside rx × ry. */
  tableTop(cx: number, cy: number, z: number, rx: number, ry: number, seats: number, seed: number): void {
    const R = rng(seed);
    // the deck in the middle, a few cards face down before each seat, chip stacks beside them — staggered heights
    this.boxC(cx, cy, 3, 4, 1.2, COL.white, { z0: z });
    this.boxC(cx, cy, 2.2, 3.2, 0.3, 0x2f4fa8, { z0: z + 1.2 });
    for (let i = 0; i < seats; i++) {
      const a = Math.PI / 2 + (i / seats) * Math.PI * 2;
      const px = cx + Math.cos(a) * rx * 0.62, py = cy + Math.sin(a) * ry * 0.62;
      this.boxC(px, py, 2.4, 3.2, 0.4, COL.white, { z0: z + 0.05 * (i % 3) });
      this.boxC(px + 0.9, py - 0.4, 2.4, 3.2, 0.4, i % 2 ? COL.white : 0xf2e6c8, { z0: z + 0.45 + 0.05 * (i % 2) });
      const chips = 1 + Math.floor(R() * 4);
      const hx = cx + Math.cos(a + 0.35) * rx * 0.42, hy = cy + Math.sin(a + 0.35) * ry * 0.42;
      for (let c = 0; c < chips; c++) this.cyl(hx, hy, 1.1, 0.6, [COL.red, COL.gold, 0x2f6fd8, COL.white][(i + c) % 4], { z0: z + c * 0.6, seg: 8 });
    }
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
        const label = this.labelNear(p.x, p.y - 12);
        const bg = p.icon ? SIGN_COL[p.icon] : COL.cream;
        const art: SignArt = { lines: label ? wrap(label) : [], icon: (p.icon ?? "arrow") as SignIcon, bg, fg: p.icon ? COL.white : COL.outline };
        this.signboard(p.x, p.y - 5, art, { z0: 13, cap: COL.woodDark, w: Math.min(22, signSize(art).w * TEXEL) });
        break;
      }
      case "city_map_post": {
        this.signboard(p.x, p.y - 2, { lines: ["BẢN ĐỒ"], icon: "map", bg: 0x9ecf8a, fg: 0x1f4a2a }, { z0: 16, cap: COL.tileDark });
        break;
      }
      case "lightpole": {
        this.cyl(p.x, p.y - 2, 2.2, 3, COL.metal, { seg: 8, taper: 0.7 });
        this.cyl(p.x, p.y - 2, 1.1, 44, COL.metal, { seg: 6 });
        this.box(p.x - 1, p.y - 3, 7, 2, 1.2, COL.metal, { z0: 44 });
        this.cyl(p.x + 5, p.y - 2, 3, 2.4, COL.metal, { z0: 43, seg: 8, taper: 0.5 });
        this.bulb(p.x + 5, p.y - 2, 41.4, 0xfff1c0, 1.8);
        this.light(p.x + 5, p.y - 2, 46, 3);
        break;
      }
      case "lantern_post": {
        this.cyl(p.x, p.y - 2, 1.4, 40, COL.woodDeep, { seg: 6 });
        this.box(p.x, p.y - 2.8, 9, 1.6, 1.6, COL.woodDeep, { z0: 40 });
        this.beam(p.x + 7, p.y - 2, 41, p.x + 7, p.y - 2, 38.5, 0.3, COL.outline);
        this.lantern(p.x + 7, p.y - 2, 35, COL.red, 3.2);
        this.light(p.x + 6, p.y - 2, 46, 2);
        break;
      }
      case "board": {                                           // the notice board: two posts, a roof, pinned papers
        const b = this.signboard(p.x, p.y - 6, { lines: [upper(this.labelNear(p.x, p.y - 20) ?? "Bảng tin")], icon: "paper", bg: 0xd06a3a, fg: COL.paper }, { z0: 22, posts: 2, cap: COL.woodDark, w: 24 });
        this.boxC(p.x, p.y - 5.4, 24, 1.4, 11, 0xb88a52, { z0: 9 });                          // the cork below the header
        for (let k = 0; k < 4; k++) this.boxC(p.x - 8.5 + k * 5.7, p.y - 4.2, 4, 0.6, 5 + (k % 2), [COL.paper, 0xf6e7a0, COL.white, 0xcfe6f0][k], { z0: 11.5 + (k % 2) * 1.5 });
        for (let k = 0; k < 4; k++) this.cyl(p.x - 8.5 + k * 5.7, p.y - 3.8, 0.45, 0.5, COL.red, { z0: 16 + (k % 2) * 1.5, axis: "y", seg: 5 });
        void b;
        break;
      }
      case "news_stand": {                                      // a kiosk: body, counter, papers, a roof and its name
        this.boxC(p.x, p.y - 6, 20, 9, 18, 0x3a6e8a);
        this.boxC(p.x, p.y - 1.2, 22, 3, 1.2, COL.woodPale, { z0: 9 });
        for (let k = 0; k < 4; k++) this.boxC(p.x - 7.5 + k * 5, p.y - 1.4, 4, 2.6, 1 + (k % 2) * 0.5, [COL.paper, COL.white, 0xf6e7a0, COL.paper][k], { z0: 10.2 });
        for (let k = 0; k < 3; k++) this.boxC(p.x - 6 + k * 6, p.y - 1.4, 4.6, 0.6, 6, [COL.paper, 0xf6e7a0, COL.white][k], { z0: 11 });
        this.signboard(p.x, p.y - 2, { lines: ["BÁO LÀNG"], icon: "paper", bg: COL.red, fg: COL.white }, { z0: 20, posts: 0 });
        this.gable(p.x - 13, p.y - 12, 26, 13, 26.5, 5, COL.redDark, "x");
        for (const sx of [-1, 1]) this.cyl(p.x + sx * 11.5, p.y - 1, 0.6, 26.5, COL.woodDeep, { seg: 5 });
        break;
      }
      case "table": {                                           // a café table: a round top on a pedestal, a cup, a vase
        const ty = p.y - 6;
        this.cyl(p.x, ty, 5, 0.8, COL.metal, { seg: 12, taper: 0.8 });
        this.cyl(p.x, ty, 1, 12, COL.metal, { seg: 6 });
        this.cyl(p.x, ty, 10, 1.4, COL.woodPale, { z0: 12, seg: 16, ry: 7 });
        this.cyl(p.x, ty, 10.3, 0.5, COL.woodDark, { z0: 11.6, seg: 16, ry: 7.3 });
        this.cyl(p.x - 5, ty + 1, 1.3, 2.6, COL.white, { z0: 13.4, seg: 8 });
        this.cyl(p.x - 5, ty + 1, 1.05, 0.2, 0x5a3218, { z0: 16, seg: 8 });
        this.cyl(p.x + 4, ty - 1, 1.2, 4, 0x4f8ab0, { z0: 13.4, seg: 6, taper: 0.6 });
        this.bulb(p.x + 4, ty - 1, 19, 0xf29bb5, 1.3);
        break;
      }
      case "eat_table": {                                       // a street-food table with two plastic stools
        this.boxC(p.x, p.y - 5, 22, 8, 1.2, 0xc0392b, { z0: 10 });
        for (const [lx, ly] of [[-9.5, -2.5], [9.5, -2.5], [-9.5, 2.5], [9.5, 2.5]]) this.cyl(p.x + lx, p.y - 5 + ly, 0.55, 10, COL.metal, { seg: 5 });
        for (let k = 0; k < 2; k++) this.cyl(p.x - 5 + k * 10, p.y - 5, 2.4, 1.4, COL.white, { z0: 11.2, seg: 10, taper: 1.3 });
        this.cyl(p.x, p.y - 6, 0.8, 3, COL.redDark, { z0: 11.2, seg: 6 });
        for (const sx of [-15, 15]) this.cyl(p.x + sx, p.y - 5, 3, 7, 0x3d6fd1, { seg: 8, taper: 0.75 });
        break;
      }
      case "shop_counter": {
        this.boxC(p.x, p.y - 8, 76, 8, 14, COL.woodDark);
        this.boxC(p.x, p.y - 8, 78, 10, 1.6, COL.woodPale, { z0: 14 });
        for (let k = 0; k < 6; k++) this.boxC(p.x - 31 + k * 12.4, p.y - 3.6, 9, 0.8, 9, COL.wood, { z0: 2.5 });
        this.boxC(p.x + 26, p.y - 9, 8, 5, 4, COL.metal, { z0: 15.6 });
        for (let k = 0; k < 4; k++) this.cyl(p.x - 28 + k * 6, p.y - 9, 1.5, 4, [0xe0b33c, 0xd9534f, 0x5fae6e, 0x3d86a8][k], { z0: 15.6, seg: 8 });
        break;
      }
      case "punch_bag": {                                       // an A-frame, the chain, the leather bag
        for (const sx of [-6, 8]) this.cyl(p.x + sx, p.y - 3, 1.1, 44, COL.woodDeep, { seg: 6 });
        this.box(p.x - 7, p.y - 4, 16, 2, 2, COL.woodDeep, { z0: 42 });
        this.beam(p.x, p.y - 3, 42, p.x, p.y - 3, 34, 0.4, COL.metal);
        this.cyl(p.x, p.y - 3, 4, 20, 0xb03a2a, { z0: 12, seg: 10 });
        this.cyl(p.x, p.y - 3, 4.2, 1.2, COL.outline, { z0: 25, seg: 10 });
        this.cyl(p.x, p.y - 3, 3.4, 2, 0x8a2a20, { z0: 32, seg: 10, taper: 0.6 });
        break;
      }
      case "hammock": {                                         // palm A → the light pole: cords, a sagging striped cloth
        const x1 = p.x + 6, x2 = p.x2 - 4, y = p.y - 7.5, n = 12;
        const zAt = (f: number) => 16 - Math.sin(Math.PI * f) * 6;
        this.beam(x1 - 6, y, 24, x1, y, zAt(0), 0.4, COL.cream);
        this.beam(x2 + 4, y, 26, x2, y, zAt(1), 0.4, COL.cream);
        for (let i = 0; i < n; i++) {
          const f0 = i / n, f1 = (i + 1) / n, xa = x1 + (x2 - x1) * f0, xb = x1 + (x2 - x1) * f1;
          const z = Math.min(zAt(f0), zAt(f1));
          this.box(xa, y - 3.5, xb - xa, 7, Math.abs(zAt(f0) - zAt(f1)) + 1, i % 2 ? 0xf6d27a : 0xd9534f, { z0: z - 0.5 });
        }
        for (const x of [x1, x2]) this.box(x - 0.5, y - 4, 1, 8, 1, COL.woodDeep, { z0: zAt(x === x1 ? 0 : 1) - 0.4 });
        this.boxC(p.x + 22, y, 8, 5, 1.5, COL.paper, { z0: zAt(0.3) + 0.6 });                       // a pillow
        break;
      }
      case "mixer": {                                           // the DJ booth: a desk, two decks, the mixer, a laptop
        const cx = p.x, cy = p.y - 6;
        this.boxC(cx, cy, 42, 12, 14, 0x2a2a34, { z0: 12 });
        this.boxC(cx, cy, 44, 13.5, 1.4, 0x4a4a58, { z0: 26 });
        this.signboard(cx, cy + 5.5, { lines: ["DJ"], icon: "note", bg: 0x1a1a24, fg: 0xff6f91, rim: 0x06d6a0 }, { z0: 16, posts: 0, w: 16 });
        for (let k = 0; k < 7; k++) this.box(cx - 20 + k * 6, cy + 6.3, 3, 0.8, 1, [0xff6f91, 0xffd166, 0x06d6a0, 0x4cc9f0][k % 4], { z0: 13.5, glow: true });
        for (const sx of [-13, 13]) {
          this.cyl(cx + sx, cy, 5.2, 0.8, 0x15151c, { z0: 27.4, seg: 14 });
          this.cyl(cx + sx, cy, 4.2, 0.4, 0x3a3a48, { z0: 28.2, seg: 14 });
          this.cyl(cx + sx, cy, 0.8, 0.6, COL.white, { z0: 28.6, seg: 6 });
          this.beam(cx + sx + 3.5, cy - 3, 29, cx + sx + 1, cy + 1, 29.2, 0.5, COL.grey);
        }
        this.boxC(cx, cy, 9, 8, 1.6, 0x1f1f28, { z0: 27.4 });
        for (let k = 0; k < 6; k++) this.cyl(cx - 3 + (k % 3) * 3, cy - 2 + Math.floor(k / 3) * 3, 0.6, 0.8, [0xff6f91, 0x06d6a0, 0xffd166][k % 3], { z0: 29, seg: 6, glow: true });
        this.boxC(cx, cy - 4.5, 8, 5, 0.5, COL.greyDark, { z0: 29 });
        this.boxC(cx, cy - 7, 8, 0.6, 5, 0x4cc9f0, { z0: 29.5, glow: true });
        break;
      }
      case "card_table": {
        const felt = FELT[p.game] ?? COL.woodPale;
        const cx = p.x, cy = p.y - 13;
        if (p.game === "cao") {                                 // a straw mat (Cào is played on the floor), cards on it
          this.cyl(cx, cy, 21, 0.6, 0xc9a86a, { z0: 1.5, seg: 20, ry: 9 });
          this.cyl(cx, cy, 19, 0.3, felt, { z0: 2.1, seg: 20, ry: 7.8 });
          this.tableTop(cx, cy, 2.4, 18, 8, 6, 5);
        } else if (p.game === "tienlen") {                      // a square wooden table
          const w = 20, d = 14, top = 14;
          this.boxC(cx, cy, w, d, 1.4, COL.wood, { z0: top - 1.4 });
          this.boxC(cx, cy, w - 3, d - 3, 0.3, felt, { z0: top });
          this.boxC(cx, cy, w - 1.5, d - 1.5, 1.6, COL.woodDark, { z0: top - 3 });
          for (const [lx, ly] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.boxC(cx + lx * (w / 2 - 1.8), cy + ly * (d / 2 - 1.8), 1.6, 1.6, top - 1.5 - 1.5, COL.woodDeep, { z0: 1.5 });
          this.tableTop(cx, cy, top + 0.3, 7, 5, 4, 7);
        } else {                                                // a round (poker) or oval (xì dách) table on a pedestal
          const oval = p.game === "xidach", rx = oval ? 15 : 13, ry = oval ? 7.5 : 8, top = 14;
          this.cyl(cx, cy, 4.5, 1, COL.metal, { z0: 1.5, seg: 12 });
          this.cyl(cx, cy, 1.6, top - 3, COL.woodDeep, { z0: 1.5, seg: 8 });
          this.cyl(cx, cy, rx, 1.6, COL.woodDark, { z0: top - 1.6, seg: 20, ry });
          this.cyl(cx, cy, rx - 1.6, 0.3, felt, { z0: top, seg: 20, ry: ry - 1.6 });
          this.tableTop(cx, cy, top + 0.3, rx - 3, ry - 2.5, p.game === "poker" ? 6 : 8, 11);
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
    separateBoxes(this.L.boxes);
    return this.L;
  }
}

/** No two box faces share a plane (coplanar.ts), in px. */
export function separateBoxes(boxes: Box[]): number {
  const proxies = boxes.map((b) => ({ x: b.x, y: b.y, z: b.z0, w: b.w, d: b.d, h: b.h, b }));
  const moved = separateCoplanar<AABB & { b: Box }>(proxies, COPLANAR_SEP, 32);
  for (const p of proxies) { p.b.x = p.x; p.b.y = p.y; p.b.z0 = p.z; p.b.w = p.w; p.b.d = p.d; p.b.h = p.h; }
  return moved;
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



