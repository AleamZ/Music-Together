// Shared helpers for the procedural scene painters (browser only: canvas). 1 world px = 1 canvas px, and a seeded RNG
// paints the same scene on every client. Original art in the approved Miền Tây style — no copied images.

export interface PropSprite { canvas: HTMLCanvasElement; x: number; y: number; sortY: number }

/** A painted map: what the engine draws every frame. */
export interface SceneArt {
  /** Static ground, 1 world px per canvas px. */
  background: HTMLCanvasElement;
  /** Depth-sorted sprites: world top-left + sort y (= the prop's base). */
  props: PropSprite[];
  /** Colour shown past the map's bottom edge (the camera may scroll there so the bottom HUD hides nothing). */
  edge: string;
  /** Per-frame ground animation, drawn in world coordinates minus the camera. */
  drawAnimated(ctx: CanvasRenderingContext2D, t: number, camX: number, camY: number, reducedMotion: boolean): void;
  /** Drawn above the characters (string lights, awnings, roofs). */
  drawOverhead(ctx: CanvasRenderingContext2D, t: number, camX: number, camY: number, reducedMotion: boolean): void;
}

/** Sprite canvas size and the anchor (the prop's base point) inside it. Pure. */
export interface PropFrame { w: number; h: number; ox: number; oy: number }

export type Ctx = CanvasRenderingContext2D;

export const C = {
  outline: "#3a2418",
  grass: "#6aa23c", grassLight: "#7fb548", grassDark: "#5a8f32", grassDeep: "#3f6e23", grassTip: "#8cc452",
  dirt: "#c89a5e", dirtDark: "#b58a52", dirtLight: "#d8b078",
  sand: "#dcc08a", bank: "#b89560", mud: "#8a6a3f",
  water: "#3d86a8", waterDeep: "#2f6e8f", waterLight: "#4a93b4", sparkle: "#a6d6e8", sparkle2: "#6fb2cf",
  wood: "#8b5a33", woodDark: "#6e4424", woodLight: "#a8743f", woodDeep: "#5a381e", woodPale: "#c8905c",
  leaf: "#3d8a3a", leafLight: "#5caa4a", leafHi: "#86c95c", leafDark: "#2f6e2f", leafDeep: "#24592a",
  trunk: "#8a6d4a", trunkLight: "#b08d62", trunkDark: "#6e5438", trunkRing: "#5e4630",
  bamboo: "#8bb84e", bambooDark: "#6a9a38", bambooNode: "#4f7a2a",
  red: "#c0392b", redDark: "#8e2a1f", gold: "#e0b33c", goldLight: "#ffe08a",
  speaker: "#1e1616", speakerFace: "#2b2020", cone: "#4a4040", coneCenter: "#1a1414",
  paper: "#f4efe0", white: "#f4f1ea", silver: "#c3c8d4", blue: "#3d6fd1",
};

/** Deterministic LCG in [0, 1) — the same seed paints the same scene on every client. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  return cv;
}

export function ctx2d(cv: HTMLCanvasElement): Ctx {
  const c = cv.getContext("2d");
  if (!c) throw new Error("canvas-2d-unavailable");
  return c;
}

export function rect(c: Ctx, col: string, x: number, y: number, w: number, h: number): void {
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), w, h);
}

export function px(c: Ctx, col: string, x: number, y: number): void {
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), 1, 1);
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
