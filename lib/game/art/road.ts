import { ROW, skirtLength } from "./body";
import type { Frame } from "./layers";
import { OUTLINE } from "./palettes";
import { armsOfFrame, lowerOfFrame } from "./raster";
import type { VehicleId } from "@/lib/game/travel/vehicles";

// v18.5 Đường ra chợ: the road cutscene, painted as original pixel art on a 320×180 logical canvas.
// Everything is fillRect-based (plus drawImage for the rider) so it stays crisp when scaled up pixelated.
// `t` is in milliseconds. `dir` 1 scrolls the world left (going to the market), -1 scrolls it right (going home).

type Ctx = CanvasRenderingContext2D;

export const ROAD_W = 320;
export const ROAD_H = 180;
/** Where the traveller's wheels / feet touch the road (upper lane). */
export const ROAD_GROUND_Y = 148;
/** World scroll speed per mode, px/s. */
export const ROAD_SPEED: Record<VehicleId | "walk", number> = { walk: 30, bike: 60, moto: 140, car: 320 };

const HORIZON = 104;

// ---------- tiny drawing helpers ----------
export function rect(c: Ctx, x: number, y: number, w: number, h: number, col: string): void {
  if (w <= 0 || h <= 0) return;
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}
export const px = (c: Ctx, x: number, y: number, col: string) => rect(c, x, y, 1, 1, col);

