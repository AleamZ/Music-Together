import type { Facing } from "@/lib/game/types";

// v22 (0086): a character in their ghe on Sông Cái — the wake behind a moving boat, the hull bobbing on the swell with
// the rower sunk to the waist in it, a paddle dipping on alternate sides while moving. Original pixel art at 1:1 world
// px, fillRect only (every client paints the same). Browser only (canvas).

const H = {
  outline: "#3a2418", hull: "#8b5a33", hullDark: "#6e4424", hullLight: "#a8743f", rim: "#c8905c", deck: "#5a381e",
  paddle: "#c8905c", blade: "#a8743f", wake: "#d6ece4", wakeDim: "#a6d6e8", shadow: "rgba(20, 40, 50, 0.35)",
};

type Ctx = CanvasRenderingContext2D;
const fill = (c: Ctx, col: string, x: number, y: number, w: number, h: number) => {
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), w, h);
};

/** The swell's bob (px) for a boat at (x, y) at time t: 0 or 1, staggered by where it floats. */
export function boatBob(x: number, y: number, t: number, reduced: boolean): number {
  if (reduced) return 0;
  return Math.sin(t / 420 + (x * 0.05 + y * 0.03)) > 0.2 ? 1 : 0;
}

/** The wake: V-shaped ripples trailing behind the boat's stern (away from `facing`), fading. */
function wake(c: Ctx, x: number, y: number, facing: Facing, t: number, reduced: boolean): void {
  const back = facing === "right" ? [-1, 0] : facing === "left" ? [1, 0] : facing === "down" ? [0, -1] : [0, 1];
  const ph = reduced ? 0 : (t / 90) % 6;
  for (let k = 1; k <= 4; k++) {
    const d = 10 + k * 6 + ph, spread = 3 + k * 2;
    const bx = x + back[0] * d, by = y + back[1] * d * 0.6;
    const col = k < 3 ? H.wake : H.wakeDim;
    if (back[1] === 0) {
      fill(c, col, bx, by - spread, 3, 1);
      fill(c, col, bx, by + spread - 2, 3, 1);
    } else {
      fill(c, col, bx - spread, by, 2, 1);
      fill(c, col, bx + spread - 1, by, 2, 1);
    }
  }
}

/**
 * Draw a rower in a ghe with the feet point at (x, y) (screen px). `drawRider(dy)` draws the character sprite shifted
 * down by dy (the hull then covers the legs).
 */
export function drawBoatRider(c: Ctx, x: number, y: number, facing: Facing, t: number, moving: boolean, reduced: boolean,
  drawRider: (dy: number) => void): void {
  const bob = boatBob(x, y, t, reduced);
  const side = facing === "left" || facing === "right";
  if (moving) wake(c, x, y, facing, t, reduced);
  // the boat's shadow on the water
  c.fillStyle = H.shadow;
  if (side) c.fillRect(x - 19, y + 2, 38, 3); else c.fillRect(x - 10, y + 1, 20, 4);
  const hy = y - 8 + bob;                       // the hull's top edge (the hull sits on the water at the feet)
  if (side) {
    // the far gunwale behind the rower
    fill(c, H.outline, x - 18, hy - 1, 36, 2);
    fill(c, H.rim, x - 17, hy - 1, 34, 1);
  } else {
    fill(c, H.outline, x - 9, hy - 7, 18, 8);
    fill(c, H.deck, x - 8, hy - 6, 16, 6);
  }
  // the rower, sunk a little and cut at the gunwale: only the body above the boat shows
  c.save();
  c.beginPath();
  c.rect(x - 24, y - 80, 48, hy + 2 - (y - 80));
  c.clip();
  drawRider(4 + bob);
  c.restore();
  // the paddle: dips on alternate sides while moving, rests across the boat otherwise
  const stroke = moving && !reduced ? Math.floor(t / 260) % 2 : -1;
  if (side) {
    const dir = facing === "right" ? 1 : -1;
    if (stroke >= 0) {
      const px = x - dir * (stroke === 0 ? 4 : 10);
      fill(c, H.paddle, px, hy - 14, 1, 16);
      fill(c, H.blade, px - 1, hy + 2, 3, 4);
    } else fill(c, H.paddle, x - 14, hy - 3, 28, 1);
    // the near hull: pointed bow and stern
    fill(c, H.outline, x - 20, hy, 40, 10);
    fill(c, H.hull, x - 18, hy + 1, 36, 8);
    fill(c, H.hullLight, x - 16, hy + 1, 32, 1);
    fill(c, H.hullDark, x - 18, hy + 7, 36, 2);
    fill(c, H.outline, x + dir * 20, hy - 2, 2, 3);                 // the bow's raised tip
    fill(c, H.outline, x - dir * 21, hy - 1, 2, 2);
    fill(c, H.rim, x - 6, hy + 2, 12, 1);
  } else {
    if (stroke >= 0) {
      const px = x + (stroke === 0 ? -11 : 10);
      fill(c, H.paddle, px, hy - 10, 1, 13);
      fill(c, H.blade, px - 1, hy + 3, 3, 4);
    }
    // seen end-on: a short, deep hull with a pointed end towards the viewer
    fill(c, H.outline, x - 11, hy, 22, 10);
    fill(c, H.hull, x - 10, hy + 1, 20, 8);
    fill(c, H.hullLight, x - 9, hy + 1, 18, 1);
    fill(c, H.hullDark, x - 8, hy + 7, 16, 2);
    fill(c, H.outline, x - 3, hy + 10, 6, 1);
    fill(c, H.rim, x - 1, hy + 3, 2, 3);
  }
}
