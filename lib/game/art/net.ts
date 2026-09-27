// v18.2 Quăng lưới, drawn in pixels: the cast net flying out and spreading into a circle on the water, then the pulled
// bundle with fish flapping in it. Only fillRect is used, so any 2D context (or a test double) can draw it. Original art.

export interface PixelCtx { fillStyle: string | CanvasGradient | CanvasPattern; fillRect: (x: number, y: number, w: number, h: number) => void }

const MESH = "#e8e0c8";
const MESH_DARK = "#b9ae98";
const LEAD = "#6a7078";
const ROPE = "#c89a5c";
const RIPPLE = "#a6d6e8";
const SPLASH = "#e8f4f8";
const FISH = ["#c9ccd6", "#e0a431", "#9aa0a6", "#b8c8d4"] as const;
const FISH_DARK = "#5e666e";
const OUTLINE = "#2b2118";

function px(c: PixelCtx, col: string, x: number, y: number): void {
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), 1, 1);
}

/** An ellipse of 1-px dots, radius r across and r·0.5 deep. */
function ellipse(c: PixelCtx, col: string, cx: number, cy: number, r: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    px(c, col, cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.5);
  }
}

/**
 * The throw, `k` from 0 (leaving the hands at `from`) to 1 (spread flat on the water at (cx, cy)). Until k 0.4 a folded
 * bundle flies on an arc; then the mesh opens: 12 spokes, three rings, the lead weights on the rim and a ripple.
 */
export function drawNetSpread(c: PixelCtx, from: { x: number; y: number }, cx: number, cy: number, radius: number, k: number): void {
  const t = Math.min(1, Math.max(0, k));
  if (t < 0.4) {
    const u = t / 0.4;
    const x = from.x + (cx - from.x) * u, y = from.y + (cy - from.y) * u - Math.sin(u * Math.PI) * radius * 0.8;
    for (let i = 0; i < 6; i++) px(c, ROPE, from.x + (x - from.x) * (i / 6), from.y + (y - from.y) * (i / 6));
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2 + Math.abs(dy); dx <= 2 - Math.abs(dy); dx++) {
      px(c, (dx + dy) % 2 === 0 ? MESH : MESH_DARK, x + dx, y + dy);
    }
    px(c, LEAD, x - 1, y + 3);
    px(c, LEAD, x + 1, y + 3);
    return;
  }
  const open = (t - 0.4) / 0.6;
  const r = Math.max(3, radius * (0.25 + 0.75 * Math.sin((open * Math.PI) / 2)));
  // the rope back to the hands
  for (let i = 0; i < 10; i++) px(c, ROPE, from.x + (cx - from.x) * (i / 10), from.y + (cy - from.y) * (i / 10));
  if (open > 0.6) ellipse(c, RIPPLE, cx, cy, r + 3 + (open - 0.6) * 6, Math.round(r * 3));
  for (let s = 0; s < 12; s++) {
    const a = (s / 12) * Math.PI * 2;
    const steps = Math.ceil(r);
    for (let i = 1; i <= steps; i++) px(c, s % 2 ? MESH_DARK : MESH, cx + Math.cos(a) * r * (i / steps), cy + Math.sin(a) * r * 0.5 * (i / steps));
  }
  for (const f of [1 / 3, 2 / 3]) ellipse(c, MESH_DARK, cx, cy, r * f, Math.round(r * 2 * f) + 8);
  ellipse(c, MESH, cx, cy, r, Math.round(r * 2.4) + 8);
  for (let s = 0; s < 12; s++) {
    const a = (s / 12) * Math.PI * 2 + Math.PI / 12;
    px(c, LEAD, cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.5 + 1);
  }
  if (open < 0.3) for (let i = 0; i < 6; i++) px(c, SPLASH, cx + Math.cos(i) * r * 1.1, cy - 2 - (i % 3));
}

// ---------- the minigame's scene (SCENE pixels of lib/game/fishing/net.ts) ----------

export type NetPhase = "aim" | "charge" | "flight" | "sink" | "arrows" | "pull";

