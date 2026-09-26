import { TRANSPLANT, type CrabMark, type TransplantHill } from "@/lib/game/farm/minigames";
import type { Rect } from "@/lib/game/maps/types";

// v15.3 art (spec §15), drawn in code: the crab holes and snail beds on the field's background, the cues the engine
// draws on a spot ready for me, and the scenes of the two overlays, CrabGame (96 × 64) and TransplantGame (160 × 48),
// which their components draw at an integer scale. Original art.

/** What these painters need of a 2D context (a test records it). */
export type Paint = Pick<CanvasRenderingContext2D, "fillStyle" | "globalAlpha" | "fillRect">;

const K = {
  // the background
  bankMud: "#6e5230", burrow: "#3a2a1a", rim: "#5a4128", pellet: "#7a5c38",
  sand: "#c9b58a", shallow: "#8cc3d6", leaf: "#4f9a38", leafLight: "#6fbf4a", stone: "#d9d2c0",
  // the cues
  eye: "#2a2f3a", claw: "#b8432f", bubble: "#e8f4f8", ocDong: "#4a3a22", ocBuou: "#c9955a",
  // CrabGame
  carapace: "#6b5a2e", carapaceLight: "#8e7a44", open: "#d8342a", closed: "#4caf50", hand: "#e0b089", handDark: "#c08e68",
  // TransplantGame
  mud: "#6e5230", sheen: "#86683f", guide: "#5a4128", tuft: "#6fbf4a", tuftDark: "#4f9a38", tie: "#8b5a33", chili: "#5caa4a",
} as const;

function box(c: Paint, col: string, x: number, y: number, w: number, h: number): void {
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), w, h);
}

// ---------------------------------------------------------------- the field's background (field-art.ts)

/** A crab hole in the bank (`r`, 16 × 10): a patch of bank mud, a 10 × 6 burrow in its rim, three mud pellets. */
export function paintHole(c: Paint, r: Rect): void {
  box(c, K.bankMud, r.x + 1, r.y, r.w - 2, r.h);
  box(c, K.bankMud, r.x, r.y + 1, r.w, r.h - 2);
  box(c, K.rim, r.x + 2, r.y + 1, 12, 8);
  box(c, K.burrow, r.x + 3, r.y + 2, 10, 6);
  for (const [dx, dy] of [[0, 2], [14, 1], [15, 7]]) box(c, K.pellet, r.x + dx, r.y + dy, 1, 1);
}

/** A snail bed across the water's edge (`r`, 20 × 10): sand under light water, water-hyacinth leaves at both ends and
 *  two pale stones. */
export function paintBed(c: Paint, r: Rect): void {
  box(c, K.shallow, r.x + 1, r.y, r.w - 2, r.h);
  box(c, K.shallow, r.x, r.y + 1, r.w, r.h - 2);
  for (let y = 1; y < r.h - 1; y++) for (let x = 2 + (y % 3); x < r.w - 2; x += 3) box(c, K.sand, r.x + x, r.y + y, 1, 1);
  box(c, K.stone, r.x + 6, r.y + 6, 2, 1);
  box(c, K.stone, r.x + 12, r.y + 2, 2, 2);
  for (const [dx, dy] of [[0, 3], [16, 5]]) {
    box(c, K.leaf, r.x + dx, r.y + dy, 4, 2);
    box(c, K.leafLight, r.x + dx + 1, r.y + dy - 1, 2, 1);
  }
}

// ---------------------------------------------------------------- the engine's cues (§13.1)

/** A hole ready for me, at its rect's corner on screen: two eye stalks and a claw tip peek out of the burrow, and a
 *  bubble rises every 1.5 s. Still under reduced motion. */
export function drawHoleCue(c: Paint, x: number, y: number, t: number, reduced: boolean): void {
  box(c, K.eye, x + 6, y + 3, 1, 3);
  box(c, K.eye, x + 9, y + 3, 1, 3);
  box(c, K.claw, x + 11, y + 5, 2, 1);
  const rise = reduced ? 3 : Math.floor(((t % 1500) / 1500) * 7);
  box(c, K.bubble, x + 8, y + 1 - rise, 1, 1);
}

/** A bed ready for me: three shells, two ốc đồng and an ốc bươu vàng, glinting one at a time. Still under reduced
 *  motion. */
export function drawBedCue(c: Paint, x: number, y: number, t: number, reduced: boolean): void {
  const shells: ReadonlyArray<[number, number, string]> = [[4, 4, K.ocDong], [10, 6, K.ocBuou], [14, 3, K.ocDong]];
  for (const [dx, dy, col] of shells) box(c, col, x + dx, y + dy, 2, 2);
  const [gx, gy] = shells[reduced ? 1 : Math.floor(t / 600) % shells.length];
  box(c, K.bubble, x + gx, y + gy, 1, 1);
}

// ---------------------------------------------------------------- CrabGame (§7.2, §13.2)

export const CRAB_SCENE = { w: 96, h: 64 } as const;

export interface CrabView {
  /** The claws: closed (a grab now is a hit) or open. */
  closed: boolean;
  /** The lead-in: the crab lurks low in the hole, its claws hidden. */
  lurking: boolean;
  /** The last try's end, shown through its beat: the hand dips on a hit, and jerks back with "!" on a pinch. */
  mark: CrabMark | null;
  t: number;
  reduced: boolean;
}

/** A claw: its outline (red when open, green when closed), the shell and the red tip. */
function claw(c: Paint, x: number, y: number, outline: string, tipLeft: boolean): void {
  box(c, outline, x - 1, y - 1, 12, 9);
  box(c, K.carapace, x, y, 10, 7);
  box(c, K.carapaceLight, x + 2, y + 1, 6, 2);
  box(c, K.claw, tipLeft ? x : x + 7, y, 3, 3);
}

