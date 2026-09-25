import type { Facing, Look } from "@/lib/game/types";
import { composeMatrix, lookKey } from "./compose";
import { SPRITE_H, SPRITE_W, type Frame } from "./layers";

export type CharacterFrames = Record<Facing, HTMLCanvasElement[]>;

const FACINGS: Facing[] = ["down", "up", "left", "right"];
const FRAMES: Frame[] = [0, 1, 2, 3];
const MAX_CACHED = 64;
const cache = new Map<string, CharacterFrames>();

export function matrixToCanvas(m: string[][]): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = SPRITE_W;
  cv.height = SPRITE_H;
  const ctx = cv.getContext("2d");
  if (!ctx) return cv;
  m.forEach((row, y) => row.forEach((col, x) => {
    if (!col) return;
    ctx.fillStyle = col;
    ctx.fillRect(x, y, 1, 1);
  }));
  return cv;
}

/** Pre-rendered 24×48 canvases for every facing × walk frame, LRU-cached per look. */
export function getCharacterFrames(look: Look): CharacterFrames {
  const key = lookKey(look);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const frames = {} as CharacterFrames;
  for (const f of FACINGS) frames[f] = FRAMES.map((fr) => matrixToCanvas(composeMatrix(look, f, fr)));
  cache.set(key, frames);
  if (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return frames;
}

/** 24×24 head-and-shoulders crop (front, idle) for the HUD and the editor. */
export function getPortrait(look: Look): HTMLCanvasElement {
  const src = getCharacterFrames(look).down[0];
  const cv = document.createElement("canvas");
  cv.width = 24;
  cv.height = 24;
  cv.getContext("2d")?.drawImage(src, 0, 0, 24, 24, 0, 0, 24, 24);
  return cv;
}