export interface NetScene {
  phase: NetPhase;
  /** ms, for the swim and the ripples. */
  t: number;
  shadows: ReadonlyArray<{ x: number; y: number; dir: 1 | -1; size: number }>;
  aim: { x: number; y: number };
  /** The power bar (0 … 1) while charging; the release's power afterwards. */
  power: number;
  /** The ring's radius now (charge: at this power; after: where it landed). */
  r: number;
  /** Where the net lands (flight onwards). */
  landing: { x: number; y: number };
  /** Flight 0 → 1. */
  k: number;
  /** The shadows the net covers (sink / arrows / pull). */
  caught: readonly boolean[];
  /** The power bar's green zone starts here. */
  sweet: number;
  w: number;
  h: number;
  shore: number;
  hands: { x: number; y: number };
  squash: number;
}

const WATER = "#2f6e8f";
const WATER_LIGHT = "#3d82a6";
const WATER_DEEP = "#285f7c";
const BANK = "#7a9a3a";
const BANK_DARK = "#5f7d2c";
const MUD = "#8b6a3e";
const SHADOW = "rgba(8, 20, 32, 0.7)";
const CAUGHT = "#ffd166";
const AIM = "#f4f1ea";
const SWEET = "#4caf50";
const BAR_BG = "#2b2118";
const BAR = "#e0a431";
const SHIRT = "#c0392b";
const HAIR = "#2b2118";
const SKIN = "#e0ac7e";

function ringDots(c: PixelCtx, col: string, cx: number, cy: number, r: number, squash: number, dashed: boolean): void {
  const n = Math.max(12, Math.round(r * 5));
  for (let i = 0; i < n; i++) {
    if (dashed && i % 3 === 2) continue;
    const a = (i / n) * Math.PI * 2;
    px(c, col, cx + Math.cos(a) * r, cy + Math.sin(a) * r * squash);
  }
}

function shadowBlob(c: PixelCtx, col: string, s: { x: number; y: number; dir: 1 | -1; size: number }, t: number): void {
  const len = 4 + s.size * 2;
  for (let i = -len; i <= len; i++) {
    const hgt = Math.round(Math.sqrt(Math.max(0, 1 - (i / (len + 1)) ** 2)) * (1 + s.size * 0.5));
    for (let j = -hgt; j <= hgt; j++) px(c, col, s.x + i, s.y + j);
  }
  const wag = Math.sin(t / 120 + s.x) > 0 ? 1 : 0;
  px(c, col, s.x - s.dir * (len + 1), s.y - 1 + wag);
  px(c, col, s.x - s.dir * (len + 2), s.y - 1 + wag);
  px(c, col, s.x - s.dir * (len + 1), s.y + 1 + wag);
  px(c, col, s.x - s.dir * (len + 2), s.y + 1 + wag);
}

/** The player from behind: hair, shirt and arms up holding the net's rope. */
function player(c: PixelCtx, hands: { x: number; y: number }, raised: boolean): void {
  const x = Math.round(hands.x), y = Math.round(hands.y);
  for (let j = 0; j < 5; j++) for (let i = -3; i <= 3; i++) px(c, HAIR, x + i, y + 2 + j - (j === 0 && Math.abs(i) === 3 ? -1 : 0));
  for (let j = 0; j < 8; j++) for (let i = -5; i <= 5; i++) px(c, SHIRT, x + i, y + 7 + j);
  for (let j = 0; j < (raised ? 6 : 4); j++) {
    px(c, SKIN, x - 6, y + (raised ? 2 : 8) + j);
    px(c, SKIN, x + 6, y + (raised ? 2 : 8) + j);
  }
}

