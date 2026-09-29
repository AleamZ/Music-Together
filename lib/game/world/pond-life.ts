import { inPond, POND_CX, POND_PLATFORM } from "@/lib/game/maps/pond";

// Pure: where the pond's ducks paddle (pond-local px). They circle the open water NORTH of the T-shaped jetty (cầu ao),
// on ellipses kept clear of the jetty's deck by DUCK_MARGIN px and inside the shore — never through the planks.

/** How far (px) a duck keeps from the jetty's deck. */
export const DUCK_MARGIN = 12;
const TOP = Math.min(...POND_PLATFORM.map((p) => p.y));              // the jetty's northmost edge
/** The ducks' loop: centre and radii (px) for a duck's ring `r` (0…1, a larger ring for each duck). */
export function duckLoop(r: number): { cx: number; cy: number; rx: number; ry: number } {
  const ry = 26 + 20 * r, cy = TOP - DUCK_MARGIN - ry;
  return { cx: POND_CX, cy, rx: 70 + 50 * r, ry };
}

/** A duck on ring `r` at angle `a`: where (pond px), and its heading (the model's yaw, atan2 of the travel). */
export function pondDuckAt(r: number, a: number): { x: number; y: number; yaw: number } {
  const l = duckLoop(r);
  return { x: l.cx + Math.cos(a) * l.rx, y: l.cy + Math.sin(a) * l.ry, yaw: Math.atan2(-Math.sin(a) * l.rx, Math.cos(a) * l.ry) };
}

/** Is a pond px point clear of the jetty (with the margin) and on open water (inside the shore by the margin)? */
export function duckClear(x: number, y: number): boolean {
  const onDeck = POND_PLATFORM.some((p) => x > p.x - DUCK_MARGIN && x < p.x + p.w + DUCK_MARGIN && y > p.y - DUCK_MARGIN && y < p.y + p.h + DUCK_MARGIN);
  return !onDeck && inPond(x, y, -DUCK_MARGIN);
}
