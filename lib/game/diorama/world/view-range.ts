import type { Quality } from "../types";

// Pure: how much of the world the 3D view draws. The game's third-person camera looks down at a fixed pitch (its top
// edge meets the ground well inside ~100 units), so nothing past a view range can be on screen but a hilltop through the
// fog: the zones, terrain chunks, forest chunks and the far backdrop beyond it are not drawn at all, the camera's far
// plane and the fog close in on it. First person and the overview (which look at the horizon) keep the whole world.
// Plus the render scale: the pixel ratio steps down while the frame rate is poor and back up once it recovers.

/** Third person: the drawn range (units) by quality. */
export const THIRD_PERSON_RANGE: Readonly<Record<Quality, number>> = { high: 140, low: 110 };

/** The view range (units) for the camera now: third person is bounded, everything else draws the whole world. */
export function viewRange(thirdPerson: boolean, q: Quality): number {
  return thirdPerson ? THIRD_PERSON_RANGE[q] : Infinity;
}

export interface Rect { x0: number; z0: number; x1: number; z1: number }

/** Ground distance (units) from (x, z) to a rectangle (0 inside it). */
export function rectDist(x: number, z: number, r: Rect): number {
  const dx = Math.max(r.x0 - x, 0, x - r.x1), dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.hypot(dx, dz);
}

/** Ground distance (units) from (x, z) to the nearest edge of a rectangle it is inside (0 outside it). */
export function rimDist(x: number, z: number, r: Rect): number {
  return Math.max(0, Math.min(x - r.x0, r.x1 - x, z - r.z0, r.z1 - z));
}

/** Is something `d` units away with radius `r` inside the range? */
export function inRange(d: number, r: number, range: number): boolean {
  return d - r <= range;
}

/** The render scale's limits and steps. */
export const RENDER_SCALE = { min: 0.6, max: 1, down: 0.1, up: 0.05, slowFps: 45, fastFps: 57 } as const;

/** The next render scale from the frame rate: down a step under slowFps, up a small step over fastFps (0 fps = no
 *  data yet: unchanged). */
export function nextScale(scale: number, fps: number): number {
  if (!(fps > 0)) return scale;
  if (fps < RENDER_SCALE.slowFps) return Math.max(RENDER_SCALE.min, Math.round((scale - RENDER_SCALE.down) * 100) / 100);
  if (fps > RENDER_SCALE.fastFps) return Math.min(RENDER_SCALE.max, Math.round((scale + RENDER_SCALE.up) * 100) / 100);
  return scale;
}
