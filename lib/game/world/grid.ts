import type { Vec } from "@/lib/game/types";
import { WORLD_H, WORLD_W, ZONE_IDS, ZONES, type ZoneId } from "./zones";

// P4 realtime area of interest (spec §4): the world is cut into 7 × 4 grid cells of 640 × 560 px. A world-mode client
// broadcasts on its own cell's topic (game:{room}:c{cx}_{cy}, world px) and listens on its own + the 8 neighbours (≤ 9
// channels). Its own cell changes only once it is CELL_HYSTERESIS px past the cell's edge (no flapping on a border).
// Interiors keep their dedicated topics. Pure.

export const CELL_W = 640;
export const CELL_H = 560;
export const GRID_W = Math.ceil(WORLD_W / CELL_W); // 7
export const GRID_H = Math.ceil(WORLD_H / CELL_H); // 4
export const CELL_COUNT = GRID_W * GRID_H; // 28
/** How far (px) past its cell's edge a player keeps that cell as its own. */
export const CELL_HYSTERESIS = 64;
/** More visible players than this: my movement goes out at DEGRADED_RATE a second (spec §4 "Degrade"). */
export const CROWD_LIMIT = 30;
export const DEGRADED_RATE = 2;

/** A cell by index (cy * GRID_W + cx). */
export type CellIndex = number;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function cellXY(c: CellIndex): { cx: number; cy: number } {
  return { cx: c % GRID_W, cy: Math.floor(c / GRID_W) };
}

export function isCell(v: unknown): v is CellIndex {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < CELL_COUNT;
}

/** The cell a world point is in (points off the world are clamped onto it). */
export function cellAt(pos: Vec): CellIndex {
  const cx = clamp(Math.floor(pos.x / CELL_W), 0, GRID_W - 1);
  const cy = clamp(Math.floor(pos.y / CELL_H), 0, GRID_H - 1);
  return cy * GRID_W + cx;
}

/** A cell's rectangle in world px. */
export function cellRect(c: CellIndex): { x: number; y: number; w: number; h: number } {
  const { cx, cy } = cellXY(c);
  return { x: cx * CELL_W, y: cy * CELL_H, w: CELL_W, h: CELL_H };
}

/** The topic suffix of a cell: `c{cx}_{cy}` (the channel's "map id"). */
export function cellTopicId(c: CellIndex): string {
  const { cx, cy } = cellXY(c);
  return `c${cx}_${cy}`;
}

/** The full topic of a cell. */
export function cellTopic(roomId: string, c: CellIndex): string {
  return `game:${roomId}:${cellTopicId(c)}`;
}

/** How far (px) a point is outside a cell's rectangle (0 inside). */
export function cellDistance(c: CellIndex, pos: Vec): number {
  const r = cellRect(c);
  return Math.max(r.x - pos.x, 0, pos.x - (r.x + r.w), r.y - pos.y, 0, pos.y - (r.y + r.h));
}

/** My own cell after a step: the current one while I am within CELL_HYSTERESIS px of it, else the cell I am in. */
export function cellStep(current: CellIndex | null, pos: Vec): CellIndex {
  if (current !== null && isCell(current) && cellDistance(current, pos) <= CELL_HYSTERESIS) return current;
  return cellAt(pos);
}

/** The cells listened to from `c`: itself first, then its (up to 8) neighbours in index order. */
export function cellNeighbourhood(c: CellIndex): CellIndex[] {
  const { cx, cy } = cellXY(c);
  const out: CellIndex[] = [];
  for (let y = cy - 1; y <= cy + 1; y++) {
    for (let x = cx - 1; x <= cx + 1; x++) {
      if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) continue;
      const n = y * GRID_W + x;
      if (n !== c) out.push(n);
    }
  }
  return [c, ...out];
}

/** The zones whose rectangles overlap any of these cells, and the wild (who may be "here": isHereOn's maps). */
export function cellZones(cells: readonly CellIndex[]): ZoneId[] {
  const out: ZoneId[] = [];
  for (const id of ZONE_IDS) {
    const z = ZONES[id];
    const hit = cells.some((c) => {
      const r = cellRect(c);
      return z.ox < r.x + r.w && r.x < z.ox + z.w && z.oy < r.y + r.h && r.y < z.oy + z.h;
    });
    if (hit) out.push(id);
  }
  out.push("wild");
  return out;
}

/** Can a message sent on cell `c`'s topic be at `pos`? Its sender's own cell is `c`, so it is within the hysteresis of it
 *  (plus a cell-switch's worth of slack: the switch is checked a few times a second). */
export const CELL_SLACK = CELL_HYSTERESIS + 96;
export function plausibleInCell(c: CellIndex, pos: Vec): boolean {
  return pos.x >= 0 && pos.y >= 0 && pos.x <= WORLD_W && pos.y <= WORLD_H && cellDistance(c, pos) <= CELL_SLACK;
}
