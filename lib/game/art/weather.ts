// v18.8 weather on the map: an ambient light pass (dawn, day, dusk, night, overcast), the night lights of the scene
// (lamps, lanterns, windows, the moon on the water), and the weather's particles (sun motes, fireflies, cloud shadows,
// fog banks, rain with splashes and ripples, wind-blown leaves, lightning). Browser only for the glow sprites; the rest
// only calls fillRect / drawImage.
//
// Every particle is a pure function of (its index, t, the camera): nothing is stored or allocated per frame, and under
// reduced motion t is pinned to 0 so the pattern holds still.

import { RIVER, riverWater } from "@/lib/game/river/geometry";
import { CANAL, BRIDGES } from "../maps/field";
import { hallShoreY, HALL_H, HALL_W } from "../maps/hall";
import { MARKET_W } from "../maps/market";
import { inPond, onPlatform, POND_CX, POND_CY, POND_RX, POND_RY } from "../maps/pond";
import { ctx2d, makeCanvas, type LightHue, type SceneArt } from "../maps/scene-art";
import type { MapId } from "../maps/types";
import type { Vec } from "../types";
import type { RoomWeather, WeatherKind } from "../weather/model";

type Ctx = CanvasRenderingContext2D;

// ---------------------------------------------------------------- lighting

export interface Lighting {
  /** The overlay colour ("rgb(r, g, b)"). */
  tint: string;
  /** The overlay's alpha (0 = none). */
  alpha: number;
  /** 0 by day … 1 at night (ramps over dusk and dawn): how bright the night lights burn. */
  night: number;
  /** The night's darkening, multiplied under the tint ("rgb(r, g, b)"; white = none). */
  shade: string;
}

const MIN = 60_000;
const DAY = 86_400_000;
/** Dawn and dusk last ±45 min around sunrise and sunset. */
const TWILIGHT = 45 * MIN;
export const NIGHT_ALPHA = 0.45;
const NIGHT_RGB = [12, 24, 90] as const;
/** Multiplied over the scene at full night: darkens it and pulls out the reds so it reads deep blue, not grey-brown. */
const NIGHT_MUL = [78, 100, 176] as const;
const WARM_RGB = [255, 128, 44] as const;
const WARM_ALPHA = 0.2;
const GREY: Record<WeatherKind, { rgb: readonly [number, number, number]; a: number }> = {
  clear: { rgb: [0, 0, 0], a: 0 },
  cloudy: { rgb: [74, 82, 96], a: 0.15 },
  fog: { rgb: [168, 176, 184], a: 0.18 },
  rain: { rgb: [58, 68, 86], a: 0.22 },
  thunder: { rgb: [44, 50, 70], a: 0.27 },
  storm: { rgb: [38, 44, 60], a: 0.3 },
  snow: { rgb: [200, 214, 236], a: 0.2 },                   // v21 (0075): a pale, cold sky
};

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** The viewer's weather-effects level (a personal setting): 0 off … 4 full. Day/night light is not a weather effect. */
export type WeatherFx = 0 | 1 | 2 | 3 | 4;
/** The particles' density by level. */
export const FX_DENSITY: Readonly<Record<WeatherFx, number>> = { 0: 0, 1: 0.25, 2: 0.5, 3: 0.75, 4: 1 };

/** Local 06:00 / 18:00 of `nowMs`'s day, for a room with no sunrise and sunset. */
function fallbackSun(nowMs: number): { rise: number; set: number } {
  const d = new Date(nowMs);
  d.setHours(6, 0, 0, 0);
  const rise = d.getTime();
  d.setHours(18, 0, 0, 0);
  return { rise, set: d.getTime() };
}

/** The ambient light at `nowMs`: night blue (alpha 0.45 at full night), a warm orange around sunrise and sunset, and
 *  the grey of an overcast / rainy sky. Sunrise and sunset come from the weather row (any day: only the time of day
 *  counts), or 06:00 and 18:00 local. Pure (allocates one string; call it about once a second). */