/** The whole minigame picture for one frame. */
export function drawNetScene(c: PixelCtx, s: NetScene): void {
  // water in bands with a slow shimmer, then the bank
  for (let y = 0; y < s.shore; y++) {
    const col = y < s.shore * 0.35 ? WATER_DEEP : WATER;
    c.fillStyle = col;
    c.fillRect(0, y, s.w, 1);
    const off = Math.round((s.t / 60 + y * 7) % 24);
    if (y % 6 === 3) for (let x = off; x < s.w; x += 24) px(c, WATER_LIGHT, x, y);
  }
  c.fillStyle = MUD;
  c.fillRect(0, s.shore, s.w, 2);
  c.fillStyle = BANK;
  c.fillRect(0, s.shore + 2, s.w, s.h - s.shore - 2);
  for (let x = 3; x < s.w; x += 9) px(c, BANK_DARK, x, s.shore + 5 + (x % 4));

  s.shadows.forEach((sh, i) => {
    if ((s.phase === "arrows" || s.phase === "pull") && s.caught[i]) return;   // in the bundle now
    shadowBlob(c, SHADOW, sh, s.t);
  });

  if (s.phase === "aim" || s.phase === "charge") {
    const col = s.phase === "charge" && s.power >= s.sweet ? SWEET : AIM;
    ringDots(c, col, s.aim.x, s.aim.y, s.r, s.squash, s.phase === "aim");
    px(c, col, s.aim.x, s.aim.y);
    // the power bar next to the character, its green zone at the top
    const bx = s.hands.x + 10, top = s.hands.y - 4, hgt = 18;
    c.fillStyle = BAR_BG;
    c.fillRect(bx - 1, top - 1, 5, hgt + 2);
    c.fillStyle = SWEET;
    c.fillRect(bx, top, 3, Math.round(hgt * (1 - s.sweet)));
    const fill = Math.round(hgt * (s.phase === "charge" ? s.power : 0));
    c.fillStyle = s.power >= s.sweet ? "#8be08b" : BAR;
    c.fillRect(bx, top + hgt - fill, 3, fill);
  }
  if (s.phase === "flight") drawNetSpread(c, s.hands, s.landing.x, s.landing.y, s.r, s.k);
  if (s.phase === "sink") {
    drawNetSpread(c, s.hands, s.landing.x, s.landing.y, s.r, 1);
    ringDots(c, WATER_LIGHT, s.landing.x, s.landing.y, s.r + 2 + ((s.t / 200) % 4), s.squash, true);
    s.shadows.forEach((sh, i) => {                                 // the caught ones, over the mesh
      if (s.caught[i]) ringDots(c, CAUGHT, sh.x, sh.y, 6 + sh.size, 0.6, false);
    });
  }
  if (s.phase === "arrows") {
    // the bundle closed at the landing spot, the fish struggling, the rope taut to the hands
    const n = s.caught.filter(Boolean).length;
    const shake = Math.sin(s.t / 60) > 0 ? 1 : 0;
    for (let i = 0; i < 12; i++) px(c, ROPE, s.hands.x + (s.landing.x - s.hands.x) * (i / 12), s.hands.y + (s.landing.y - s.hands.y) * (i / 12));
    drawNetBundle(c, s.landing.x + shake, s.landing.y - 24, n, s.t);
    ringDots(c, SPLASH, s.landing.x, s.landing.y, 8 + ((s.t / 90) % 3), s.squash, true);
  }  if (s.phase === "pull") {
    const n = s.caught.filter(Boolean).length;
    const u = Math.min(1, s.k);
    drawNetBundle(c, s.landing.x + (s.hands.x - s.landing.x) * u, s.landing.y - 20 + (s.hands.y - 30 - s.landing.y) * u, n, s.t);
  }
  player(c, s.hands, s.phase === "charge" || s.phase === "flight" || s.phase === "arrows");
}

// ---------- kéo lưới: the arrow keys (9 × 9 each) ----------

