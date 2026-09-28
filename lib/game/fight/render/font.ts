// v20 Võ đài: a tiny 3 × 5 pixel font for the arena canvas (the timer, "K.O.", "TK"). Vietnamese copy is HTML over
// the canvas (plan ruling P11).

import type { PixelCtx } from "./rig";

const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  "0": ["###", "#.#", "#.#", "#.#", "###"],
  "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["###", "..#", "###", "#..", "###"],
  "3": ["###", "..#", ".##", "..#", "###"],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "5": ["###", "#..", "###", "..#", "###"],
  "6": ["###", "#..", "###", "#.#", "###"],
  "7": ["###", "..#", ".#.", ".#.", ".#."],
  "8": ["###", "#.#", "###", "#.#", "###"],
  "9": ["###", "#.#", "###", "..#", "###"],
  K: ["#.#", "##.", "#..", "##.", "#.#"],
  O: ["###", "#.#", "#.#", "#.#", "###"],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
  ".": ["...", "...", "...", "...", ".#."],
  " ": ["...", "...", "...", "...", "..."],
};

/** Width in px of `text` at `scale` (3 px glyphs, 1 px gaps). */
export const textWidth = (text: string, scale = 1): number => (text.length * 4 - 1) * scale;

/** Draws `text` with its top-left at (x, y); `shadow` adds a 1-scale drop shadow. */
export function drawText(c: PixelCtx, text: string, x: number, y: number, color: string, scale = 1, shadow?: string): void {
  const draw = (ox: number, oy: number, col: string) => {
    c.fillStyle = col;
    [...text].forEach((ch, i) => {
      const g = GLYPHS[ch] ?? GLYPHS[" "];
      g.forEach((row, gy) => {
        for (let gx = 0; gx < 3; gx++) if (row[gx] === "#") c.fillRect(ox + (i * 4 + gx) * scale, oy + gy * scale, scale, scale);
      });
    });
  };
  if (shadow) draw(x + scale, y + scale, shadow);
  draw(x, y, color);
}
