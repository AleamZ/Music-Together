import { bobberPoint, handPoint, rodTip } from "@/lib/game/fishing/geometry";
import type { FishPhase } from "@/lib/game/net/protocol";
import type { Facing, Vec } from "@/lib/game/types";
import { FISH_ICONS } from "./fish";
import { pixelIconMatrix } from "./icons";
import { OUTLINE } from "./palettes";

// Fishing, drawn in world pixels (spec §11): the rod, the line, the bobber with its ripples / dip / splashes, and a
// fish held in the hands. Browser only (canvas). Original art.

type Ctx = CanvasRenderingContext2D;

const ROD = "#5a381e";
const ROD_TIP = "#c8905c";
const LINE = "rgba(240, 240, 232, 0.85)";
const RIPPLE = "#a6d6e8";
const SPLASH = "#e8f4f8";
const BOBBER_TOP = "#d8433a";
const BOBBER_BOTTOM = "#f4f1ea";
const LAMP_GLOW = "rgba(255, 224, 138, 0.4)";

export interface RodLook {
  /** 0 = the rod alone (the cast swing), 1 line out, 2 bite, 3 reeling. */
  phase: FishPhase;
  /** The rod's swing: 0 held back over the shoulder … 1 out over the water. */
  swing: number;
  /** Bobber top at the bite: the rarity colour when the bobber reveals it; null = red. */
  tint: string | null;
  /** Phao đèn glows. */
  glow: boolean;
  t: number;
  reducedMotion: boolean;
}

function px(c: Ctx, col: string, x: number, y: number): void {
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), 1, 1);
}

/** A 1-px line from a to b that sags `sag` px in the middle. */
function line(c: Ctx, col: string, a: Vec, b: Vec, sag: number): void {
  const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    px(c, col, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t + sag * 4 * t * (1 - t));
  }
}

/** Rod — and, once it is out, line and bobber — for a character whose feet are at `feet` (world px minus the camera). */
export function drawRod(c: Ctx, feet: Vec, facing: Facing, r: RodLook): void {
  const motion = !r.reducedMotion;
  const bend = r.phase === 3 ? 4 + (motion ? Math.floor(r.t / 90) % 2 : 0) : r.phase === 2 ? 2 : 0;
  const hand = handPoint(feet, facing);
  const tip = rodTip(feet, facing, r.phase === 0 ? r.swing : 1, bend);
  line(c, ROD, hand, tip, 0);
  px(c, ROD_TIP, tip.x, tip.y);
  if (r.phase === 0) return;
  const b = bobberPoint(feet, facing);
  line(c, LINE, tip, b, r.phase === 3 ? 0 : 3);
  // the bobber dips at the bite (a steady dip under reduced motion — it is the signal to hook)
  const dip = r.phase === 2 ? (motion ? Math.floor(r.t / 160) % 2 : 1) : 0;
  if (r.phase === 1 && motion && Math.floor(r.t / 1200) % 2 === 0) {
    const rad = 3 + ((r.t / 150) % 4);
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      px(c, RIPPLE, b.x + Math.cos(ang) * rad, b.y + 1 + Math.sin(ang) * rad * 0.45);
    }
  }
  if (r.phase === 3 && motion) {
    for (let k = 0; k < 5; k++) px(c, SPLASH, b.x - 3 + ((k * 7 + Math.floor(r.t / 70)) % 7), b.y - 1 - ((k * 3 + Math.floor(r.t / 110)) % 3));
  }
  if (r.glow) {
    c.fillStyle = LAMP_GLOW;
    c.fillRect(Math.round(b.x) - 4, Math.round(b.y) - 5 + dip, 9, 9);
  }
  const x = Math.round(b.x), y = Math.round(b.y);
  c.fillStyle = OUTLINE;
  c.fillRect(x - 2, y - 3 + dip, 5, 5);
  c.fillStyle = r.tint && r.phase >= 2 ? r.tint : BOBBER_TOP;
  c.fillRect(x - 1, y - 2 + dip, 3, 2);
  if (dip === 0) {
    c.fillStyle = BOBBER_BOTTOM;
    c.fillRect(x - 1, y, 3, 1);
  }
}

const fishCache = new Map<string, HTMLCanvasElement | null>();

/** A species icon as a 16×16 canvas, mirrored for characters facing right; null for an unknown id. */
function fishCanvas(speciesId: string, mirror: boolean): HTMLCanvasElement | null {
  const key = `${speciesId}|${mirror ? 1 : 0}`;
  const hit = fishCache.get(key);
  if (hit !== undefined) return hit;
  const icon = FISH_ICONS[speciesId];
  const cv = icon ? document.createElement("canvas") : null;
  const c = cv?.getContext("2d") ?? null;
  if (!cv || !c || !icon) {
    fishCache.set(key, null);
    return null;
  }
  cv.width = 16;
  cv.height = 16;
  pixelIconMatrix(icon).forEach((row, y) => row.forEach((col, x) => {
    if (!col) return;
    c.fillStyle = col;
    c.fillRect(mirror ? 15 - x : x, y, 1, 1);
  }));
  fishCache.set(key, cv);
  return cv;
}

/** The fish in a character's hands at 1:1: in front of the belly facing down, at the side facing left/right, hidden
 *  (behind the body) facing up. */
export function drawHeldFish(c: Ctx, feet: Vec, facing: Facing, speciesId: string): void {
  if (facing === "up") return;
  const cv = fishCanvas(speciesId, facing === "right");
  if (!cv) return;
  const x = Math.round(feet.x), y = Math.round(feet.y);
  if (facing === "down") c.drawImage(cv, x - 8, y - 27);
  else if (facing === "left") c.drawImage(cv, x - 15, y - 28);
  else c.drawImage(cv, x - 1, y - 28);
}