const ARROW_ROWS: Record<"up" | "down" | "left" | "right", readonly string[]> = {
  up: ["....x....", "...xxx...", "..xxxxx..", ".xxxxxxx.", "xxxxxxxxx", "...xxx...", "...xxx...", "...xxx...", "...xxx..."],
  down: ["...xxx...", "...xxx...", "...xxx...", "...xxx...", "xxxxxxxxx", ".xxxxxxx.", "..xxxxx..", "...xxx...", "....x...."],
  left: ["....x....", "...xx....", "..xxx....", ".xxxxxxxx", "xxxxxxxxx", ".xxxxxxxx", "..xxx....", "...xx....", "....x...."],
  right: ["....x....", "....xx...", "....xxx..", "xxxxxxxx.", "xxxxxxxxx", "xxxxxxxx.", "....xxx..", "....xx...", "....x...."],
};
export type ArrowState = "done" | "current" | "wrong" | "todo";
const ARROW_COL: Record<ArrowState, { fill: string; box: string }> = {
  done: { fill: "#4caf50", box: "#1f4f22" },
  current: { fill: "#ffd166", box: "#2b2118" },
  wrong: { fill: "#e5533d", box: "#5a1a12" },
  todo: { fill: "#e8e0c8", box: "#2b2118" },
};

/** One arrow key cap at (x, y), 11 × 11 with its frame. */
export function drawArrowKey(c: PixelCtx, x: number, y: number, a: "up" | "down" | "left" | "right", st: ArrowState): void {
  const col = ARROW_COL[st];
  c.fillStyle = col.box;
  c.fillRect(x, y, 11, 11);
  ARROW_ROWS[a].forEach((row, j) => [...row].forEach((ch, i) => { if (ch === "x") px(c, col.fill, x + 1 + i, y + 1 + j); }));
}

/** A round's row of keys: typed ones green, the current one yellow (red after a wrong key), the rest pale. */
export function drawArrowRow(c: PixelCtx, x: number, y: number, seq: readonly ("up" | "down" | "left" | "right")[], at: number,
  wrong: boolean): void {
  seq.forEach((a, i) => drawArrowKey(c, x + i * 13, y, a, i < at ? "done" : i === at ? (wrong ? "wrong" : "current") : "todo"));
}
/** One small fish (7 × 3) bending with `flap` (−1 … 1). */
function fish(c: PixelCtx, col: string, x: number, y: number, flap: number, left: boolean): void {
  const d = left ? -1 : 1;
  const tail = Math.round(flap);
  for (let i = 0; i < 5; i++) px(c, col, x + d * i, y);
  px(c, col, x + d, y - 1);
  px(c, col, x + d * 2, y - 1);
  px(c, FISH_DARK, x + d, y + 1);
  px(c, FISH_DARK, x + d * 2, y + 1);
  px(c, OUTLINE, x + d * 4, y);
  px(c, col, x - d, y + tail - 1);
  px(c, col, x - d * 2, y + tail);
}

/**
 * The pulled bundle hanging at (cx, top): a teardrop of mesh with `count` fish flapping inside (`t` in ms drives the
 * flapping), water dripping from its bottom.
 */
export function drawNetBundle(c: PixelCtx, cx: number, top: number, count: number, t: number): void {
  const h = 22, w = 9;
  for (let y = 0; y <= 4; y++) px(c, ROPE, cx, top + y);
  for (let y = 0; y <= h; y++) {
    const half = Math.round(w * Math.sin((Math.min(y, h) / h) * Math.PI * 0.9 + 0.1));
    for (let x = -half; x <= half; x++) {
      const edge = Math.abs(x) === half;
      if (edge || (x + y) % 3 === 0) px(c, edge ? MESH : (x + y) % 2 ? MESH_DARK : MESH, cx + x, top + 5 + y);
    }
  }
  const n = Math.max(0, Math.min(5, count));
  const slots = [[-3, 10], [3, 13], [-2, 17], [4, 19], [0, 21]] as const;
  for (let i = 0; i < n; i++) {
    const flap = Math.sin(t / 90 + i * 1.7);
    fish(c, FISH[i % FISH.length], cx + slots[i][0] + (flap > 0.6 ? 1 : 0), top + slots[i][1], flap, i % 2 === 0);
  }
  for (let i = 0; i < 3; i++) {
    const drip = (t / 12 + i * 7) % 12;
    px(c, RIPPLE, cx - 2 + i * 2, top + h + 7 + drip);
  }
  for (let s = 0; s < 6; s++) px(c, LEAD, cx - 6 + s * 2 + (s % 2), top + h + 5);
}
