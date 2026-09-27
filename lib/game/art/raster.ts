import type { Facing, Look } from "@/lib/game/types";
import type { Lower } from "./body";
import { armColoursOf, composeMatrix, lookKey, lowerOf } from "./compose";
import { FRAMES, SPRITE_H, SPRITE_W } from "./layers";

// what each character frame wears below the hips (the seated rider needs it: legs, or a skirt over the lap)
const lowers = new WeakMap<object, Lower>();
export const tagLower = (frame: object, lower: Lower): void => { lowers.set(frame, lower); };
export const lowerOfFrame = (frame: object): Lower | null => lowers.get(frame) ?? null;
// and its arm colours (sleeve, skin), for the seated rider's redrawn arms
const arms = new WeakMap<object, { sleeve: string; skin: string }>();
export const tagArms = (frame: object, colours: { sleeve: string; skin: string }): void => { arms.set(frame, colours); };
export const armsOfFrame = (frame: object): { sleeve: string; skin: string } | null => arms.get(frame) ?? null;

/** Per facing, one canvas per pose frame (see `Frame`: idle, the four walk frames, idle breath). */
export type CharacterFrames = Record<Facing, HTMLCanvasElement[]>;

const FACINGS: Facing[] = ["down", "up", "left", "right"];
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

/** Pre-rendered 24×48 canvases for every facing × pose frame (4 × 6), LRU-cached per look. */
export function getCharacterFrames(look: Look): CharacterFrames {
  const key = lookKey(look);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const frames = {} as CharacterFrames;
  const lower = lowerOf(look), armCols = armColoursOf(look);
  for (const f of FACINGS) frames[f] = FRAMES.map((fr) => {
    const cv = matrixToCanvas(composeMatrix(look, f, fr));
    tagLower(cv, lower);
    tagArms(cv, armCols);
    return cv;
  });
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
