import { baseRows } from "./worldmap";

// The world map's land off the main thread (~0.5 s for the whole world): in { row0, row1 }, out { rows } (transferred).

const ctx = self as unknown as { onmessage: ((e: MessageEvent<{ row0: number; row1: number }>) => void) | null; postMessage(m: unknown, t: Transferable[]): void };

ctx.onmessage = (e) => {
  const rows = baseRows(e.data.row0, e.data.row1);
  ctx.postMessage({ rows }, [rows.buffer]);
};
