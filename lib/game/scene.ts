import type { GameMap, Interactable, InteractId } from "@/lib/game/maps/types";
import type { Vec } from "@/lib/game/types";

// Pure helpers for the engine: view sizing, camera, hit tests and overlay layout.

/** Aim for a ~300×180 world-pixel view, scaled by a whole number so pixels stay square. */
export const TARGET_W = 300;
export const TARGET_H = 180;
/** How close (world px) the feet must be to an interactable's use spot to show its prompt. */
export const PROMPT_RANGE = 26;

export interface ViewSize { scale: number; vw: number; vh: number }

/** Integer scale for a devW×devH (device px) canvas, plus the visible world size. Never shows past the map. */
export function computeView(devW: number, devH: number, mapW: number, mapH: number): ViewSize {
  let scale = Math.max(1, Math.floor(Math.min(devW / TARGET_W, devH / TARGET_H)));
  // tall phone screens would otherwise see empty bands above and below the map
  while (Math.ceil(devW / scale) > mapW || Math.ceil(devH / scale) > mapH) scale++;
  return { scale, vw: Math.ceil(devW / scale), vh: Math.ceil(devH / scale) };
}

/** Camera top-left: centred on the character's head (feet y − 24), clamped to the map (centred if the view is bigger). */
export function cameraFor(feet: Vec, vw: number, vh: number, mapW: number, mapH: number): Vec {
  const axis = (target: number, span: number, size: number) =>
    size <= span ? (size - span) / 2 : Math.max(0, Math.min(size - span, target));
  return { x: axis(feet.x - vw / 2, vw, mapW), y: axis(feet.y - 24 - vh / 2, vh, mapH) };
}

/** The interactable whose click rect contains world point p. */
export function interactableAt(map: GameMap, p: Vec): Interactable | null {
  return map.interactables.find((i) => p.x >= i.rect.x && p.x < i.rect.x + i.rect.w && p.y >= i.rect.y && p.y < i.rect.y + i.rect.h) ?? null;
}

/** The closest interactable whose use spot is within `range` of the feet. */
export function nearestInteractable(map: GameMap, feet: Vec, range = PROMPT_RANGE): InteractId | null {
  let best: InteractId | null = null;
  let bestD = Infinity;
  for (const i of map.interactables) {
    const d = Math.hypot(feet.x - i.use.x, feet.y - i.use.y);
    if (d <= range && d < bestD) {
      best = i.id;
      bestD = d;
    }
  }
  return best;
}

/** True when the feet are close enough to use the interactable (its use spot within `range`). */
export function inUseRange(it: Interactable, feet: Vec, range = PROMPT_RANGE): boolean {
  return Math.hypot(feet.x - it.use.x, feet.y - it.use.y) <= range;
}

/** Click box of a 24×48 character whose feet are at `feet`. */
export function hitsCharacter(p: Vec, feet: Vec): boolean {
  return p.x >= feet.x - 10 && p.x <= feet.x + 10 && p.y >= feet.y - 44 && p.y <= feet.y + 2;
}

export interface Box { x: number; y: number; w: number; h: number }

/**
 * Lay out overlay boxes in order. A box that overlaps an already placed one moves by its own
 * height + gap (dir 1 = down, -1 = up), at most `tries` times and never above `minY`.
 */
export function stackBoxes(boxes: Box[], dir: 1 | -1, gap: number, minY = Number.NEGATIVE_INFINITY, tries = 4): Box[] {
  const placed: Box[] = [];
  const hit = (b: Box) => placed.some((p) => b.x < p.x + p.w && p.x < b.x + b.w && b.y < p.y + p.h && p.y < b.y + b.h);
  for (const box of boxes) {
    const b = { ...box };
    for (let i = 0; i < tries && hit(b); i++) b.y = Math.max(minY, b.y + dir * (b.h + gap));
    placed.push(b);
  }
  return placed;
}
