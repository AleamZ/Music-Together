import { BOAT } from "@/lib/game/fishing/extras";
import { DIG_MOUNDS, inDirtPatch, inPond, onPlatform, POND_CX, POND_CY, POND_PLATFORM, POND_RX, POND_RY, pondEdge } from "@/lib/game/maps/pond";
import { LILIES, onPath } from "@/lib/game/maps/pond-art";
import type { GameMap, PropPlacement, Rect } from "@/lib/game/maps/types";

// Pure: a map → what the diorama builds (ground tiles, water, instanced plants, buildings as boxes), all in map px.
// The Three.js side (scene.ts) only turns this into meshes, so the layout is testable without WebGL.

export type Ground = "grass" | "path" | "soil" | "sand" | "water" | "deep" | "bamboo";

export interface Plant { x: number; y: number; h: number; seed: number }

export interface Building {
  kind: "stall" | "hut" | "records" | "board" | "sign" | "post" | "city_post" | "ghe" | "xuong" | "banana" | "palm";
  x: number; y: number;
  /** Footprint in px (w along x, d along y) and height in px. */
  w: number; d: number; h: number;
  /** palm: lean; others unused. */
  lean?: number;
  seed?: number;
}

export interface DioramaLayout {
  width: number;
  height: number;
  /** Ground tile size in px and the grid (cols × rows, row-major). */
  tile: number;
  cols: number;
  rows: number;
  ground: Ground[];
  /** The pond's shore as a closed polygon (px), for the water surface and the bank. */
  shore: Array<{ x: number; y: number }>;
  platform: Rect[];
  /** Posts under the platform (px). */
  posts: Array<{ x: number; y: number }>;
  trees: Plant[];
  bamboo: Plant[];
  reeds: Plant[];
  rocks: Plant[];
  lilies: Array<{ x: number; y: number; flower: boolean }>;
  mounds: Array<{ x: number; y: number }>;
  buildings: Building[];
  /** A low fence along the east edge (px segments). */
  fences: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  /** Night lights (px) with their radius. */
  lights: Array<{ x: number; y: number; r: number }>;
}

/** A tiny seeded RNG (mulberry32), so every client builds the same diorama. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The ground at one px of the pond (the same rules as the 2D painter). */
export function pondGroundAt(x: number, y: number): Ground {
  if (y < 40) return "bamboo";
  if (inPond(x, y)) return inPond(x, y, -46) ? "deep" : "water";
  if (inPond(x, y, 3)) return "sand";
  if (inDirtPatch(x, y)) return "soil";
  if (onPath(x, y)) return "path";
  return "grass";
}

function propBuilding(p: PropPlacement): Building | null {
  switch (p.kind) {
    case "palm": return { kind: "palm", x: p.x, y: p.y, w: 10, d: 10, h: p.h, lean: p.lean, seed: p.seed };
    case "banana": return { kind: "banana", x: p.x, y: p.y, w: 20, d: 20, h: 34 };
    case "stall_front": return { kind: "stall", x: 574, y: 83, w: 116, d: 86, h: 44 };
    case "hut_front": return { kind: "hut", x: 574, y: 245, w: 116, d: 98, h: 48 };
    case "records": return { kind: "records", x: p.x, y: p.y, w: 26, d: 4, h: 30 };
    case "board": return { kind: "board", x: p.x, y: p.y, w: 24, d: 4, h: 28 };
    case "sign": return { kind: "sign", x: p.x, y: p.y, w: 16, d: 3, h: 22 };
    case "city_map_post": return { kind: "city_post", x: p.x, y: p.y, w: 18, d: 4, h: 30 };
    case "ghe": return { kind: "ghe", x: p.x, y: p.y, w: 70, d: 22, h: 8 };
    default: return null;
  }
}