/** The bank in cross-section with the hole's mouth; the crab, its claws spread wide when open and together when closed;
 *  the hand over it. Reduced motion keeps the claws, without the shake, the hover or the splash. */
export function drawCrabScene(c: Paint, v: CrabView): void {
  box(c, K.bankMud, 0, 0, CRAB_SCENE.w, CRAB_SCENE.h);
  for (let i = 0; i < 26; i++) box(c, K.pellet, (i * 37) % 92, 3 + ((i * 23) % 26), 2, 1);
  box(c, K.shallow, 0, 56, CRAB_SCENE.w, 8);
  box(c, K.rim, 22, 30, 52, 27);
  box(c, K.burrow, 24, 32, 48, 25);
  const shake = !v.reduced && !v.lurking && !v.closed ? Math.round(Math.sin(v.t / 45)) : 0;
  const cy = v.lurking ? 48 : 42;
  box(c, K.eye, 42 + shake, cy - 4, 1, 4);
  box(c, K.eye, 53 + shake, cy - 4, 1, 4);
  box(c, K.carapace, 37 + shake, cy, 22, 10);
  box(c, K.carapaceLight, 40 + shake, cy + 1, 16, 3);
  if (!v.lurking) {
    if (v.closed) {
      claw(c, 36, cy - 12, K.closed, false);
      claw(c, 50, cy - 12, K.closed, true);
    } else {
      claw(c, 16 + shake, cy - 7, K.open, true);
      claw(c, 70 + shake, cy - 7, K.open, false);
    }
  }
  const hover = v.reduced ? 0 : Math.round(Math.sin(v.t / 300) * 2);
  const hy = v.mark === "pinch" ? 2 : v.mark === "hit" ? 24 : 12 + hover;
  box(c, K.hand, 42, hy, 12, 9);
  for (let k = 0; k < 4; k++) box(c, k === 3 ? K.handDark : K.hand, 42 + k * 3, hy + 9, 2, 4);
  if (v.mark === "pinch") {
    for (const bx of [32, 62]) {
      box(c, K.open, bx, 3, 2, 5);
      box(c, K.open, bx, 10, 2, 2);
    }
  }
  if (v.mark === "hit" && !v.reduced) for (const [sx, sy] of [[30, 52], [66, 52], [38, 49], [58, 49]]) box(c, K.bubble, sx, sy, 2, 1);
}

// ---------------------------------------------------------------- TransplantGame (§8.2, §13.3)

export const TRANSPLANT_SCENE = { w: 160, h: 48 } as const;

export interface TransplantView {
  /** The hills set so far, in order. */
  hills: readonly TransplantHill[];
  /** The current hill's band centre, and the hand, 0–1 across the row (null outside a sweep). */
  centre: number | null;
  x: number | null;
  /** The ớt round: seedlings with rounder leaves. */
  ot: boolean;
  t: number;
  reduced: boolean;
}

/** The sweep's x (0–1) on the scene's track. */
const trackX = (x: number) => Math.round(8 + x * 144);
/** Hill i's slot on the guide line. */
export const hillX = (i: number) => 14 + i * 12;
export const GUIDE_Y = 34;

/** A seedling set at (x, y): a tuft of rice, or an ớt seedling's stem and rounder leaves. */
function seedling(c: Paint, x: number, y: number, ot: boolean): void {
  if (ot) {
    box(c, K.tuftDark, x, y - 5, 1, 5);
    box(c, K.chili, x - 3, y - 6, 3, 2);
    box(c, K.chili, x + 1, y - 8, 3, 2);
    return;
  }
  box(c, K.tuft, x - 2, y - 6, 1, 6);
  box(c, K.tuftDark, x, y - 8, 1, 8);
  box(c, K.tuft, x + 2, y - 6, 1, 6);
}

/** The mud with its sheen, the guide line and its 12 slots, the hills set (a lệch one 2 px off the line, none for a
 *  sót), the band at 35 % with its chuẩn core at 55 %, and the hand with its tied bunch. Reduced motion stills the
 *  sheen; the sweep is the round itself. */
export function drawTransplantScene(c: Paint, v: TransplantView): void {
  box(c, K.mud, 0, 0, TRANSPLANT_SCENE.w, TRANSPLANT_SCENE.h);
  const shimmer = v.reduced ? 0 : Math.floor(v.t / 400) % 3;
  for (let i = 0; i < 14; i++) box(c, K.sheen, 6 + ((i * 29) % 146) + shimmer, 24 + ((i * 7) % 20), 3, 1);
  const centre = v.centre;
  if (centre !== null) {
    const band = (half: number, alpha: number) => {
      const x0 = trackX(centre - half), x1 = trackX(centre + half);
      c.globalAlpha = alpha;
      box(c, K.tuft, x0, 3, x1 - x0, 12);
    };
    band(TRANSPLANT.near, 0.35);
    band(TRANSPLANT.exact, 0.55);
    c.globalAlpha = 1;
  }
  box(c, K.guide, 8, GUIDE_Y, 144, 1);
  for (let i = 0; i < TRANSPLANT.hills; i++) box(c, K.guide, hillX(i) - 1, GUIDE_Y - 1, 3, 3);
  v.hills.forEach((h, i) => {
    if (h.mark !== "sot") seedling(c, hillX(i), GUIDE_Y + (h.mark === "lech" ? 2 : 0), v.ot);
  });
  if (v.x !== null) {
    const hx = trackX(v.x);
    box(c, K.hand, hx - 3, 5, 7, 6);
    box(c, v.ot ? K.chili : K.tuft, hx - 1, 11, 3, 6);
    box(c, K.tie, hx - 1, 12, 3, 1);
  }
}
