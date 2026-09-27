import { C } from "@/lib/game/maps/scene-art";

// The hall's hammock (võng), drawn live each frame: it sways a little in the wind, and swings with whoever lies in it.
// Same geometry as the baked prop (lib/game/maps/props.ts drawHammock): ropes from the palm trunk (x+1, y-26) and the
// pole top (x2, y-28), fabric from x+10 to x2-8 sagging 9 px.

type Ctx = CanvasRenderingContext2D;

/** One swing of a lying person, and of the empty hammock in the breeze (ms). */
export const HAMMOCK_PERIOD_MS = 2500;
export const HAMMOCK_IDLE_PERIOD_MS = 3400;
/** Lying this long starts the "z z" bubbles. */
export const HAMMOCK_DOZE_MS = 4000;

const FABRIC = ["#e05a47", "#f2c23c", "#3d86a8", "#f4f1ea"];
const ROPE = "#d8c7a0";

/** The swing's offset now (px, fractional): ~2 px with someone in it, under 1 px empty (more in the wind, `wind` =
 *  the palms' sway amplitude 0–3). Still under reduced motion. */
export function hammockSwing(t: number, occupied: boolean, wind: number, reduced: boolean): number {
  if (reduced) return 0;
  const w = Math.max(0, Math.min(3, wind));
  if (occupied) return (2 + w * 0.4) * Math.sin((2 * Math.PI * t) / HAMMOCK_PERIOD_MS);
  return (0.6 + w * 0.6) * Math.sin((2 * Math.PI * t) / HAMMOCK_IDLE_PERIOD_MS);
}

/** The fabric column at world x: its top row, thickness and bottom outline row (swing offset included). */
export function fabricAt(x: number, y: number, x2: number, wx: number, swing: number): { top: number; thick: number; bottom: number } | null {
  const a = x + 10, b = x2 - 8;
  if (wx < a || wx > b) return null;
  const s = Math.sin((Math.PI * (wx - a)) / (b - a));
  const sag = Math.round(9 * s), thick = 2 + Math.round(4 * s), dy = Math.round(swing * s);
  const top = y - 22 + sag - thick + dy;
  return { top, thick, bottom: top + thick };
}

/** A character lying on its back, head west: the down-facing frame turned a quarter left, cropped to its pixels. */
export interface LyingSprite { canvas: HTMLCanvasElement; w: number; h: number }
const lyingCache = new WeakMap<object, LyingSprite>();

export function lyingSprite(frame: HTMLCanvasElement, make: (w: number, h: number) => HTMLCanvasElement): LyingSprite {
  const hit = lyingCache.get(frame);
  if (hit) return hit;
  const W = frame.width, H = frame.height;
  const src = frame.getContext("2d")!.getImageData(0, 0, W, H).data;
  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (src[(y * W + x) * 4 + 3] === 0) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) { x0 = 0; x1 = 0; y0 = 0; y1 = 0; }
  // (x, y) → (y - y0, x1 - x): the head (top) goes west, the frame's right side goes up
  const w = y1 - y0 + 1, h = x1 - x0 + 1;
  const canvas = make(w, h);
  const c = canvas.getContext("2d")!;
  const img = c.createImageData(w, h);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const s = (y * W + x) * 4, d = ((x1 - x) * w + (y - y0)) * 4;
    img.data[d] = src[s]; img.data[d + 1] = src[s + 1]; img.data[d + 2] = src[s + 2]; img.data[d + 3] = src[s + 3];
  }
  c.putImageData(img, 0, 0);
  const out = { canvas, w, h };
  lyingCache.set(frame, out);
  return out;
}

/** Where the lying body's columns start (world x) — centred on the fabric. */
export function bodyLeft(x: number, x2: number, w: number): number {
  return Math.round((x + 10 + x2 - 8) / 2 - w / 2);
}