/** The pond ("Ao cá") as a diorama layout. */
export function buildPondLayout(map: GameMap, opts: { density?: number } = {}): DioramaLayout {
  const density = opts.density ?? 1;
  const tile = map.cell;
  const cols = Math.ceil(map.width / tile), rows = Math.ceil(map.height / tile);
  const ground: Ground[] = new Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    ground[r * cols + c] = pondGroundAt(c * tile + tile / 2, r * tile + tile / 2);
  }
  const shore: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2, e = pondEdge(a);
    shore.push({ x: POND_CX + Math.cos(a) * POND_RX * e, y: POND_CY + Math.sin(a) * POND_RY * e });
  }
  const [bar, stem] = POND_PLATFORM;
  const posts = [
    { x: bar.x + 2, y: bar.y + bar.h - 2 }, { x: bar.x + bar.w - 2, y: bar.y + bar.h - 2 }, { x: bar.x + 60, y: bar.y + bar.h - 2 },
    { x: bar.x + bar.w - 60, y: bar.y + bar.h - 2 }, { x: bar.x + 2, y: bar.y + 2 }, { x: bar.x + bar.w - 2, y: bar.y + 2 },
    { x: stem.x + 1, y: stem.y + 30 }, { x: stem.x + stem.w - 1, y: stem.y + 30 },
  ];

  const R = rng(1234);
  const free = (x: number, y: number, pad: number) =>
    !inPond(x, y, pad) && !onPath(x, y) && !inDirtPatch(x, y) && !map.interactables.some((i) =>
      x > i.rect.x - pad && x < i.rect.x + i.rect.w + pad && y > i.rect.y - pad && y < i.rect.y + i.rect.h + pad);
  const blockedNear = (x: number, y: number) => {
    const c = Math.floor(x / tile), r = Math.floor(y / tile);
    return c < 0 || r < 0 || c >= cols || r >= rows ? true : map.blocked[r * cols + c] === 1;
  };

  // bamboo: a dense grove along the north band (solid in the map)
  const bamboo: Plant[] = [];
  for (let x = 4; x < map.width; x += 7 / density) {
    if (x > 512 && x < 636) continue;                             // the depot's awning stands here
    bamboo.push({ x: x + R() * 4, y: 6 + R() * 30, h: 50 + R() * 26, seed: Math.floor(R() * 1e6) });
  }

  // round trees: on the map's border strip (outside the walkable area), where the 2D map paints plain grass
  const trees: Plant[] = [];
  const ring = (n: number, place: (i: number) => { x: number; y: number }) => {
    for (let i = 0; i < n; i++) {
      const p = place(i);
      trees.push({ x: p.x, y: p.y, h: 34 + R() * 20, seed: Math.floor(R() * 1e6) });
    }
  };
  const perSide = Math.max(4, Math.round(22 * density));
  ring(perSide, (i) => ({ x: (i + R()) * (map.width / perSide), y: map.height + 10 + R() * 18 }));   // south, off-map skirt
  ring(Math.round(perSide / 2), (i) => ({ x: -12 - R() * 16, y: 50 + (i + R()) * ((map.height - 50) / (perSide / 2)) }));
  ring(Math.round(perSide / 2), (i) => ({ x: map.width + 12 + R() * 16, y: 50 + (i + R()) * ((map.height - 50) / (perSide / 2)) }));
  // a few shrubs inside, on free grass next to solids (never on a walkable cell a player needs)
  for (let k = 0, placed = 0; k < 400 && placed < Math.round(10 * density); k++) {
    const x = 20 + R() * (map.width - 40), y = 60 + R() * (map.height - 80);
    if (!free(x, y, 14) || !blockedNear(x, y)) continue;
    trees.push({ x, y, h: 16 + R() * 8, seed: Math.floor(R() * 1e6) });
    placed++;
  }

  // reeds along the shore (the same angles as the 2D painter), rocks on the bank
  const reeds: Plant[] = [];
  for (const a of [2.6, 3.0, 3.6, 5.6, 6.0, 0.5, 1.2, 2.1]) {
    const e = pondEdge(a);
    const bx = POND_CX + Math.cos(a) * (POND_RX + 2) * e, by = POND_CY + Math.sin(a) * (POND_RY + 2) * e;
    for (let k = 0; k < Math.round(9 * density); k++) {
      const x = bx + (k - 4) * 2.2 + (R() - 0.5) * 3, y = by + (R() - 0.5) * 5;
      if (onPlatform(x, y)) continue;
      reeds.push({ x, y, h: 8 + R() * 8, seed: Math.floor(R() * 1e6) });
    }
  }
  const rocks: Plant[] = [];
  for (let i = 0; i < Math.round(26 * density); i++) {
    const a = R() * Math.PI * 2, e = pondEdge(a), g = 4 + R() * 6;
    const x = POND_CX + Math.cos(a) * (POND_RX + g) * e, y = POND_CY + Math.sin(a) * (POND_RY + g) * e;
    if (onPlatform(x, y) || onPath(x, y)) continue;
    rocks.push({ x, y, h: 2 + R() * 3, seed: Math.floor(R() * 1e6) });
  }

  const buildings = map.props.map(propBuilding).filter((b): b is Building => b !== null);
  buildings.push({ kind: "xuong", x: 424, y: 114, w: 40, d: 9, h: 5 });   // the xuồng ba lá moored in the north-east
  buildings.push({ kind: "post", x: 352, y: 355, w: 8, d: 8, h: 10 });    // Bến vào's gate posts
  buildings.push({ kind: "post", x: 191, y: 375, w: 8, d: 8, h: 10 });

  return {
    width: map.width, height: map.height, tile, cols, rows, ground, shore,
    platform: POND_PLATFORM.map((p) => ({ ...p })), posts, trees, bamboo, reeds, rocks,
    lilies: LILIES.map(([x, y, flower]) => ({ x, y, flower })),
    mounds: DIG_MOUNDS.map((m) => ({ ...m })),
    buildings,
    fences: [
      { x1: 636, y1: 300, x2: 636, y2: 396 },
      { x1: 4, y1: 130, x2: 4, y2: 330 },
    ],
    lights: [
      { x: 574, y: 74, r: 44 }, { x: 574, y: 262, r: 40 }, { x: BOAT.pier.x, y: BOAT.pier.y - 6, r: 24 },
    ],
  };
}
