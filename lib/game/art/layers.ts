export const SPRITE_W = 24;
export const SPRITE_H = 48;

/** Stored facings; "right" is "left" mirrored. */
export type Dir3 = "down" | "up" | "left";
/** Pose frames: 0 idle · 1 step A · 2 passing A (body up) · 3 step B · 4 passing B (body up) · 5 idle breath. */
export type Frame = 0 | 1 | 2 | 3 | 4 | 5;
export const FRAMES: readonly Frame[] = [0, 1, 2, 3, 4, 5];
/** The walk cycle, in order (walking never shows the idle frames). */
export const WALK_CYCLE: readonly Frame[] = [1, 2, 3, 4];

/** A partial sprite layer: `rows[i]` is drawn at sprite row `top + i`; "." = transparent. */
export interface Layer { top: number; rows: string[] }

/** One sprite row: `s` starting at column `col`, padded with "." to the sprite width (never cut, so tests see overflow). */
export function R(col: number, s = ""): string {
  const row = ".".repeat(col) + s;
  return row.length >= SPRITE_W ? row : row + ".".repeat(SPRITE_W - row.length);
}
