export const SPRITE_W = 24;
export const SPRITE_H = 48;

/** Stored facings; "right" is "left" mirrored. */
export type Dir3 = "down" | "up" | "left";
/** Walk cycle: 0 idle, 1 step A, 2 idle, 3 step B. */
export type Frame = 0 | 1 | 2 | 3;

/** A partial sprite layer: `rows[i]` is drawn at sprite row `top + i`; "." = transparent. */
export interface Layer { top: number; rows: string[] }