/** The hammock (x, y, x2 as placed) at camera (camX, camY), swinging by `swing`, with `body` lying in it (null =
 *  empty). `dozeMs` = how long they have lain (the "z z" after HAMMOCK_DOZE_MS). Order: shadow, ropes, fabric, the
 *  body following the sag, then the fabric's front lip over the body's near side. */
export function drawHammockLive(
  c: Ctx, x: number, y: number, x2: number, camX: number, camY: number, swing: number,
  body: LyingSprite | null, dozeMs: number, t: number, reduced: boolean,
): void {
  const a = x + 10, b = x2 - 8;
  const X = (wx: number) => Math.round(wx) - camX, Y = (wy: number) => Math.round(wy) - camY;
  const dot = (col: string, wx: number, wy: number) => { c.fillStyle = col; c.fillRect(X(wx), Y(wy), 1, 1); };
  // the shadow on the grass, drifting with the swing
  c.fillStyle = "rgba(40, 25, 10, 0.2)";
  const sh = Math.round(swing);
  c.fillRect(X(a + 6 + sh), Y(y - 4), b - a - 12, 2);
  c.fillRect(X(a + 10 + sh), Y(y - 2), b - a - 20, 1);
  // ropes (pinned at both ends: the fabric's ends do not move)
  for (let i = 0; i <= 8; i++) {
    dot(ROPE, x + 1 + i, y - 26 + i * 0.5);
    dot(ROPE, x2 - i, y - 28 + i * 0.75);
  }
  const col = (wx: number, from: number) => {
    const f = fabricAt(x, y, x2, wx, swing)!;
    for (let k = from; k < f.thick; k++) dot(FABRIC[Math.floor((wx - a) / 3) % 4], wx, f.top + k);
    dot(C.outline, wx, f.bottom);
    return f;
  };
  for (let wx = a; wx <= b; wx++) {
    const f = col(wx, 0);
    dot(C.outline, wx, f.top - 1);
  }
  if (!body) return;
  const left = bodyLeft(x, x2, body.w);
  for (let i = 0; i < body.w; i++) {
    const wx = left + i;
    const f = fabricAt(x, y, x2, Math.max(a, Math.min(b, wx)), swing)!;
    // the body sinks into the fabric: its bottom row is the fabric's lower edge, and the fabric wraps over its near side
    c.drawImage(body.canvas, i, 0, 1, body.h, X(wx), Y(f.bottom + 1 - body.h), 1, body.h);
  }
  for (let wx = Math.max(a, left); wx <= Math.min(b, left + body.w - 1); wx++) {
    const f = col(wx, 0);
    dot(C.outline, wx, f.top - 1);
  }
  if (dozeMs >= HAMMOCK_DOZE_MS) {
    const head = fabricAt(x, y, x2, Math.max(a, left + 6), swing)!;
    drawZz(c, X(left + 10), Y(head.bottom + 1 - body.h), reduced ? 0 : (t % 2400) / 2400);
  }
}

const Z = ["####", "..#.", ".#..", "####"];

/** Two small "z"s rising from the sleeper's head; `phase` 0–1 moves them up and fades them (0 = held). */
function drawZz(c: Ctx, hx: number, hy: number, phase: number): void {
  const zs: Array<[number, number, number]> = [[0, 0, 1], [5, -6, 0.5]];
  for (const [dx, dy, lag] of zs) {
    const p = (phase + lag) % 1;
    const rise = Math.round(p * 5), alpha = phase === 0 ? 1 : p < 0.8 ? 1 : 1 - (p - 0.8) / 0.2;
    c.globalAlpha = alpha;
    Z.forEach((row, ry) => [...row].forEach((ch, rx) => {
      if (ch !== "#") return;
      c.fillStyle = "#3a2418";
      c.fillRect(hx + dx + rx + 1, hy + dy - rise + ry + 1 - 4, 1, 1);
      c.fillStyle = "#f4f1ea";
      c.fillRect(hx + dx + rx, hy + dy - rise + ry - 4, 1, 1);
    }));
    c.globalAlpha = 1;
  }
}
