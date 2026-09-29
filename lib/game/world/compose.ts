import { getMap } from "@/lib/game/maps/registry";
import type { GameMap, Interactable, Npc, PlotGeom, PropPlacement, Rect, Seating, Spot } from "@/lib/game/maps/types";
import type { Vec } from "@/lib/game/types";
import { LINKS, OPENINGS, OPENING_W, onRoad, ROADS, WILD_INTERACTABLES, wildBlocked, type Opening, type Road } from "./wild";
import { toWorld, WORLD_CELL, WORLD_H, WORLD_W, ZONE_IDS, ZONES, type OutdoorMapId, type ZoneId } from "./zones";
import { WORLD_GATES, type WorldGate } from "./gates";

// buildWorld (spec §2): the one world map, headless. Each unlocked zone's collision grid is stamped at its offset; its
// interactables, NPCs, props, plots and seating are moved to world px and tagged with their zone; the portals between
// outdoor maps become openings in the zone walls (roads in the wild join them); interior portals (the hầm's hatch) stay,
// and the wild adds its own (the mine mouth down to Mỏ đá, underground since P2).
// A locked zone (the account's level) is a solid block with nothing in it — the bamboo barrier of P3.
// Pure: no canvas, no DOM. The engine runs on it in world mode (P2: GameCanvas, behind the unified_world flag + 3D).

export type Zoned<T> = T & { zone: ZoneId };

/** A way across that is not a walk (the boat), in world px. */
export interface WorldLink { kind: "boat"; from: Vec; to: Vec }

export interface WorldMap extends Omit<GameMap, "id" | "interactables" | "npcs" | "props" | "plots" | "seating"> {
  id: "world";
  interactables: Zoned<Interactable>[];
  npcs: Zoned<Npc>[];
  props: Zoned<PropPlacement>[];
  plots: Zoned<PlotGeom>[];
  seating: Seating | null;
  /** The zones stamped (unlocked), in ZONE_IDS order. */
  zones: OutdoorMapId[];
  roads: readonly Road[];
  links: WorldLink[];
  /** Spatial hash (HASH_CELL px buckets) of interactables and NPCs, by their use point / spot. */
  hash: SpatialHash;
  /** P3: the level gates still shut for this account (their barrier blocked, their guard among the NPCs). */
  gates: WorldGate[];
}

export const HASH_CELL = 128;

export interface SpatialHash {
  interactables: Map<number, number[]>;
  npcs: Map<number, number[]>;
}

const hashKey = (x: number, y: number): number => Math.floor(y / HASH_CELL) * 4096 + Math.floor(x / HASH_CELL);

function hashPut(m: Map<number, number[]>, p: Vec, i: number): void {
  const k = hashKey(p.x, p.y);
  const l = m.get(k);
  if (l) l.push(i);
  else m.set(k, [i]);
}

function hashNear(m: Map<number, number[]>, p: Vec, r: number): number[] {
  const out: number[] = [];
  const c0 = Math.floor((p.x - r) / HASH_CELL), c1 = Math.floor((p.x + r) / HASH_CELL);
  const r0 = Math.floor((p.y - r) / HASH_CELL), r1 = Math.floor((p.y + r) / HASH_CELL);
  for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) {
    const l = m.get(rr * 4096 + cc);
    if (l) out.push(...l);
  }
  return out;
}

/** The interactables whose use point is within r px of p. */
export function interactablesNear(w: WorldMap, p: Vec, r: number): Zoned<Interactable>[] {
  return hashNear(w.hash.interactables, p, r).map((i) => w.interactables[i])
    .filter((it) => (it.use.x - p.x) ** 2 + (it.use.y - p.y) ** 2 <= r * r);
}

/** The NPCs standing within r px of p. */
export function npcsNear(w: WorldMap, p: Vec, r: number): Zoned<Npc>[] {
  return hashNear(w.hash.npcs, p, r).map((i) => w.npcs[i])
    .filter((n) => (n.spot.x - p.x) ** 2 + (n.spot.y - p.y) ** 2 <= r * r);
}

const mv = (p: Vec, o: Vec): Vec => ({ x: p.x + o.x, y: p.y + o.y });
const mvRect = (r: Rect, o: Vec): Rect => ({ x: r.x + o.x, y: r.y + o.y, w: r.w, h: r.h });
const mvSpot = (s: Spot, o: Vec): Spot => ({ x: s.x + o.x, y: s.y + o.y, dir: s.dir });

function mvProp(p: PropPlacement, o: Vec): PropPlacement {
  const q = { ...p, x: p.x + o.x, y: p.y + o.y };
  if (q.kind === "hammock") q.x2 += o.x;
  return q;
}

/** Is this interactable a portal (or hatch) to another map? */
const isPortal = (i: Interactable): boolean => (i.kind === "portal" || i.kind === "ug_hatch") && !!i.to;

/** The opening's corridor, in zone-local px: from the portal's use point to its side of the zone. */
export function openingRect(o: Opening, use: Vec): Rect {
  const z = ZONES[o.zone], h = OPENING_W / 2;
  switch (o.side) {
    case "left": return { x: 0, y: use.y - h, w: use.x + h, h: OPENING_W };
    case "right": return { x: use.x - h, y: use.y - h, w: z.w - use.x + h, h: OPENING_W };
    case "top": return { x: use.x - h, y: 0, w: OPENING_W, h: use.y + h };
    case "bottom": return { x: use.x - h, y: use.y - h, w: OPENING_W, h: z.h - use.y + h };
  }
}

