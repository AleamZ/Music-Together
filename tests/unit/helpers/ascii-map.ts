import type { GameMap } from "@/lib/game/maps/types";

/** Tiny test maps: one character per 8-px cell, "#" = blocked. */
export function mapFromAscii(rows: string[], cell = 8): GameMap {
  const cols = rows[0].length;
  const blocked = new Uint8Array(cols * rows.length);
  rows.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === "#") blocked[r * cols + c] = 1; }));
  return {
    id: "test", width: cols * cell, height: rows.length * cell, cell, cols, rows: rows.length, blocked,
    spawn: { x: 4, y: 4 }, djSpot: { x: 4, y: 4, dir: "down" }, seats: [], standSpots: [], interactables: [], props: [],
  };
}