export function lightingFor(nowMs: number, weather: RoomWeather | null, fx: WeatherFx = 4): Lighting {
  let rise = weather?.sunriseMs ?? null, set = weather?.sunsetMs ?? null;
  if (rise === null || set === null) ({ rise, set } = fallbackSun(nowMs));
  // times of day, measured from sunrise
  const len = mod(set - rise, DAY) || DAY / 2;
  const at = mod(nowMs - rise, DAY);
  const toSet = at - len; // < 0 before sunset
  const toRise = at < len + (DAY - len) / 2 ? at : at - DAY; // < 0 before sunrise (the night's second half)
  let night: number;
  if (Math.abs(toRise) < TWILIGHT) night = 0.5 - toRise / (2 * TWILIGHT);
  else if (Math.abs(toSet) < TWILIGHT) night = 0.5 + toSet / (2 * TWILIGHT);
  else night = at < len ? 0 : 1;
  night = Math.min(1, Math.max(0, night));
  const warm = Math.max(0, 1 - Math.min(Math.abs(toRise), Math.abs(toSet)) / TWILIGHT);
  const g = GREY[weather?.kind ?? "clear"];
  // the overcast grey fades as night falls (under the night blue it only muddies the colour)
  const layers: ReadonlyArray<readonly [readonly [number, number, number], number]> = [
    [NIGHT_RGB, NIGHT_ALPHA * night], [WARM_RGB, WARM_ALPHA * warm], [g.rgb, g.a * (1 - 0.7 * night) * (fx / 4)],
  ];
  let keep = 1, sum = 0, r = 0, gg = 0, b = 0;
  for (const [rgb, a] of layers) {
    keep *= 1 - a; sum += a;
    r += rgb[0] * a; gg += rgb[1] * a; b += rgb[2] * a;
  }
  const alpha = Math.round((1 - keep) * 1000) / 1000;
  const tint = sum > 0 ? `rgb(${Math.round(r / sum)}, ${Math.round(gg / sum)}, ${Math.round(b / sum)})` : "rgb(0, 0, 0)";
  const m = (k: number) => Math.round(255 + (NIGHT_MUL[k] - 255) * night);
  const shade = `rgb(${m(0)}, ${m(1)}, ${m(2)})`;
  return { tint, alpha, night, shade };
}

/** The ambient light over the view: the night's multiply, then the tint. The caller clips it to the map. */
export function drawLighting(c: Ctx, w: number, h: number, l: Lighting): void {
  if (l.night > 0) {
    const prev = c.globalCompositeOperation;
    c.globalCompositeOperation = "multiply";
    c.fillStyle = l.shade;
    c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = prev;
  }
  if (l.alpha <= 0) return;
  c.globalAlpha = l.alpha;
  c.fillStyle = l.tint;
  c.fillRect(0, 0, w, h);
  c.globalAlpha = 1;
}

// ---------------------------------------------------------------- night lights

const HUE_RGB: Record<LightHue, readonly [number, number, number]> = {
  warm: [255, 196, 108],
  lantern: [255, 118, 64],
  cool: [176, 206, 255],
};
const HUES: readonly LightHue[] = ["warm", "lantern", "cool"];
/** Glow sprites by radius and hue (painted once, drawn additively). */
const glows = new Map<number, HTMLCanvasElement>();

/** A pixel-art light pool: an ellipse (flattened for the top-down view) in four stepped rings, dithered at the steps. */
function glowSprite(r: number, hue: LightHue): HTMLCanvasElement {
  const key = r * 4 + HUES.indexOf(hue);
  const hit = glows.get(key);
  if (hit) return hit;
  const w = r * 2, h = Math.round(r * 1.5);
  const cv = makeCanvas(w, h);
  const g = ctx2d(cv);
  const [cr, cg, cb] = HUE_RGB[hue];
  const styles = [0.1, 0.2, 0.32, 0.46].map((a) => `rgba(${cr}, ${cg}, ${cb}, ${a})`);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot((x + 0.5 - r) / r, (y + 0.5 - h / 2) / (h / 2));
    if (d >= 1) continue;
    const f = (1 - d) * 4;
    let lv = Math.floor(f);
    if (f - lv > 0.6 && ((x + y) & 1) === 0) lv++; // dither the ring edge
    lv = Math.min(3, lv);
    g.fillStyle = styles[lv];
    g.fillRect(x, y, 1, 1);
  }
  glows.set(key, cv);
  return cv;
}

