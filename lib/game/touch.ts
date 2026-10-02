/** The touch HUD's virtual joystick, as keys: the game walks on WASD / arrows (lib/game/engine.ts KEYMAP and the 3D
 *  world's own map), so the stick presses and releases those keys instead of a second input path. Pure. */

export type StickCode = "KeyW" | "KeyA" | "KeyS" | "KeyD";

/** Inside this share of the stick's radius nothing is pressed. */
export const STICK_DEADZONE = 0.3;

/** The keys held for a stick offset (dx right, dy down; any unit, `radius` the full throw). Diagonals press two keys:
 *  an axis counts when it is at least ~40% of the push (tan 22.5°), so the eight directions each get a 45° slice. */
export function joystickKeys(dx: number, dy: number, radius: number, deadzone = STICK_DEADZONE): Set<StickCode> {
  const keys = new Set<StickCode>();
  const len = Math.hypot(dx, dy);
  if (radius <= 0 || len < deadzone * radius) return keys;
  const k = Math.tan(Math.PI / 8) * len;
  if (dy < 0 && -dy >= k) keys.add("KeyW");
  if (dy > 0 && dy >= k) keys.add("KeyS");
  if (dx < 0 && -dx >= k) keys.add("KeyA");
  if (dx > 0 && dx >= k) keys.add("KeyD");
  return keys;
}

/** The key changes from one held set to the next: what to release, then what to press. */
export function keyDiff<T>(from: ReadonlySet<T>, to: ReadonlySet<T>): { up: T[]; down: T[] } {
  return { up: [...from].filter((k) => !to.has(k)), down: [...to].filter((k) => !from.has(k)) };
}

/** Clamps a drag to the stick's ring (the knob's drawn offset). */
export function clampStick(dx: number, dy: number, radius: number): { x: number; y: number } {
  const len = Math.hypot(dx, dy);
  if (len <= radius || len === 0) return { x: dx, y: dy };
  return { x: (dx / len) * radius, y: (dy / len) * radius };
}
