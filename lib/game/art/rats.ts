// v17 (spec §14): the field rat, 10 × 7 px, side view facing right (mirrored for left): run 0/1, nibble 0/1 (head down
// at a grain) and fall (on its back). "." is transparent; the letters are RAT_PAL's. The SlingGame draws the same art
// at × 2. Original art.

export const RAT_W = 10;
export const RAT_H = 7;

export type RatFrame = "run0" | "run1" | "nibble0" | "nibble1" | "fall";
export const RAT_FRAMES: readonly RatFrame[] = ["run0", "run1", "nibble0", "nibble1", "fall"];

/** f fur, s shade, b belly, p ears, tail and nose, e eye, o the partial outline, g the grain it nibbles. */
export const RAT_PAL: Readonly<Record<string, string>> = {
  f: "#7a6450", s: "#5a4636", b: "#b8a48a", p: "#c98f86", e: "#1c1410", o: "#2e2218", g: "#e0b33c",
};

export const RAT_ART: Readonly<Record<RatFrame, readonly string[]>> = {
  run0: [
    "......pp..",
    "...offffo.",
    "..offfffeo",
    "pofssffffp",
    ".psbbbbbo.",
    "..s....s..",
    ".s......s.",
  ],
  run1: [
    "......pp..",
    "...offffo.",
    "..offfffeo",
    "pofssffffp",
    "p.sbbbbbo.",
    "...s..s...",
    "...s..s...",
  ],
  nibble0: [
    "..........",
    "...offf...",
    "..offffpp.",
    ".offssfffo",
    "pfsbbbbfeo",
    "p.s...s.pg",
    "..s...s..g",
  ],
  nibble1: [
    "..........",
    "...offfpp.",
    "..offfffo.",
    ".offssffeo",
    "pfsbbbbffp",
    "p.s...s..g",
    "..s...s..g",
  ],
  fall: [
    "..........",
    "..s..s.s..",
    ".sbbbbbbs.",
    "pobbbbbbfe",
    "p.offfffpo",
    "...oooooo.",
    "..........",
  ],
};

/** A frame's colours by row ("" = transparent), facing right, or mirrored for left. */
export function ratMatrix(frame: RatFrame, dir: 1 | -1): string[][] {
  const m = RAT_ART[frame].map((row) => [...row].map((ch) => (ch === "." ? "" : RAT_PAL[ch] ?? "")));
  if (dir === -1) for (const row of m) row.reverse();
  return m;
}

/** What a rat shows: running legs every 120 ms, nibbling bobs every 400 ms. */
export function ratFrame(moving: boolean, t: number): RatFrame {
  return moving ? (Math.floor(t / 120) % 2 ? "run1" : "run0") : Math.floor(t / 400) % 2 ? "nibble1" : "nibble0";
}

const cache = new Map<string, HTMLCanvasElement>();

function sprite(frame: RatFrame, dir: 1 | -1): HTMLCanvasElement {
  const key = `${frame}${dir}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = RAT_W;
  cv.height = RAT_H;
  const ctx = cv.getContext("2d");
  if (ctx) {
    ratMatrix(frame, dir).forEach((row, y) => row.forEach((col, x) => {
      if (!col) return;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }));
  }
  cache.set(key, cv);
  return cv;
}

/** Draws a rat with its feet's middle at (x, y), `scale` px a pixel (the SlingGame's 2). Browser only. */
export function drawRat(c: CanvasRenderingContext2D, frame: RatFrame, dir: 1 | -1, x: number, y: number, scale = 1): void {
  c.drawImage(sprite(frame, dir), Math.round(x - (RAT_W * scale) / 2), Math.round(y - RAT_H * scale), RAT_W * scale, RAT_H * scale);
}