/** Where an opening meets its zone's edge, world px (a road's end). */
export function openingEnd(o: Opening, use: Vec): Vec {
  const z = ZONES[o.zone];
  switch (o.side) {
    case "left": return { x: z.ox, y: z.oy + use.y };
    case "right": return { x: z.ox + z.w, y: z.oy + use.y };
    case "top": return { x: z.ox + use.x, y: z.oy };
    case "bottom": return { x: z.ox + use.x, y: z.oy + z.h };
  }
}

/** The world map with these zones unlocked (the others are solid). Default: all. P3: an interior among them (mo_da)
 *  opens its level gate; one not among them keeps it shut. */
export function buildWorld(unlocked: Iterable<ZoneId> = [...ZONE_IDS, "mo_da"]): WorldMap {
  const open = new Set<ZoneId>(unlocked);
  const cell = WORLD_CELL, cols = WORLD_W / cell, rows = WORLD_H / cell;
  const blocked = new Uint8Array(cols * rows);

  // 1. the wild, roads laid over it
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = c * cell + cell / 2, y = r * cell + cell / 2;
    blocked[r * cols + c] = wildBlocked(x, y) && !onRoad(x, y) ? 1 : 0;
  }

  const zones: OutdoorMapId[] = [];
  const interactables: Zoned<Interactable>[] = [];
  const npcs: Zoned<Npc>[] = [];
  const props: Zoned<PropPlacement>[] = [];
  const plots: Zoned<PlotGeom>[] = [];
  let seating: Seating | null = null;

  for (const id of ZONE_IDS) {
    const z = ZONES[id], o = { x: z.ox, y: z.oy };
    const c0 = z.ox / cell, r0 = z.oy / cell;
    if (!open.has(id)) {                                                       // locked: solid
      for (let r = 0; r < z.h / cell; r++) blocked.fill(1, (r0 + r) * cols + c0, (r0 + r) * cols + c0 + z.w / cell);
      continue;
    }
    zones.push(id);
    const m = getMap(id);
    if (m.cell !== cell || m.width !== z.w || m.height !== z.h) throw new Error(`zone ${id}: its map is ${m.width}×${m.height}/${m.cell}`);
    // 2. the zone's own grid
    for (let r = 0; r < m.rows; r++) blocked.set(m.blocked.subarray(r * m.cols, (r + 1) * m.cols), (r0 + r) * cols + c0);
    // 3. its openings (a neighbour zone that is locked keeps its wall shut: the road ends at a barrier)
    for (const op of OPENINGS.filter((q) => q.zone === id)) {
      const portal = m.interactables.find((i) => i.id === op.portal);
      if (!portal?.to || (!op.wild && !open.has(portal.to.map))) continue;
      const rc = openingRect(op, portal.use);
      for (let y = Math.max(0, Math.floor(rc.y / cell)); y < Math.min(m.rows, Math.ceil((rc.y + rc.h) / cell)); y++)
        for (let x = Math.max(0, Math.floor(rc.x / cell)); x < Math.min(m.cols, Math.ceil((rc.x + rc.w) / cell)); x++)
          blocked[(r0 + y) * cols + c0 + x] = 0;
    }
    // 4. its things, in world px
    for (const it of m.interactables) {
      if (isPortal(it) && OPENINGS.some((q) => q.zone === id && q.portal === it.id)) continue;   // an opening now
      if (it.only2d) continue;                                                            // 0097: Rừng tràm's gate (2D only)
      const w: Zoned<Interactable> = { ...it, zone: id, rect: mvRect(it.rect, o), use: mv(it.use, o) };
      interactables.push(w);
    }
    for (const n of m.npcs) npcs.push({ ...n, zone: id, spot: mvSpot(n.spot, o) });
    for (const p of m.props) props.push({ ...mvProp(p, o), zone: id });
    for (const p of m.plots) plots.push({ ...p, zone: id, rect: mvRect(p.rect, o), post: mv(p.post, o) });
    if (m.seating) {
      seating = { djSpot: mvSpot(m.seating.djSpot, o), seats: m.seating.seats.map((s) => mvSpot(s, o)),
        standSpots: m.seating.standSpots.map((s) => mvSpot(s, o)) };
    }
  }

  // P3: the level gates still shut — the barrier blocks, the guard stands by it, the door behind it is out of use
  const gates = WORLD_GATES.filter((g) => !open.has(g.map));
  for (const g of gates) {
    if (g.barrier) {
      const b = g.barrier;
      for (let r = Math.floor(b.y / cell); r < Math.ceil((b.y + b.h) / cell); r++)
        for (let c = Math.floor(b.x / cell); c < Math.ceil((b.x + b.w) / cell); c++) if (r >= 0 && r < rows && c >= 0 && c < cols) blocked[r * cols + c] = 1;
    }
    npcs.push({ ...g.guard, zone: "wild" });
  }
  for (const it of WILD_INTERACTABLES) {
    if (it.to && gates.some((g) => g.map === it.to!.map)) continue;               // P3: the mine mouth behind its barrier
    interactables.push({ ...it, zone: "wild" });
  }

  const links: WorldLink[] = LINKS.filter((l) => open.has(l.from.zone) && open.has(l.to.zone))
    .map((l) => ({ kind: l.kind, from: toWorld(l.from.zone, l.from.p)!, to: toWorld(l.to.zone, l.to.p)! }));

  const hash: SpatialHash = { interactables: new Map(), npcs: new Map() };
  interactables.forEach((it, i) => hashPut(hash.interactables, it.use, i));
  npcs.forEach((n, i) => hashPut(hash.npcs, n.spot, i));

  const hall = getMap("hall");
  const spawn = mvSpot(hall.spawn, { x: ZONES.hall.ox, y: ZONES.hall.oy });
  return { id: "world", width: WORLD_W, height: WORLD_H, cell, cols, rows, blocked, spawn, seating,
    interactables, npcs, props, plots, zones, roads: ROADS, links, hash, gates };
}