const WINDOW_LIT = "#ffd27a";
const WINDOW_HOT = "#fff0c0";
const MOON = "#e4ecff";
const MOON_DIM = "#9fb4dc";

/** The scene's lights after dusk: lit windows, additive light pools (a slow flicker unless reduced) and the moon's
 *  reflection on the water. `night` 0 draws nothing. */
export function drawNightLights(c: Ctx, art: SceneArt, camX: number, camY: number, w: number, h: number, night: number, t: number, reduced: boolean): void {
  // lit from mid-dusk on (at the first of dusk a pool of lamp light reads as a second sun)
  const on = Math.min(1, Math.max(0, (night - 0.3) / 0.5));
  if (on <= 0.02) return;
  if (art.windows) {
    for (const r of art.windows) {
      const x = r.x - camX, y = r.y - camY;
      if (x > w || y > h || x + r.w < 0 || y + r.h < 0) continue;
      c.globalAlpha = 0.85 * on;
      c.fillStyle = WINDOW_LIT;
      c.fillRect(x, y, r.w, r.h);
      c.fillStyle = WINDOW_HOT;
      c.fillRect(x + 1, y + 1, Math.max(1, r.w - 2), Math.max(1, Math.floor(r.h / 3)));
    }
    c.globalAlpha = 1;
  }
  if (art.lights) {
    const prev = c.globalCompositeOperation;
    c.globalCompositeOperation = "lighter";
    let i = 0;
    for (const l of art.lights) {
      i++;
      const x = Math.round(l.x - camX), y = Math.round(l.y - camY);
      if (x + l.r < 0 || x - l.r > w || y + l.r < 0 || y - l.r > h) continue;
      const sp = glowSprite(l.r, l.hue);
      const flicker = reduced ? 1 : 0.9 + 0.1 * Math.sin(t / 170 + i * 2.3) * Math.sin(t / 530 + i);
      c.globalAlpha = on * flicker;
      c.drawImage(sp, x - l.r, y - Math.round(sp.height / 2));
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = prev;
  }
  if (art.moon) {
    const { x: mx, y: my, w: mw } = art.moon;
    const x = mx - camX, y = my - camY;
    if (x + mw >= 0 && x - mw <= w && y + 12 >= 0 && y - 12 <= h) {
      const tt = reduced ? 0 : t;
      for (let k = 0; k < 7; k++) {
        const half = Math.max(1, Math.round(mw * (1 - Math.abs(k - 3) / 4) * (0.75 + 0.25 * Math.sin(tt / 420 + k * 1.9))));
        const dx = Math.round(Math.sin(tt / 650 + k) * 2);
        c.globalAlpha = on * (k === 3 ? 0.8 : 0.55);
        c.fillStyle = k % 2 ? MOON_DIM : MOON;
        c.fillRect(Math.round(x - half + dx), Math.round(y - 9 + k * 3), half * 2, 1);
      }
      c.globalAlpha = 1;
    }
  }
}

// ---------------------------------------------------------------- particles

/** A cheap hash of n into [0, 1). Pure, no allocation. */
function hash(n: number): number {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** The water of a map at (u, v) in [0, 1)² → a world point on the water, or null (the caller skips it). */
function waterPoint(map: MapId, u: number, v: number, out: Vec): boolean {
  switch (map) {
    case "pond": {
      const x = POND_CX - POND_RX + u * POND_RX * 2, y = POND_CY - POND_RY + v * POND_RY * 2;
      if (!inPond(x, y, -6) || onPlatform(x, y)) return false;
      out.x = x; out.y = y; return true;
    }
    case "hall": {
      const x = u * HALL_W, top = hallShoreY(x) + 5;
      out.x = x; out.y = top + v * (HALL_H - top); return true;
    }
    case "field": {
      const x = CANAL.x + u * CANAL.w, y = CANAL.y + 4 + v * (CANAL.h - 8);
      for (const b of BRIDGES) if (x >= b.x - 3 && x < b.x + b.w + 3) return false;
      out.x = x; out.y = y; return true;
    }
    case "market":
    case "khu_nha":                              // v19.2: the same canal along the south (Khu nhà is 800 wide)
      out.x = u * (map === "market" ? MARKET_W : 800); out.y = 395 + v * 4; return true;
    case "bai_dat":                              // v20.3: the canal runs along the north (the bridge from Chợ Lớn)
      out.x = u * 800; out.y = 3 + v * 16; return true;
    case "ham_ngam":                             // v20.4: indoors — no water, no weather
    case "mo_da":                                // v21 #19: a cave
    case "rung_tram":                            // 0097: the forest floor (no open water drawn)
      return false;
    case "song_cai": {                           // v22 (0086): the river
      const x = RIVER.x0 + u * (RIVER.x1 - RIVER.x0), y = RIVER.y0 + v * (RIVER.y1 - RIVER.y0);
      if (!riverWater(x, y)) return false;
      out.x = x; out.y = y; return true;
    }
  }
}

const RAIN_NEAR = "rgba(214, 228, 244, 0.75)";
const RAIN_FAR = "rgba(176, 196, 222, 0.45)";
const SPLASH = "#dfeaf6";
const RIPPLE = "#b6dcee";
const LEAF = ["#5caa4a", "#86c95c", "#3d8a3a", "#c9a23c"] as const;
const SHADOW = "rgb(22, 32, 46)";
const FOG = "#eef2f4";
const MOTE = "#fff3c4";
const FIREFLY = "#e4ff8a";
const FLASH = "#ffffff";
const BOLT_GLOW = "#b9ccff";
const DIM = "rgb(40, 44, 58)";
const SNOW = "#f6faff";
const SNOW_FAR = "#cfdcf0";

/** A scratch point for the water sampler (module scope: no per-frame allocation). */
const pt: Vec = { x: 0, y: 0 };

/** Lightning: one strike per 10.5 s slot, 5.5–10 s into it, so strikes fall 6–15 s apart. -1 before the first. */
const SLOT = 10_500;
function lastStrike(t: number): { at: number; slot: number } {
  let slot = Math.floor(t / SLOT);
  let at = slot * SLOT + 5500 + hash(slot * 7.13) * 4500;
  if (t < at) { slot--; at = slot < 0 ? -1e9 : slot * SLOT + 5500 + hash(slot * 7.13) * 4500; }
  strike.at = at; strike.slot = slot;
  return strike;
}
const strike = { at: 0, slot: 0 };

/** A soft blob (a cloud's shadow or a fog bank): an ellipse in 2 px rows with a wobbly edge, in two stepped layers. */
function blob(c: Ctx, cx: number, cy: number, rx: number, ry: number, seed: number, col: string, alpha: number): void {
  c.fillStyle = col;
  for (let layer = 0; layer < 2; layer++) {
    const s = layer === 0 ? 1 : 0.68;
    const rX = rx * s, rY = ry * s;
    c.globalAlpha = alpha;
    for (let dy = -rY; dy < rY; dy += 2) {
      const f = 1 - (dy / rY) * (dy / rY);
      if (f <= 0) continue;
      const half = rX * Math.sqrt(f) + Math.sin(dy * 0.45 + seed) * 4 * s;
      if (half < 2) continue;
      const off = Math.sin(dy * 0.21 + seed * 3) * 3;
      c.fillRect(Math.round(cx - half + off), Math.round(cy + dy), Math.round(half * 2), 2);
    }
  }
  c.globalAlpha = 1;
}

function rainCount(kind: WeatherKind, rainMm: number): number {
  if (kind === "storm") return 380;
  if (kind === "thunder") return 260;
  return Math.max(70, Math.min(300, Math.round(80 + rainMm * 45)));
}

/** The weather's particles over the view (w×h screen px, the camera `cam` in world px), then the lightning. Particles
 *  drift with parallax against the camera. Under reduced motion the pattern is frozen (t = 0), lightning becomes a
 *  1 s grey tint and nothing flashes. `night` (0…1) swaps the sun motes for fireflies. */
export function drawWeather(c: Ctx, w: number, h: number, cam: Vec, t: number, weather: RoomWeather | null, map: MapId, reduced: boolean, night = 0, fx: WeatherFx = 4): void {
  if (!weather || fx === 0) return;
  const dens = FX_DENSITY[fx];
  const cnt = (n: number) => Math.round(n * dens);
  const kind = weather.kind;
  const tt = reduced ? 0 : t;

  // cloud shadows: a few faint ones on a clear day, big slow ones when cloudy
  if (kind === "clear" || kind === "cloudy") {
    const n = cnt(kind === "clear" ? 2 : 5);
    const a = kind === "clear" ? 0.07 : 0.1;
    for (let k = 0; k < n; k++) {
      const rx = (kind === "clear" ? 60 : 90) + hash(k * 3.7) * 60, ry = rx * 0.45;
      const span = w + rx * 2 + 200;
      const cx = mod(hash(k * 1.3) * span + tt * (0.006 + hash(k * 9.1) * 0.004) - cam.x * 0.9, span) - rx - 100;
      const cy = mod(hash(k * 5.9) * (h + ry * 2) - cam.y * 0.9, h + ry * 2) - ry;
      blob(c, cx, cy, rx, ry, k * 2.1, SHADOW, a);
    }
  }

  // sun motes by day, fireflies at night (clear or cloudy)
  if (kind === "clear" || (kind === "cloudy" && night > 0.5)) {
    const n = cnt(night > 0.5 ? 26 : 22);
    c.fillStyle = night > 0.5 ? FIREFLY : MOTE;
    for (let k = 0; k < n; k++) {
      const x = mod(hash(k * 2.3) * w + Math.sin(tt / 1900 + k) * 14 + tt * 0.004 - cam.x * 0.4, w);
      const y = mod(hash(k * 4.1) * h - tt * 0.006 + Math.cos(tt / 1500 + k * 1.7) * 8 - cam.y * 0.4, h);
      const tw = reduced ? 0.6 : 0.5 + 0.5 * Math.sin(tt / (night > 0.5 ? 240 : 600) + k * 2.9);
      if (tw < 0.15) continue;
      c.globalAlpha = tw * (night > 0.5 ? 0.95 : 0.55);
      c.fillRect(Math.round(x), Math.round(y), 1, 1);
      if (tw > 0.8) { c.globalAlpha *= 0.4; c.fillRect(Math.round(x) - 1, Math.round(y), 3, 1); c.fillRect(Math.round(x), Math.round(y) - 1, 1, 3); }
    }
    c.globalAlpha = 1;
  }

  // fog: three banks of translucent white at three depths, plus a thin veil
  if (kind === "fog") {
    // dimmer at night (white banks glare on a dark map)
    const fa = (1 - 0.55 * night) * dens;
    c.globalAlpha = 0.1 * fa;
    c.fillStyle = FOG;
    c.fillRect(0, 0, w, h);
    const banks = Math.max(1, cnt(4));
    for (let layer = 0; layer < 3; layer++) {
      const par = 0.3 + layer * 0.35, speed = 0.004 + layer * 0.004;
      for (let k = 0; k < banks; k++) {
        const id = layer * 10 + k;
        const rx = 90 + hash(id * 1.9) * 60, ry = 12 + hash(id * 3.3) * 10;
        const span = w + rx * 2 + 120;
        const cx = mod(hash(id * 7.7) * span + tt * speed - cam.x * par, span) - rx - 60;
        const cy = mod(hash(id * 5.1) * (h + 40) + layer * 30 - cam.y * par, h + 40) - 20;
        blob(c, cx, cy, rx, ry, id, FOG, (0.1 + layer * 0.04) * (1 - 0.55 * night));
      }
    }
  }

  const wet = kind === "rain" || kind === "thunder" || kind === "storm";
  if (wet) {
    const heavy = kind === "storm";
    const n = cnt(rainCount(kind, weather.rainMm));
    const slant = heavy ? 0.7 : kind === "thunder" ? 0.4 : 0.25;
    // ripples on the water (world-anchored)
    const nr = cnt(heavy ? 34 : kind === "thunder" ? 26 : 18);
    c.fillStyle = RIPPLE;
    for (let k = 0; k < nr; k++) {
      const off = hash(k * 1.1) * 900;
      const cyc = Math.floor((tt + off) / 900), p = reduced ? 0.35 : ((tt + off) % 900) / 900;
      if (!waterPoint(map, hash(k * 3.3 + cyc * 17.1), hash(k * 5.7 + cyc * 11.3), pt)) continue;
      const x = Math.round(pt.x - cam.x), y = Math.round(pt.y - cam.y);
      if (x < -8 || y < -4 || x > w + 8 || y > h + 4) continue;
      const r = 1 + Math.round(p * 5), ry = Math.max(1, Math.round(r / 2));
      c.globalAlpha = 0.85 * (1 - p);
      c.fillRect(x - r + 1, y - ry, 2 * r - 2, 1);
      c.fillRect(x - r + 1, y + ry, 2 * r - 2, 1);
      c.fillRect(x - r, y - ry + 1, 1, 2 * ry - 1);
      c.fillRect(x + r - 1, y - ry + 1, 1, 2 * ry - 1);
    }
    // splashes on the ground (screen-anchored, re-seeded every cycle)
    if (!reduced) {
      c.fillStyle = SPLASH;
      const ns = Math.round(n / 5);
      for (let k = 0; k < ns; k++) {
        const off = hash(k * 2.7) * 380;
        const cyc = Math.floor((t + off) / 380), p = ((t + off) % 380) / 380;
        const x = Math.round(hash(k * 6.1 + cyc * 3.9) * w), y = Math.round(hash(k * 8.3 + cyc * 2.1) * h);
        if (p < 0.3) { c.globalAlpha = 0.8; c.fillRect(x, y, 1, 1); }
        else if (p < 0.65) { c.globalAlpha = 0.6; c.fillRect(x - 2, y - 1, 1, 1); c.fillRect(x + 2, y - 1, 1, 1); c.fillRect(x, y - 2, 1, 1); }
      }
    }
    // streaks: far ones short and dim, near ones longer and brighter
    for (let k = 0; k < n; k++) {
      const near = hash(k * 0.77) > 0.6;
      const par = near ? 1.2 : 0.6;
      const speed = (near ? 0.34 : 0.24) * (heavy ? 1.35 : 1);
      const fall = tt * speed;
      const x = Math.round(mod(hash(k * 3.1) * (w + 60) - fall * slant - cam.x * par, w + 60) - 30);
      const y = Math.round(mod(hash(k * 5.3) * (h + 20) + fall - cam.y * par, h + 20) - 10);
      c.fillStyle = near ? RAIN_NEAR : RAIN_FAR;
      const seg = near ? (heavy ? 3 : 2) : 2;
      const dx = slant >= 0.5 ? 2 : 1;
      c.fillRect(x, y, 1, seg);
      c.fillRect(x - (slant >= 0.25 ? 1 : 0), y + seg, 1, seg);
      if (near && heavy) c.fillRect(x - dx, y + seg * 2, 1, seg);
    }
    // storm: leaves torn off and blown across
    if (heavy) {
      for (let k = 0, nl = cnt(22); k < nl; k++) {
        const sp = 0.16 + hash(k * 4.4) * 0.14;
        const x = Math.round(mod(hash(k * 1.7) * (w + 40) - tt * sp - cam.x * 1.1, w + 40) - 20);
        const y = Math.round(mod(hash(k * 2.9) * h + Math.sin(tt / 260 + k * 1.3) * 10 + tt * 0.02 - cam.y * 1.1, h));
        c.fillStyle = LEAF[k % LEAF.length];
        if (Math.floor(tt / 120 + k) % 2 === 0) c.fillRect(x, y, 2, 1);
        else c.fillRect(x, y, 1, 2);
      }
    }
  }

  // v21 (0075) snow: flakes at three depths drifting down with a sway, and a thin white veil (a 2×2 flake up close)
  if (kind === "snow") {
    c.globalAlpha = 0.08 * dens;
    c.fillStyle = SNOW;
    c.fillRect(0, 0, w, h);
    const n = cnt(220);
    for (let k = 0; k < n; k++) {
      const depth = k % 3;                                    // 0 far … 2 near
      const par = 0.4 + depth * 0.35, speed = 0.018 + depth * 0.012;
      const sway = Math.sin(tt / (900 + depth * 300) + k * 1.7) * (4 + depth * 3);
      const x = Math.round(mod(hash(k * 3.7) * (w + 20) + sway - cam.x * par, w + 20) - 10);
      const y = Math.round(mod(hash(k * 6.1) * (h + 10) + tt * speed - cam.y * par, h + 10) - 5);
      c.globalAlpha = depth === 0 ? 0.55 : depth === 1 ? 0.75 : 0.95;
      c.fillStyle = depth === 0 ? SNOW_FAR : SNOW;
      if (depth === 2) c.fillRect(x, y, 2, 2);
      else c.fillRect(x, y, 1, 1);
    }
    c.globalAlpha = 1;
  }

  // lightning (thunder and storm)
  if (kind === "thunder" || kind === "storm") {
    const s = lastStrike(t);
    const dt = t - s.at;
    // full-screen light only at levels 3 (dimmed) and 4; levels 1-2 keep just the bolt
    const flashK = fx === 4 ? 1 : fx === 3 ? 0.4 : 0;
    if (reduced) {
      if (flashK > 0 && dt >= 0 && dt < 1000) {
        c.globalAlpha = 0.22 * flashK;
        c.fillStyle = DIM;
        c.fillRect(0, 0, w, h);
        c.globalAlpha = 1;
      }
    } else if (dt >= 0 && dt < 320) {
      if (dt < 120) drawBolt(c, w, h, s.slot);
      const a = (dt < 150 ? 0.7 * (1 - dt / 150) : dt > 200 && dt < 260 ? 0.3 : 0) * flashK;
      if (a > 0) {
        c.globalAlpha = a;
        c.fillStyle = FLASH;
        c.fillRect(0, 0, w, h);
        c.globalAlpha = 1;
      }
    }
  }
}

/** A jagged bolt in the sky area (the top ~45% of the view), shaped by the strike's slot. */
function drawBolt(c: Ctx, w: number, h: number, slot: number): void {
  let x = Math.round(w * (0.15 + hash(slot * 2.17) * 0.7)), y = -2;
  const bottom = h * (0.3 + hash(slot * 3.9) * 0.15);
  for (let i = 0; y < bottom && i < 16; i++) {
    const len = 6 + Math.round(hash(slot * 13 + i) * 8);
    const nx = x + Math.round((hash(slot * 17 + i * 3) - 0.5) * 14);
    for (let k = 0; k < len; k++) {
      const px = Math.round(x + ((nx - x) * k) / len), py = y + k;
      c.globalAlpha = 0.6;
      c.fillStyle = BOLT_GLOW;
      c.fillRect(px - 1, py, 3, 1);
      c.globalAlpha = 1;
      c.fillStyle = FLASH;
      c.fillRect(px, py, 1, 1);
      // a short fork off every fourth segment
      if (i % 4 === 2 && k < 5) c.fillRect(px + k, py + k, 1, 1);
    }
    x = nx; y += len;
  }
  c.globalAlpha = 1;
}

/** How far the trees and palms lean in the wind (px at the crown; 0 = still). */
export function swayAmp(weather: RoomWeather | null, reduced: boolean, fx: WeatherFx = 4): number {
  if (!weather || reduced || fx < 2) return 0;
  if (weather.kind === "storm") return 3;
  if (weather.kind === "thunder") return 2;
  if (weather.kind === "rain" && weather.windKmh >= 25) return 1;
  return 0;
}

/** The crown's offset for a swaying prop `i` at t (gusts: a slow lean plus a faster shiver). */
export function swayAt(amp: number, t: number, i: number): number {
  if (amp === 0) return 0;
  return Math.round(amp * (0.55 + 0.45 * Math.sin(t / 900 + i * 1.7)) * Math.sin(t / 260 + i * 2.3));
}