export function line(c: Ctx, x0: number, y0: number, x1: number, y1: number, col: string): void {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  c.fillStyle = col;
  for (let i = 0; i < 400; i++) {
    c.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

export function disc(c: Ctx, cx: number, cy: number, r: number, col: string, squash = 1): void {
  const rr = Math.max(0, Math.round(r));
  const rows = Math.max(0, Math.round(rr * squash));
  c.fillStyle = col;
  for (let dy = -rows; dy <= rows; dy++) {
    const f = rows === 0 ? 0 : dy / rows;
    const w = Math.round(Math.sqrt(Math.max(0, 1 - f * f)) * rr);
    c.fillRect(Math.round(cx - w), Math.round(cy + dy), 2 * w + 1, 1);
  }
}

const wrap = (v: number, m: number) => ((v % m) + m) % m;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hex(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, f: number): string {
  const A = hex(a), B = hex(b);
  const ch = (i: number) => Math.round(A[i] + (B[i] - A[i]) * f).toString(16).padStart(2, "0");
  return `#${ch(0)}${ch(1)}${ch(2)}`;
}

// ---------- deterministic scenery (generated once) ----------
const SKY_STOPS: [number, string][] = [
  [0, "#1c1636"], [22, "#37225a"], [46, "#76386a"], [70, "#cc5a5c"], [88, "#f0935a"], [HORIZON, "#f9d07c"],
];
function skyAt(y: number): string {
  for (let i = 1; i < SKY_STOPS.length; i++) {
    const [y1, c1] = SKY_STOPS[i];
    const [y0, c0] = SKY_STOPS[i - 1];
    if (y <= y1) return mix(c0, c1, (y - y0) / (y1 - y0));
  }
  return SKY_STOPS[SKY_STOPS.length - 1][1];
}
const SKY_BAND = 6;
const SKY_BANDS: string[] = Array.from({ length: Math.ceil(HORIZON / SKY_BAND) + 1 }, (_, i) => skyAt(i * SKY_BAND + SKY_BAND / 2));

const rng = mulberry32(1805);
const STARS = Array.from({ length: 26 }, () => ({ x: Math.floor(rng() * ROAD_W), y: Math.floor(rng() * 34), tw: rng() * 6 }));
const CLOUDS = Array.from({ length: 5 }, (_, i) => ({ x: i * 72 + Math.floor(rng() * 30), y: 24 + Math.floor(rng() * 40), w: 22 + Math.floor(rng() * 26) }));

type FarThing = { kind: "house" | "pagoda" | "tree"; x: number; w: number; h: number; lit: boolean };
const FAR: FarThing[] = (() => {
  const out: FarThing[] = [{ kind: "pagoda", x: 70, w: 17, h: 34, lit: true }];
  let x = 96;
  while (x < 300 + 60) {
    const r = rng();
    if (r < 0.55) out.push({ kind: "house", x, w: 12 + Math.floor(rng() * 10), h: 7 + Math.floor(rng() * 5), lit: rng() < 0.6 });
    else out.push({ kind: "tree", x, w: 8 + Math.floor(rng() * 8), h: 8 + Math.floor(rng() * 6), lit: false });
    x += 16 + Math.floor(rng() * 22);
  }
  return out.filter((f) => f.kind === "pagoda" || f.x < 60 || f.x > 92).map((f) => ({ ...f, x: wrap(f.x, ROAD_W) }));
})();
const hillTop = (x: number) => 92 - 4 * Math.sin((2 * Math.PI * 2 * x) / ROAD_W) - 2 * Math.sin((2 * Math.PI * 5 * x) / ROAD_W + 1) - Math.sin((2 * Math.PI * 11 * x) / ROAD_W + 2);

const PALM_PERIOD = 420;
const PALMS = Array.from({ length: 5 }, (_, i) => ({
  x: i * 84 + Math.floor(rng() * 40), base: 114 + Math.floor(rng() * 6), h: 34 + Math.floor(rng() * 16), lean: (rng() - 0.3) * 10,
}));
const GLINTS = Array.from({ length: 30 }, () => ({ x: Math.floor(rng() * ROAD_W), y: 106 + Math.floor(rng() * 22), w: 2 + Math.floor(rng() * 5) }));
const SPECKS = Array.from({ length: 70 }, () => ({ x: Math.floor(rng() * ROAD_W), y: 137 + Math.floor(rng() * 30), light: rng() < 0.5 }));
const PEBBLES = Array.from({ length: 30 }, () => ({ x: Math.floor(rng() * ROAD_W), y: 172 + Math.floor(rng() * 7) }));

const PADDY_ROWS: [number, number, string][] = [
  [104, 2, "#5b7040"], [106, 2, "#667c42"], [108, 3, "#5a7238"], [111, 3, "#78924a"], [114, 4, "#65853e"],
  [118, 4, "#82a24c"], [122, 3, "#6c8e40"], [125, 3, "#88aa50"],
];

// ---------- the landscape ----------
/** The scrolling dusk countryside: sky, sun, distant village + pagoda, paddies + palms, telephone poles, the road. */
export function paintRoad(c: Ctx, w: number, h: number, t: number, speed: number, reduced: boolean, dir: 1 | -1 = 1): void {
  const tt = reduced ? 0 : t;
  const travel = (tt / 1000) * speed * dir;
  c.save();
  c.scale(w / ROAD_W, h / ROAD_H);

  // sky: stepped bands with a dithered seam, then stars and a glowing sun
  for (let i = 0; i < SKY_BANDS.length; i++) {
    const y = i * SKY_BAND;
    if (y >= HORIZON) break;
    rect(c, 0, y, ROAD_W, Math.min(SKY_BAND, HORIZON - y), SKY_BANDS[i]);
    const next = SKY_BANDS[i + 1];
    if (next && y + SKY_BAND - 1 < HORIZON) {
      c.fillStyle = next;
      for (let x = i % 2; x < ROAD_W; x += 2) c.fillRect(x, y + SKY_BAND - 1, 1, 1);
    }
  }
  for (const s of STARS) {
    const on = reduced || Math.sin(tt / 400 + s.tw) > -0.6;
    if (on) px(c, s.x, s.y, s.y < 16 ? "#fff6d8" : "#e8c8e8");
  }
  disc(c, 226, 84, 24, "rgba(255,196,120,0.14)");
  disc(c, 226, 84, 19, "rgba(255,210,140,0.22)");
  disc(c, 226, 84, 15, "#ffc86a");
  disc(c, 226, 83, 12, "#ffe29a");
  disc(c, 224, 80, 6, "#fff4cc");
  for (const [dy, hh] of [[6, 1], [10, 1], [13, 2]] as const) rect(c, 208, 84 + dy, 37, hh, skyAt(84 + dy));

  // clouds (0.05) lit from below, and a little flock of birds
  for (const cl of CLOUDS) {
    const x = wrap(cl.x - travel * 0.05, ROAD_W + 60) - 30;
    rect(c, x + 4, cl.y, cl.w - 8, 2, "#b06a8a");
    rect(c, x, cl.y + 2, cl.w, 2, "#d27e8c");
    rect(c, x + 3, cl.y + 4, cl.w - 5, 1, "#f4b0a0");
  }
  for (let i = 0; i < 5; i++) {
    const bx = wrap(40 + i * 9 + (tt / 1000) * 6 - travel * 0.02, ROAD_W + 40) - 20;
    const by = 40 + (i % 2) * 4 + i * 2 + Math.round(Math.sin(tt / 900 + i));
    const up = Math.floor(tt / 180 + i) % 2 === 0;
    px(c, bx, by, "#2a1a36");
    px(c, bx - 1, by - (up ? 1 : 0), "#2a1a36");
    px(c, bx + 1, by - (up ? 1 : 0), "#2a1a36");
    if (up) { px(c, bx - 2, by - 1, "#2a1a36"); px(c, bx + 2, by - 1, "#2a1a36"); }
  }

  // far layer (0.1): hazy hills, the village roofs with lit windows, a pagoda
  const farOff = travel * 0.1;
  for (let x = 0; x < ROAD_W; x++) {
    const top = Math.round(hillTop(wrap(x + farOff, ROAD_W)));
    rect(c, x, top, 1, HORIZON - top, "#6c4468");
  }
  for (const f of FAR) {
    let fx = wrap(f.x - farOff, ROAD_W);
    for (let k = 0; k < 2; k++, fx -= ROAD_W) {
      if (fx > ROAD_W || fx + f.w < -12) continue;
      drawFarThing(c, fx, f, tt);
    }
  }
  rect(c, 0, HORIZON - 3, ROAD_W, 3, "rgba(255,200,150,0.22)");

  // mid layer (0.3): flooded paddies reflecting the sky, dikes, coconut palms
  const midOff = travel * 0.3;
  for (const [y, hh, col] of PADDY_ROWS) rect(c, 0, y, ROAD_W, hh, col);
  for (const g of GLINTS) {
    const gx = wrap(g.x - midOff, ROAD_W);
    rect(c, gx, g.y, g.w, 1, g.y < 116 ? "#f2b877" : "#e7a36a");
  }
  for (let k = -1; k < 5; k++) {
    const bx = wrap(-midOff, 90) + k * 90;
    line(c, bx, HORIZON, bx - 34, 128, "#4c6232");
  }
  for (let x = wrap(-midOff, 6); x < ROAD_W; x += 6) {
    px(c, x, 124, "#9cc05a");
    px(c, x + 3, 120, "#8fb356");
  }
  for (const p of PALMS) {
    let pxx = wrap(p.x - midOff, PALM_PERIOD) - 40;
    for (let k = 0; k < 2; k++, pxx += PALM_PERIOD) if (pxx > -40 && pxx < ROAD_W + 40) drawPalm(c, pxx, p.base, p.h, p.lean, tt, reduced);
  }

  // poles (0.6) with sagging wires
  const poleOff = travel * 0.6;
  const PP = 150;
  const first = Math.floor((poleOff - 40) / PP);
  for (let k = first; k <= first + 4; k++) {
    const x = k * PP - poleOff;
    for (const [ax, ay] of [[-7, 73], [7, 73], [0, 68]] as const) {
      for (let wx = 0; wx <= PP; wx += 1) {
        const u = wx / PP;
        const sx = Math.round(x + ax + wx);
        if (sx < 0 || sx >= ROAD_W) continue;
        px(c, sx, Math.round(ay + 1 + 9 * 4 * u * (1 - u)), "#2b1e2e");
      }
    }
    if (x > -20 && x < ROAD_W + 20) drawPole(c, x);
  }

  // road (1.0)
  const roadOff = travel;
  rect(c, 0, 128, ROAD_W, 6, "#4e7434");
  for (let x = wrap(-roadOff, 7) - 7; x < ROAD_W; x += 7) {
    rect(c, x, 127, 1, 2, "#5f8a3c");
    rect(c, x + 3, 126, 1, 3, "#6d9a44");
  }
  rect(c, 0, 134, ROAD_W, 36, "#474150");
  rect(c, 0, 134, ROAD_W, 4, "#524a5c");
  for (const s of SPECKS) px(c, wrap(s.x - roadOff, ROAD_W), s.y, s.light ? "#5a5366" : "#3b3644");
  rect(c, 0, 135, ROAD_W, 1, "#d8cdb8");
  rect(c, 0, 168, ROAD_W, 1, "#d8cdb8");
  for (let x = wrap(-roadOff, 26) - 26; x < ROAD_W; x += 26) rect(c, x, 151, 14, 2, "#eedd9e");
  rect(c, 0, 169, ROAD_W, 1, "#2e2934");
  rect(c, 0, 170, ROAD_W, 10, "#86664a");
  rect(c, 0, 170, ROAD_W, 1, "#6a4f3a");
  for (const p of PEBBLES) px(c, wrap(p.x - roadOff, ROAD_W), p.y, "#a88a6a");
  const ms = wrap(250 - roadOff, 560) - 40;
  if (ms > -12 && ms < ROAD_W) drawMilestone(c, ms);
  // foreground grass (1.4) for depth
  for (let x = wrap(-roadOff * 1.4, 11) - 11; x < ROAD_W; x += 11) {
    rect(c, x, 176, 1, 4, "#2f4a26");
    rect(c, x + 2, 174, 1, 6, "#3a5a2c");
    rect(c, x + 4, 177, 1, 3, "#2f4a26");
  }
  // warm dusk wash over the lower half
  rect(c, 0, HORIZON, ROAD_W, ROAD_H - HORIZON, "rgba(255,150,90,0.06)");
  c.restore();
}

function drawFarThing(c: Ctx, x: number, f: FarThing, t: number): void {
  const base = HORIZON - 1;
  const ink = "#43284e";
  if (f.kind === "tree") {
    disc(c, x + f.w / 2, base - f.h + 4, f.w / 2, "#4f3056", 0.7);
    rect(c, x + f.w / 2, base - 4, 1, 4, ink);
    return;
  }
  if (f.kind === "house") {
    const wallTop = base - f.h + 4;
    rect(c, x + 1, wallTop, f.w - 2, base - wallTop + 1, ink);
    for (let r = 0; r < 5; r++) rect(c, x + 3 - r, wallTop - 5 + r, f.w - 6 + 2 * r, 1, "#39204a");
    rect(c, x - 2, wallTop - 1, f.w + 4, 1, "#39204a");
    if (f.lit) {
      const flick = Math.floor(t / 1300 + x) % 7 === 0 ? "#ffb85a" : "#ffd27a";
      rect(c, x + 3, wallTop + 2, 2, 2, flick);
      if (f.w > 15) rect(c, x + f.w - 6, wallTop + 2, 2, 2, "#ffd27a");
    }
    return;
  }
  // pagoda: five tiers with upturned eaves, a finial
  const cx = x + f.w / 2;
  let y = base;
  for (let tier = 0; tier < 5; tier++) {
    const bw = 11 - tier * 2;
    const bh = tier === 0 ? 6 : 4;
    rect(c, cx - bw / 2, y - bh, bw, bh, ink);
    if (f.lit) px(c, cx, y - bh + 1, "#ffcf6a");
    y -= bh;
    const rw = bw + 6;
    rect(c, cx - rw / 2, y - 1, rw, 1, "#36204a");
    rect(c, cx - rw / 2 + 1, y - 2, rw - 2, 1, "#36204a");
    px(c, cx - rw / 2 - 1, y - 2, "#36204a");
    px(c, cx + rw / 2, y - 2, "#36204a");
    y -= 2;
  }
  rect(c, cx, y - 5, 1, 5, ink);
  px(c, cx, y - 6, "#ffcf6a");
}

function drawPalm(c: Ctx, x: number, base: number, h: number, lean: number, t: number, reduced: boolean): void {
  let topX = x, topY = base;
  for (let i = 0; i <= h; i++) {
    const u = i / h;
    const tx = x + lean * u * u;
    const ty = base - i;
    rect(c, tx, ty, 2, 1, i % 3 === 0 ? "#3a2820" : "#4c3426");
    if (i % 3 === 0) px(c, tx + 1, ty, "#6a4a34");
    topX = tx; topY = ty;
  }
  const sway = reduced ? 0 : Math.sin(t / 700 + x * 0.05) * 0.06;
  const fronds = [-2.9, -2.4, -1.9, -1.2, -0.7, -0.2, -3.3];
  for (let f = 0; f < fronds.length; f++) {
    const a = fronds[f] + sway;
    const len = 12 + (f % 3) * 2;
    for (let s = 2; s <= len; s++) {
      const fx = topX + 1 + Math.cos(a) * s;
      const fy = topY + Math.sin(a) * s * 0.55 + s * s * 0.045;
      px(c, fx, fy, s > len - 3 ? "#4e6c34" : "#2c4628");
      if (s % 2 === 0 && s > 3) px(c, fx, fy + 1, "#243a22");
    }
  }
  disc(c, topX + 1, topY + 1, 2, "#2c4628");
  px(c, topX, topY + 3, "#6a4428");
  px(c, topX + 2, topY + 3, "#7a5030");
  px(c, topX + 1, topY + 4, "#6a4428");
}

function drawPole(c: Ctx, x: number): void {
  rect(c, x - 1, 66, 3, 64, "#3a2a24");
  rect(c, x + 1, 66, 1, 64, "#56402f");
  rect(c, x - 9, 72, 19, 2, "#3a2a24");
  for (const ix of [-7, 7]) { rect(c, ix + x, 70, 1, 2, "#cfc6b4"); }
  rect(c, x, 66, 1, 2, "#cfc6b4");
  rect(c, x - 3, 129, 7, 1, "#2e3a22");
}

function drawMilestone(c: Ctx, x: number): void {
  rect(c, x, 164, 9, 12, "#ece4d4");
  rect(c, x, 160, 9, 5, "#c83a34");
  rect(c, x + 1, 159, 7, 1, "#c83a34");
  rect(c, x + 2, 167, 5, 1, "#3a3040");
  rect(c, x + 2, 170, 3, 1, "#3a3040");
  rect(c, x + 8, 164, 1, 12, "#bdb3a0");
  rect(c, x - 1, 176, 11, 1, "#5a4434");
}

// ---------- the traveller ----------
/** Which pose frame the rider shows (the overlay picks `getCharacterFrames(look).right[riderFrame(...)]`). */
export function riderFrame(vehicle: VehicleId | null, t: number, reduced: boolean): Frame {
  if (vehicle === null) return reduced ? 1 : ((1 + (Math.floor(t / 125) % 4)) as Frame);
  if (vehicle === "bike") return reduced ? 1 : Math.floor(t / 220) % 2 === 0 ? 1 : 3;
  return 0;
}

function shadow(c: Ctx, x: number, g: number, r: number): void {
  disc(c, x, g, r, "rgba(24,12,30,0.35)", 0.2);
}

export function wheel(c: Ctx, cx: number, cy: number, r: number, angle: number, tire: string, rim: string, spoke: string): void {
  disc(c, cx, cy, r, tire);
  disc(c, cx, cy, r - 1, rim);
  disc(c, cx, cy, r - 2, "#2a2230");
  for (let k = 0; k < 3; k++) {
    const a = angle + (k * Math.PI) / 3;
    const dx = Math.cos(a) * (r - 2), dy = Math.sin(a) * (r - 2);
    line(c, cx - dx, cy - dy, cx + dx, cy + dy, spoke);
  }
  px(c, cx, cy, "#f0e8d8");
}

// 3×5 pixel font (with descender row for g) for the bike bell bubble
const GLYPHS: Record<string, string[]> = {
  r: ["000", "101", "110", "100", "100"],
  e: ["000", "010", "101", "110", "011"],
  n: ["000", "110", "101", "101", "101"],
  g: ["000", "011", "101", "011", "001", "110"],
  "!": ["010", "010", "010", "000", "010"],
  " ": ["000"],
};
function pixelText(c: Ctx, x: number, y: number, text: string, col: string): void {
  c.fillStyle = col;
  let cx = x;
  for (const ch of text) {
    const gl = GLYPHS[ch] ?? GLYPHS[" "];
    gl.forEach((row, ry) => { for (let rx = 0; rx < row.length; rx++) if (row[rx] === "1") c.fillRect(cx + rx, y + ry, 1, 1); });
    cx += ch === "!" ? 3 : 4;
  }
}

function bellBubble(c: Ctx, x: number, y: number, pop: number): void {
  const w = 51, h = 11;
  const by = y - Math.round(pop);
  rect(c, x + 1, by, w - 2, h, "#3a2438");
  rect(c, x, by + 1, w, h - 2, "#3a2438");
  rect(c, x + 1, by + 1, w - 2, h - 2, "#fff6e2");
  rect(c, x + 4, by + h, 3, 1, "#3a2438");
  rect(c, x + 4, by + h - 1, 2, 1, "#fff6e2");
  px(c, x + 3, by + h + 1, "#3a2438");
  // tiny bell
  rect(c, x + 3, by + 3, 3, 3, "#e8b640");
  rect(c, x + 2, by + 6, 5, 1, "#c89420");
  px(c, x + 4, by + 2, "#c89420");
  pixelText(c, x + 9, by + 2, "reng reng!", "#3a2438");
}

/**
 * The traveller at `x` (centre) on `groundY`. `rider` is a 24×48 character frame facing right (null draws no rider).
 * `flip` mirrors the traveller to face left (the trip home); the bell bubble is never mirrored.
 */
export function drawTraveller(c: Ctx, x: number, groundY: number, t: number, vehicle: VehicleId | null, rider: HTMLCanvasElement | null, reduced: boolean, flip = false, pillion: Pillion | null = null): void {
  const tt = reduced ? 0 : t;
  const g = groundY;
  c.save();
  if (flip) { c.translate(2 * x, 0); c.scale(-1, 1); }
  if (vehicle === null) drawWalker(c, x, g, tt, rider, reduced);
  else if (vehicle === "bike") drawBike(c, x, g, tt, rider, pillion);
  else if (vehicle === "moto") drawMoto(c, x, g, tt, rider, reduced, pillion);
  else drawCar(c, x, g, tt, rider, reduced, pillion);
  c.restore();
  if (vehicle === "bike" && !reduced) {
    const phase = tt % 3000;
    if (phase < 1200) bellBubble(c, flip ? x - 45 : x - 4, g - 70, phase < 90 ? 2 - phase / 45 : 0);
  }
}

function drawWalker(c: Ctx, x: number, g: number, t: number, rider: HTMLCanvasElement | null, reduced: boolean): void {
  const step = Math.floor(t / 125);
  const bounce = reduced ? 0 : step % 2 === 1 ? -1 : 0;
  shadow(c, x, g, 8);
  if (!reduced && step % 4 === 0) {
    const a = (t % 125) / 125;
    px(c, x - 6 - a * 4, g - 1 - a * 2, "rgba(210,180,140,0.7)");
    px(c, x - 8 - a * 5, g - a * 3, "rgba(210,180,140,0.45)");
  }
  if (rider) c.drawImage(rider, x - 12, g - 46 + bounce);
  else rect(c, x - 4, g - 30 + bounce, 8, 30, "#e8c090");
}

// the rider sprite's hip row (sprite rows 0..HIP_ROW are drawn when seated: head, torso, hips/skirt)
export const HIP_ROW = 34;

/** v18.13 Đi nhờ xe: the passenger's still frames (24×48) facing right, toward the viewer and away. */
export interface Pillion { right: HTMLCanvasElement; down: HTMLCanvasElement; up: HTMLCanvasElement }

/**
 * v18.13: a passenger sitting side-saddle (a bike's rear rack): frame `f` (seen from the front or the back) with the
 * hips at `hip`, the legs hanging straight down from the seat with `cut` shin rows left out (they dangle, clear of the
 * ground). The sprite's own legs, skirt and shoes, so every outfit keeps its colours.
 */
export function sideSaddle(c: Ctx, f: HTMLCanvasElement, hip: Pt, cut = 3): void {
  const left = Math.round(hip.x) - 12, y = Math.round(hip.y);
  const thigh = 5;
  const low = HIP_ROW + 1 + thigh + cut;
  c.drawImage(f, 0, HIP_ROW + 1, 24, thigh, left, y + 1, 24, thigh);
  c.drawImage(f, 0, low, 24, 47 - low, left, y + 1 + thigh, 24, 47 - low);
  c.drawImage(f, 0, 0, 24, HIP_ROW + 1, left, y - HIP_ROW, 24, HIP_ROW + 1);
}

/** v18.13: a passenger's upper body only (rows 0..HIP_ROW of frame `f`, hips at `hip`) — seen over a driver's shoulder
 *  or through a car window. */
export function upperBody(c: Ctx, f: HTMLCanvasElement, hip: Pt): void {
  c.drawImage(f, 0, 0, 24, HIP_ROW + 1, Math.round(hip.x) - 12, Math.round(hip.y) - HIP_ROW, 24, HIP_ROW + 1);
}

/** A sprite pixel's colour (null when blank or unreadable). */
export function spriteColour(rider: HTMLCanvasElement, sx: number, sy: number): string | null {
  try {
    const d = rider.getContext("2d")?.getImageData(sx, sy, 1, 1).data;
    if (!d || d[3] < 128) return null;
    return `rgb(${d[0]},${d[1]},${d[2]})`;
  } catch {
    return null;
  }
}

type Pt = { x: number; y: number };

/** Every pixel on the segment a→b (Bresenham). */
function segPoints(a: Pt, b: Pt): Pt[] {
  let x0 = Math.round(a.x), y0 = Math.round(a.y);
  const x1 = Math.round(b.x), y1 = Math.round(b.y);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const out: Pt[] = [];
  for (let i = 0; i < 400; i++) {
    out.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return out;
}

/** A limb `w` px thick along a polyline, with a 1 px outline around it (the sprite's style). Each segment has its own fill. */
export function limb(c: Ctx, pts: Pt[], fills: string[], w: number): void {
  const segs = pts.slice(1).map((p, i) => segPoints(pts[i], p));
  const o = Math.floor(w / 2);
  for (const s of segs) for (const p of s) rect(c, p.x - o - 1, p.y - o - 1, w + 2, w + 2, OUTLINE);
  segs.forEach((s, i) => { for (const p of s) rect(c, p.x - o, p.y - o, w, w, fills[i]); });
}

/** A 4×3 shoe (outlined), toes forward (+x), its sole on `foot`. */
export function shoeAt(c: Ctx, foot: Pt, col: string): void {
  rect(c, foot.x - 2, foot.y - 3, 6, 5, OUTLINE);
  rect(c, foot.x - 1, foot.y - 2, 4, 3, col);
}

/** The most common fill colour in a sprite region (rows y0..y1, columns x0..x1), skipping blanks and the dark outline
 *  pixels; null when nothing readable is there. Sampling a region (not one pixel) avoids landing on an outline or on
 *  the gap between the legs. */
const OUTLINE_RGB = [1, 3, 5].map((i) => parseInt(OUTLINE.slice(i, i + 2), 16));

export function regionColour(rider: HTMLCanvasElement, x0: number, x1: number, y0: number, y1: number, skip?: (col: string) => boolean): string | null {
  try {
    const d = rider.getContext("2d")?.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data;
    if (!d) return null;
    const count = new Map<string, number>();
    for (let i = 0; i < d.length; i += 4) {
      // skip blanks and the traced outline only — dark trousers and dark skirts are real colours
      if (d[i + 3] < 128 || (d[i] === OUTLINE_RGB[0] && d[i + 1] === OUTLINE_RGB[1] && d[i + 2] === OUTLINE_RGB[2])) continue;
      const k = `rgb(${d[i]},${d[i + 1]},${d[i + 2]})`;
      if (skip?.(k)) continue;
      count.set(k, (count.get(k) ?? 0) + 1);
    }
    let best: string | null = null, n = 0;
    for (const [k, v] of count) if (v > n) { best = k; n = v; }
    return best;
  } catch {
    return null;
  }
}

/** Colours read off a character frame (regions of the 24×48 layout), with fallbacks. The legs take the colour just
 *  below the hips (bare skin under shorts and skirts, the trousers otherwise). */
export function riderColours(rider: HTMLCanvasElement): { thigh: string; shin: string; shoe: string; boot: string | null; sleeve: string; skin: string; shirt: string } {
  // the look's own sleeve and skin colours when the frame carries them (long hair covers the torso side-on, so pixel
  // sampling there picks up the hair); sampled only for untagged frames
  const tagged = armsOfFrame(rider);
  const skin = tagged?.skin ?? regionColour(rider, 9, 14, 12, 16) ?? "#f2c7a0";
  const shoe = regionColour(rider, 6, 17, 44, 46) ?? "#3a2a22";
  // tall boots: the shaft above the sole is the shoe's leather (the same hue) — then the shin is read above/around it
  const shaft = regionColour(rider, 6, 17, 41, 42);
  const leather = (col: string) => col === shoe || sameHue(col, shoe);
  const boot = shaft && leather(shaft) ? shaft : null;
  const skip = boot ? leather : undefined;
  // the thighs just below the hips (trousers, shorts, or bare skin under a skirt), the shin below — boot leather skipped
  const thighRaw = regionColour(rider, 7, 16, 36, 38, skip);
  const shin = regionColour(rider, 7, 16, 38, 42, skip) ?? thighRaw ?? skin;
  return {
    thigh: thighRaw ?? shin,
    shin,
    shoe,
    boot,
    sleeve: tagged?.sleeve ?? regionColour(rider, 8, 15, 21, 24) ?? "#f2c23c",
    skin,
    shirt: tagged?.sleeve ?? regionColour(rider, 8, 15, 24, 28) ?? "#f2c23c",
  };
}

export function darker(col: string): string {
  const m = col.match(/rgb\((\d+),(\d+),(\d+)\)/);
  if (m) return `rgb(${Math.round(+m[1] * 0.72)},${Math.round(+m[2] * 0.72)},${Math.round(+m[3] * 0.72)})`;
  if (col.startsWith("#")) return mix(col, "#000000", 0.28);
  return col;
}

/**
 * The rider seated (a right-facing frame): the sprite's upper body (down to the hips) with the hips on `seat`, and both
 * legs bent forward, 3 px thick and outlined like the sprite — the far leg darker, drawn first. `feet` gives each foot
 * (pedals, or the floorboard). With `grip`, the sprite's hanging arm is covered and both arms reach the handlebar
 * (the far arm darker, behind). Colours come from the sprite.
 */
export function seatedRider(c: Ctx, rider: HTMLCanvasElement, seat: Pt, knee: Pt, feet: [Pt, Pt], grip?: Pt): void {
  const col = riderColours(rider);
  const hip = { x: seat.x + 1, y: seat.y - 2 };
  const top = seat.y - HIP_ROW, left = seat.x - 12;
  const shoulder = { x: left + 12, y: top + 23 };
  // a relaxed arm: the upper arm hangs forward-down from the shoulder to a bent elbow (sleeve), the forearm reaches
  // forward to the grip (skin), the fist wraps the bar
  const arm = (g: Pt, sleeve: string, skin: string) => {
    const elbow = { x: Math.round(shoulder.x + (g.x - shoulder.x) * 0.4), y: Math.round(Math.max(shoulder.y + 4, g.y + 2)) };
    limb(c, [shoulder, elbow], [sleeve], 2);
    limb(c, [elbow, { x: g.x - 1, y: g.y + 1 }], [skin], 2);
    rect(c, g.x - 1, g.y - 1, 4, 4, OUTLINE);
    rect(c, g.x, g.y, 2, 2, skin);
  };
  const cover = legCover(rider);
  const thigh = cover ? cover.fabric : col.thigh;
  const leather = (s: string) => s === col.shoe || sameHue(s, col.shoe);
  const shin = cover && cover.below && !(col.boot && leather(cover.below)) ? cover.below : col.shin;
  // a leg: thigh, shin, and with tall boots the lower shin in the boot's leather (the shaft up to mid-shin)
  const leg = (k: Pt, f: Pt, dim: (s: string) => string) => {
    if (!col.boot) { limb(c, [hip, k, f], [dim(thigh), dim(shin)], 3); return; }
    const mid = { x: Math.round(k.x + (f.x - k.x) * 0.4), y: Math.round(k.y + (f.y - k.y) * 0.4) };
    limb(c, [hip, k, mid, f], [dim(thigh), dim(shin), dim(col.boot)], 3);
  };
  const same = (s: string) => s;
  // far side, behind the body
  if (grip) arm({ x: grip.x + 1, y: grip.y }, darker(col.sleeve), darker(col.skin));
  leg({ x: knee.x - 1, y: knee.y }, feet[1], darker);
  shoeAt(c, feet[1], darker(col.shoe));
  c.drawImage(rider, 0, 0, 24, HIP_ROW + 1, left, top, 24, HIP_ROW + 1);
  // near side, in front
  if (grip) rect(c, left + 10, top + 22, 4, 8, col.shirt);
  leg(knee, feet[0], same);
  shoeAt(c, feet[0], col.shoe);
  // a skirt or dress: the fabric lies over the lap and hangs from the knees down to its hem (as long as on the sprite)
  if (cover) drape(c, hip, knee, cover);
  if (grip) arm(grip, col.sleeve, col.skin);
}

/** What covers the legs below the hips on the sprite: a skirt/dress (its fabric colour, how many rows it hangs below
 *  the hips, the colour below its hem) — null for shorts and trousers (those are drawn as legs). */
type Cover = { fabric: string; shade: string; drop: number; below: string | null; hem: string; pleats: boolean };
function legCover(rider: HTMLCanvasElement): Cover | null {
  const fabric = regionColour(rider, 7, 16, HIP_ROW - 2, HIP_ROW);
  if (!fabric) return null;
  // the frame knows what it wears (tagged when rendered): trousers → legs; a skirt → its length below the hips
  const tagged = lowerOfFrame(rider);
  if (tagged) {
    if (tagged === "pants") return null;
    const drop = Math.max(1, ROW.hips + skirtLength(tagged) - 1 - HIP_ROW);
    const hemRow = HIP_ROW + drop;
    const hem = regionColour(rider, 6, 17, hemRow, hemRow) ?? darker(fabric);
    return { fabric, shade: darker(fabric), drop, below: regionColour(rider, 7, 16, hemRow + 1, Math.min(46, hemRow + 3)), hem, pleats: tagged === "pleated" };
  }
  // untagged (previews): guess from the pixels
  // a skirt spans the gap between the legs; trousers/shorts leave it (the gap is blank or outline at the centre)
  let hem = HIP_ROW;
  for (let y = HIP_ROW + 1; y <= 45; y++) {
    const mid = regionColour(rider, 10, 13, y, y);
    const any = regionColour(rider, 6, 17, y, y);
    if (mid !== null && (any === fabric || mid === fabric || sameHue(mid, fabric))) hem = y; else break;
  }
  // shorts and trousers open a gap at the centre right below the hips; any skirt (even a short one) fills it
  if (hem - HIP_ROW < 1) return null;
  return { fabric, shade: darker(fabric), drop: hem - HIP_ROW, below: regionColour(rider, 7, 16, hem + 1, Math.min(46, hem + 3)), hem: darker(fabric), pleats: false };
}

/** Two colours of the same garment (a main and its shade/highlight): close in hue and saturation. */
function sameHue(a: string, b: string): boolean {
  const p = (s: string) => (s.match(/\d+/g) ?? ["0", "0", "0"]).map(Number);
  const [r1, g1, b1] = p(a), [r2, g2, b2] = p(b);
  const n1 = r1 + g1 + b1 || 1, n2 = r2 + g2 + b2 || 1;
  return Math.abs(r1 / n1 - r2 / n2) < 0.06 && Math.abs(g1 / n1 - g2 / n2) < 0.06 && Math.abs(b1 / n1 - b2 / n2) < 0.06;
}

/** The skirt's fabric on a seated rider: a lap band along the thigh (hip → knee), then — for a knee-length or longer
 *  skirt — a curtain falling from the knee that flares toward its hem, and a short fall behind the seat. Outlined like
 *  the sprite, shaded at the back edge, pleat lines on a pleated skirt, the hem in the skirt's hem colour. */
function drape(c: Ctx, hip: Pt, knee: Pt, cover: Cover): void {
  const hx = Math.round(hip.x), hy = Math.round(hip.y), kx = Math.round(knee.x), ky = Math.round(knee.y);
  // short (A-line) skirt: the lap only; knee-length (pleated): a short fall over the knees; maxi/robe: a long drape
  const hang = cover.drop <= 1 ? 0 : cover.drop <= 3 ? 2 : Math.min(11, cover.drop - 3);
  const cells = new Map<string, "f" | "s" | "h">();
  const put = (x: number, y: number, k: "f" | "s" | "h") => cells.set(`${x},${y}`, k);
  // the lap: 4 rows thick, following the thigh line from behind the hip to just past the knee
  const x0 = hx - 3, x1 = kx + 1;
  for (let x = x0; x <= x1; x++) {
    const t = Math.min(1, Math.max(0, (x - hx) / Math.max(1, kx - hx)));
    const y = Math.round(hy + (ky - hy) * t);
    for (let yy = y - 2; yy <= y + 1; yy++) put(x, yy, cover.pleats && (x - x0) % 2 === 1 && yy > y - 2 ? "s" : "f");
    if (hang === 0) put(x, y + 1, "h");
  }
  // the fall from the knee: flaring, pleat lines (or one fold), the hem last
  for (let i = 1; i <= hang; i++) {
    const flare = Math.floor(i / 3);
    const l = kx - 2 - flare, r = kx + 2 + flare;
    for (let x = l; x <= r; x++) {
      const fold = cover.pleats ? (x - l) % 2 === 1 : x === l + 2 && r - l >= 4;
      put(x, ky + 1 + i, i === hang ? "h" : fold ? "s" : "f");
    }
    put(l, ky + 1 + i, i === hang ? "h" : "s");
  }
  // behind the seat: a short fall
  const back = Math.min(hang, 3);
  for (let i = 1; i <= back; i++) for (let x = hx - 4; x <= hx - 1; x++) put(x, hy + 1 + i, i === back ? "h" : x === hx - 4 ? "s" : "f");
  // outline pass (1 px all round), then the fabric
  for (const k of cells.keys()) { const [x, y] = k.split(",").map(Number); rect(c, x - 1, y - 1, 3, 3, OUTLINE); }
  const hemCol = cover.pleats ? cover.hem : cover.shade;
  for (const [k, v] of cells) { const [x, y] = k.split(",").map(Number); px(c, x, y, v === "f" ? cover.fabric : v === "s" ? cover.shade : hemCol); }
}

function drawBike(c: Ctx, x: number, g: number, t: number, rider: HTMLCanvasElement | null, pillion: Pillion | null = null): void {
  const spin = ((t / 1000) * ROAD_SPEED.bike) / 7;
  const bob = Math.floor(t / 220) % 2 === 0 ? 0 : -1;
  const frame = "#2f9e8f", frameHi = "#5cc7b5";
  shadow(c, x, g, 18);
  const rear = { x: x - 11, y: g - 7 }, front = { x: x + 12, y: g - 7 }, bb = { x: x - 1, y: g - 6 };
  wheel(c, rear.x, rear.y, 7, spin, "#1f1a22", "#9a98a8", "#d0ccd8");
  wheel(c, front.x, front.y, 7, spin + 0.5, "#1f1a22", "#9a98a8", "#d0ccd8");
  // fenders
  for (let k = -3; k <= 3; k++) {
    px(c, rear.x + k, rear.y - 8 + Math.abs(k) / 3, "#efe0bc");
    px(c, front.x + k, front.y - 8 + Math.abs(k) / 3, "#efe0bc");
  }
  // chain + frame
  line(c, bb.x, bb.y - 1, rear.x, rear.y - 1, "#56505e");
  line(c, bb.x, bb.y + 1, rear.x, rear.y + 1, "#56505e");
  line(c, bb.x, bb.y, x - 5, g - 16, frame);
  line(c, x - 5, g - 15, x + 8, g - 15, frameHi);
  line(c, bb.x, bb.y, x + 8, g - 15, frame);
  line(c, bb.x, bb.y, rear.x, rear.y, frame);
  line(c, x - 5, g - 15, rear.x, rear.y, frame);
  line(c, x + 8, g - 15, front.x, front.y, frame);
  // rear rack
  rect(c, x - 15, g - 16, 8, 1, "#8a8494");
  // saddle
  rect(c, x - 8, g - 18, 6, 2, "#3a2a22");
  // crank + pedals rotating
  const a = (t / 1000) * 7;
  const p1 = { x: bb.x + Math.cos(a) * 3, y: bb.y + Math.sin(a) * 3 };
  const p2 = { x: bb.x - Math.cos(a) * 3, y: bb.y - Math.sin(a) * 3 };
  // v18.13: a passenger side-saddle on the rear rack, legs dangling toward the viewer (behind the rider)
  if (pillion) sideSaddle(c, pillion.down, { x: x - 12, y: g - 17 + bob });
  // rider seated on the saddle, each foot on its pedal (the knee rises as the pedal comes up)
  if (rider) {
    const kneeY = g - 17 + Math.round((p1.y - bb.y) / 2);
    seatedRider(c, rider, { x: x - 5, y: g - 18 + bob }, { x: x + 2, y: kneeY }, [{ x: Math.round(p1.x), y: Math.round(p1.y) - 1 }, { x: Math.round(p2.x), y: Math.round(p2.y) - 1 }], { x: x + 7, y: g - 22 });
  }
  line(c, bb.x, bb.y, p1.x, p1.y, "#3a3440");
  line(c, bb.x, bb.y, p2.x, p2.y, "#3a3440");
  rect(c, p1.x - 1, p1.y, 3, 1, "#1f1a22");
  rect(c, p2.x - 1, p2.y, 3, 1, "#1f1a22");
  disc(c, bb.x, bb.y, 1, "#8a8494");
  // stem, bars, front basket with flowers
  line(c, x + 8, g - 15, x + 9, g - 20, frame);
  rect(c, x + 6, g - 21, 5, 1, "#2a2230");
  rect(c, x + 5, g - 21, 1, 2, "#6a4a34");
  rect(c, x + 11, g - 19, 7, 5, "#b8864a");
  for (let k = 0; k < 7; k += 2) px(c, x + 11 + k, g - 17, "#8a5e30");
  rect(c, x + 11, g - 19, 7, 1, "#d8a868");
  px(c, x + 12, g - 21, "#f07aa0"); px(c, x + 12, g - 20, "#4e8a3a");
  px(c, x + 15, g - 22, "#ffe07a"); px(c, x + 15, g - 21, "#4e8a3a"); px(c, x + 15, g - 20, "#4e8a3a");
  px(c, x + 17, g - 21, "#f07aa0");
  px(c, x + 17, g - 13, "#ffe8a0");
}

function drawMoto(c: Ctx, x: number, g: number, t: number, rider: HTMLCanvasElement | null, reduced: boolean, pillion: Pillion | null = null): void {
  // exhaust puffs and speed lines are drawn unshaken, behind
  if (!reduced) {
    for (let i = 0; i < 6; i++) {
      const age = ((t + i * 110) % 660) / 660;
      disc(c, x - 22 - age * 28, g - 6 - age * 9 + Math.sin(i * 2.1) * 1.5, 1 + age * 3.5, `rgba(206,200,214,${(0.75 * (1 - age)).toFixed(3)})`);
    }
    for (let i = 0; i < 6; i++) {
      const len = 10 + ((i * 7) % 12);
      const lx = x - 26 - ((t * 0.3 + i * 53) % 120);
      rect(c, lx, g - 36 + i * 6, len, 1, "rgba(255,240,222,0.55)");
    }
  }
  const sy = reduced ? 0 : Math.floor(t / 25) % 2;
  const gg = g - sy;
  shadow(c, x, g, 20);
  const spin = ((t / 1000) * ROAD_SPEED.moto) / 5;
  wheel(c, x - 11, g - 5, 5, spin, "#1c1820", "#b8b6c4", "#6a6674");
  wheel(c, x + 13, g - 5, 5, spin + 1, "#1c1820", "#b8b6c4", "#6a6674");
  const body = "#74c2b0", bodyHi = "#b2e6d6", bodySh = "#4f9a8a";
  // exhaust pipe
  rect(c, x - 20, gg - 6, 7, 2, "#8a8896");
  rect(c, x - 21, gg - 6, 1, 2, "#3a3440");
  // rear cowl (a rounded bulb over the rear wheel)
  for (let r = 0; r < 10; r++) {
    const f = (r - 5) / 5.5;
    const half = Math.round(Math.sqrt(Math.max(0, 1 - f * f)) * 8);
    rect(c, x - 11 - half, gg - 16 + r, half * 2 + 3, 1, r < 2 ? bodyHi : r > 7 ? bodySh : body);
  }
  px(c, x - 20, gg - 12, "#e0403a");
  px(c, x - 20, gg - 11, "#e0403a");
  // floorboard
  rect(c, x - 4, gg - 8, 14, 3, "#3a3440");
  rect(c, x - 4, gg - 8, 14, 1, bodySh);
  // leg shield (slanted) + front fender
  for (let yy = 0; yy < 17; yy++) rect(c, x + 8 + Math.round(yy * 0.25), gg - 23 + yy, 4, 1, yy < 2 ? bodyHi : body);
  for (let k = -4; k <= 4; k++) px(c, x + 13 + k, gg - 11 + Math.abs(k) / 2, body);
  rect(c, x + 10, gg - 11, 7, 1, bodyHi);
  // seat
  rect(c, x - 17, gg - 18, 12, 3, "#3a2a2a");
  rect(c, x - 16, gg - 18, 10, 1, "#5a4440");
  // v18.13: the pillion passenger behind the rider, feet on the rear pegs
  if (pillion) {
    rect(c, x - 19, gg - 9, 3, 1, "#3a3440");
    rect(c, x - 22, gg - 19, 8, 2, "#3a2a2a");
    seatedRider(c, pillion.right, { x: x - 20, y: gg - 20 }, { x: x - 12, y: gg - 19 }, [{ x: x - 17, y: gg - 10 }, { x: x - 15, y: gg - 10 }]);
  }
  // rider seated, both feet flat on the floorboard
  if (rider) seatedRider(c, rider, { x: x - 11, y: gg - 18 }, { x: x - 1, y: gg - 17 }, [{ x: x + 1, y: gg - 10 }, { x: x + 4, y: gg - 10 }], { x: x + 5, y: gg - 29 });
  // headset, handlebar, headlight + a short beam
  rect(c, x + 8, gg - 27, 7, 4, body);
  rect(c, x + 8, gg - 27, 7, 1, bodyHi);
  rect(c, x + 4, gg - 28, 6, 1, "#2a2230");
  disc(c, x + 15, gg - 25, 2, "#fff2b8");
  px(c, x + 15, gg - 26, "#ffffff");
  if (!reduced) for (let i = 0; i < 14; i++) rect(c, x + 18 + i, gg - 26 - i * 0.2, 1, 3 + i * 0.35, `rgba(255,236,170,${(0.3 * (1 - i / 14)).toFixed(3)})`);
  // mirrors
  line(c, x + 6, gg - 28, x + 5, gg - 31, "#8a8494");
  rect(c, x + 4, gg - 33, 3, 2, "#c8c4d0");
}

/** The car is drawn 1.5× the scale of the bike and scooter so the driver's head sits inside its window. */
const CAR_K = 1.5;
const S = (n: number) => Math.round(n * CAR_K);

function drawCar(c: Ctx, x: number, g: number, t: number, rider: HTMLCanvasElement | null, reduced: boolean, pillion: Pillion | null = null): void {
  if (!reduced) {
    // wind streaks flowing past, dust clouds from the rear wheel
    for (let i = 0; i < 8; i++) {
      const len = 18 + ((i * 11) % 22);
      const sx = x + 70 - ((t * 0.9 + i * 97) % 260);
      rect(c, sx, g - 70 + ((i * 13) % 60), len, 1, "rgba(255,244,228,0.5)");
    }
    for (let i = 0; i < 8; i++) {
      const age = ((t + i * 70) % 560) / 560;
      disc(c, x - S(32) - age * 44, g - 3 - age * 13 + Math.sin(i * 1.7) * 2, 2 + age * 6, `rgba(200,164,122,${(0.62 * (1 - age)).toFixed(3)})`);
    }
  }
  const bob = reduced ? 0 : Math.floor(t / 90) % 3 === 0 ? -1 : 0;
  const gg = g + bob;
  shadow(c, x, g, S(36));
  const red = "#d6504a", redHi = "#f28068", redSh = "#a33a38";
  // cabin (roof + pillars): rows from the roof (gg - top) down to the belt line
  const top = S(38), rows = S(15);
  const cabin: [number, number][] = [];
  for (let k = 0; k < rows; k++) {
    let l = x - S(21) - Math.round(k * 0.6), r = x + S(8) + Math.round(k * 0.9);
    if (k === 0) { l += 3; r -= 3; } else if (k === 1) { l += 1; r -= 1; }
    cabin.push([l, r]);
    rect(c, l, gg - top + k, r - l + 1, 1, k === 0 ? redHi : red);
  }
  // glass
  for (let k = 2; k < rows - 1; k++) {
    const [l, r] = cabin[k];
    rect(c, l + 3, gg - top + k, r - l - 5, 1, "#34466a");
  }
  // the driver behind the front glass: hat, face and the top of the shoulders, facing the windscreen, clear of the B-pillar
  const bPillar = x - S(7);
  if (rider) c.drawImage(rider, 0, 0, 24, rows - 2, bPillar + 3, gg - top + 2, 24, rows - 2);
  // v18.13: the passenger in the other seat, behind the rear glass
  if (pillion) c.drawImage(pillion.right, 0, 0, 24, rows - 2, bPillar - 22, gg - top + 2, 24, rows - 2);
  // pillars over the head, window reflections
  rect(c, bPillar, gg - top + 1, 3, rows - 1, red);
  for (let k = 2; k < rows - 1; k++) {
    const [l, r] = cabin[k];
    rect(c, r - 2, gg - top + k, 3, 1, red);
    rect(c, l, gg - top + k, 3, 1, red);
  }
  for (let k = 3; k < rows - 3; k++) px(c, cabin[k][1] - 4 - Math.round(k * 0.4), gg - top + k, "rgba(190,215,255,0.45)");
  for (let k = 4; k < rows - 4; k++) px(c, x - S(16) + k * 0.4, gg - top + k, "rgba(190,215,255,0.35)");
  // lower body with a rounded hood
  const bodyTop = gg - top + rows, bodyRows = S(16);
  for (let j = 0; j < bodyRows; j++) {
    let l = x - S(33), r = x + S(34) - (j < 6 ? (6 - j) * 3 : 0);
    if (j === 0) l += 4; else if (j === 1) l += 1;
    if (j === bodyRows - 1) { l += 1; r -= 1; }
    rect(c, l, bodyTop + j, r - l + 1, 1, j === 0 ? redHi : j > bodyRows - 6 ? redSh : red);
  }
  rect(c, x - S(33), bodyTop + S(7), S(67), 1, "#f4e6c8");
  line(c, x - S(4), bodyTop + 1, x - S(4), bodyTop + bodyRows - 4, redSh);
  rect(c, x - S(1), bodyTop + 4, 4, 1, "#f4e6c8");
  rect(c, x + S(8), bodyTop - 2, 3, 2, "#2a2230");
  // bumpers, lights
  rect(c, x + S(31), gg - S(10), 7, 4, "#c8c4d0");
  rect(c, x - S(35), gg - S(10), 6, 4, "#c8c4d0");
  rect(c, x + S(32), bodyTop + 4, 4, 4, "#fff2b0");
  rect(c, x - S(34), bodyTop + 2, 3, 6, "#ff4a3a");
  if (!reduced) for (let i = 0; i < 50; i++) rect(c, x + S(36) + i, bodyTop + 4 - i * 0.28, 1, 4 + i * 0.56, `rgba(255,238,170,${(0.32 * (1 - i / 50)).toFixed(3)})`);
  // wheel arches + rotating wheels (they don't bob)
  const wy = g - S(7), wr = S(7);
  disc(c, x - S(20), wy, wr + 2, "#1e1a24", 0.6);
  disc(c, x + S(21), wy, wr + 2, "#1e1a24", 0.6);
  const spin = ((t / 1000) * ROAD_SPEED.car) / wr;
  wheel(c, x - S(20), wy, wr, spin, "#1c1820", "#cfcbd6", "#5a5664");
  wheel(c, x + S(21), wy, wr, spin + 0.7, "#1c1820", "#cfcbd6", "#5a5664");
}
