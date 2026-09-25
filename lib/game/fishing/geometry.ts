import type { Facing, Vec } from "@/lib/game/types";

// Where the hands, the rod tip and the bobber are for a character whose feet are at `feet`. Pure (world px).

export const FACE_V: Record<Facing, Vec> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

/** Distance from the feet to the bobber; facing up it must clear the character's own 48-px-tall sprite. */
export const BOBBER_REACH: Record<Facing, number> = { up: 56, down: 30, left: 36, right: 36 };

/** The cast swing before the line lands. */
export const SWING_MS = 600;

export function bobberPoint(feet: Vec, facing: Facing): Vec {
  const v = FACE_V[facing], r = BOBBER_REACH[facing];
  return { x: feet.x + v.x * r, y: feet.y + v.y * r };
}

export function handPoint(feet: Vec, facing: Facing): Vec {
  switch (facing) {
    case "down": return { x: feet.x + 6, y: feet.y - 19 };
    case "up": return { x: feet.x + 6, y: feet.y - 21 };
    case "left": return { x: feet.x - 4, y: feet.y - 19 };
    case "right": return { x: feet.x + 4, y: feet.y - 19 };
  }
}

/** Rod tip: swing 0 = held back over the shoulder, 1 = out over the water; `bend` pulls the tip down (px). */
export function rodTip(feet: Vec, facing: Facing, swing: number, bend: number): Vec {
  const h = handPoint(feet, facing), v = FACE_V[facing];
  const s = Math.min(1, Math.max(0, swing));
  const out = { x: h.x + v.x * 12, y: h.y + v.y * 12 - 10 + bend };
  const back = { x: h.x - v.x * 6, y: h.y - v.y * 6 - 13 };
  return { x: Math.round(back.x + (out.x - back.x) * s), y: Math.round(back.y + (out.y - back.y) * s) };
}
