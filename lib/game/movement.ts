import type { GameMap } from "@/lib/game/maps/types";
import type { Facing, Vec } from "@/lib/game/types";

export const WALK_SPEED = 70; // px/s
/** Feet collision box: x-3…x+3, y-3…y+1 (fits inside one 8-px cell when centred). */
export const FOOT_HALF_W = 3;
export const FOOT_UP = 3;
export const FOOT_DOWN = 1;
const MAX_SUBSTEP = 4; // px — never tunnel through a thin wall on a slow frame

export interface KeyState { up: boolean; down: boolean; left: boolean; right: boolean }

export function cellBlocked(map: GameMap, c: number, r: number): boolean {
  if (c < 0 || r < 0 || c >= map.cols || r >= map.rows) return true;
  return map.blocked[r * map.cols + c] === 1;
}

/** True if the feet box at (x, y) leaves the map or touches a blocked cell. */
export function isBlockedAt(map: GameMap, x: number, y: number): boolean {
  const x0 = x - FOOT_HALF_W, x1 = x + FOOT_HALF_W, y0 = y - FOOT_UP, y1 = y + FOOT_DOWN;
  if (x0 < 0 || y0 < 0 || x1 > map.width || y1 > map.height) return true;
  const c0 = Math.floor(x0 / map.cell), c1 = Math.floor((x1 - 1e-6) / map.cell);
  const r0 = Math.floor(y0 / map.cell), r1 = Math.floor((y1 - 1e-6) / map.cell);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (cellBlocked(map, c, r)) return true;
  return false;
}

/** Move along `dir` (any length, normalized) for `dtSec`; x then y per sub-step so walls make you slide. */
export function stepMove(map: GameMap, pos: Vec, dir: Vec, dtSec: number, speed = WALK_SPEED): Vec {
  const len = Math.hypot(dir.x, dir.y);
  if (len === 0 || dtSec <= 0) return { x: pos.x, y: pos.y };
  const total = speed * dtSec;
  const steps = Math.max(1, Math.ceil(total / MAX_SUBSTEP));
  const sx = (dir.x / len) * (total / steps);
  const sy = (dir.y / len) * (total / steps);
  let x = pos.x, y = pos.y;
  for (let i = 0; i < steps; i++) {
    if (sx !== 0 && !isBlockedAt(map, x + sx, y)) x += sx;
    if (sy !== 0 && !isBlockedAt(map, x, y + sy)) y += sy;
  }
  return { x, y };
}

export function inputDir(k: KeyState): Vec {
  return { x: (k.right ? 1 : 0) - (k.left ? 1 : 0), y: (k.down ? 1 : 0) - (k.up ? 1 : 0) };
}

/** Keyboard facing: with diagonal input the horizontal component wins. */
export function facingFor(dir: Vec, prev: Facing): Facing {
  if (dir.x < 0) return "left";
  if (dir.x > 0) return "right";
  if (dir.y < 0) return "up";
  if (dir.y > 0) return "down";
  return prev;
}

/** Path facing: the dominant axis of the segment. */
export function facingForVector(v: Vec, prev: Facing): Facing {
  if (v.x === 0 && v.y === 0) return prev;
  if (Math.abs(v.x) >= Math.abs(v.y)) return v.x < 0 ? "left" : "right";
  return v.y < 0 ? "up" : "down";
}
