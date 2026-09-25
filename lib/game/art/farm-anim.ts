import { handPoint } from "@/lib/game/fishing/geometry";
import { FARM_ANIM, type FarmAnim } from "@/lib/game/net/protocol";
import type { Facing, Vec } from "@/lib/game/types";

// The farm animations (v15 spec §12, v15.2 §15), drawn in world pixels over a character while they play: seedlings,
// the sickle, pumped water, spray mist, fertilizer, a crab, a snail, the hoe, digging tubers and picking into a basket.
// Browser only (canvas). Original art.

type Ctx = CanvasRenderingContext2D;

const FACE: Record<Facing, Vec> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const COL = {
  seedling: "#6fbf4a", seedlingDark: "#4f9a38", tie: "#8b5a33", straw: "#e0b33c", strawDark: "#b8902a",
  blade: "#5a5f68", edge: "#e8e8ee", handle: "#6e4424", water: "#6fb2cf", waterLight: "#a6d6e8", mist: "rgba(244, 241, 234, 0.75)",
  granule: "#f4efe0", crab: "#b8432f", crabLight: "#d9776a", shell: "#8a5a2b", shellLight: "#c9955a", egg: "#f29bb5",
  soil: "#6e5230", tuber: "#b0486e", tuberDark: "#7e2f4e", basket: "#c8a46a", basketDark: "#a8844f", hand: "#e8b890",
  corn: "#f6c945", chili: "#d8342a",
};

function px(c: Ctx, col: string, x: number, y: number): void {
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), 1, 1);
}

/** A tied bunch (seedlings or cut rice) held at p. */
function bunch(c: Ctx, p: Vec, col: string, dark: string): void {
  for (let k = 1; k <= 5; k++) {
    px(c, col, p.x - 1, p.y - k);
    px(c, dark, p.x, p.y - k - 1);
    px(c, col, p.x + 1, p.y - k);
  }
  for (let d = -1; d <= 1; d++) px(c, COL.tie, p.x + d, p.y);
}

/** The hoe from the hand, up or down in the ground; returns its head. */
function hoe(c: Ctx, hand: Vec, flip: number, down: boolean): Vec {
  const head = { x: hand.x + 5 * flip, y: hand.y + (down ? 6 : -6) };
  for (let k = 0; k <= 6; k++) px(c, COL.handle, hand.x + ((head.x - hand.x) * k) / 6, hand.y + ((head.y - hand.y) * k) / 6);
  c.fillStyle = COL.blade;
  c.fillRect(Math.round(head.x) - 2, Math.round(head.y), 4, 2);
  px(c, COL.edge, head.x - 2 * flip, head.y + 1);
  return head;
}

/** Points along an arc from a to b, `n` of them, shifted along it by `shift` (0–1) so they flow. */
function arc(a: Vec, b: Vec, n: number, shift: number, rise: number): Vec[] {
  const pts: Vec[] = [];
  for (let k = 0; k < n; k++) {
    const s = ((k + shift) / n) % 1;
    pts.push({ x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s - rise * 4 * s * (1 - s) });
  }
  return pts;
}

// the sickle's blade around the hand, raised → cutting → down → back (x mirrored when facing left)
const SICKLE: ReadonlyArray<ReadonlyArray<[number, number]>> = [
  [[1, -3], [2, -4], [3, -4], [4, -3], [4, -2]],
  [[2, -2], [3, -2], [4, -1], [4, 0], [3, 1]],
  [[2, 0], [3, 1], [3, 2], [2, 3], [1, 3]],
  [[1, -1], [2, -2], [3, -2], [4, -1], [4, 0]],
];

/**
 * Farm animation `a` for a character whose feet are at `feet` (world px minus the camera), at frame time `t`.
 * Under reduced motion it holds one pose.
 */
export function drawFarmAnim(c: Ctx, feet: Vec, facing: Facing, a: FarmAnim, t: number, reduced: boolean): void {
  if (a === FARM_ANIM.stop) return;
  const hand = handPoint(feet, facing), f = FACE[facing];
  const flip = facing === "left" ? -1 : 1;
  // the ground just in front of the feet
  const g = { x: feet.x + f.x * 12, y: feet.y + (f.y > 0 ? 8 : f.y < 0 ? -6 : 2) };
  const beat = reduced ? 1 : Math.floor(t / 180) % 4;
  const flow = reduced ? 0.5 : (t % 720) / 720;
  switch (a) {
    case FARM_ANIM.transplant:
      bunch(c, hand, COL.seedling, COL.seedlingDark);
      // the hills set so far in front
      for (let k = 0; k <= beat; k++) {
        const x = g.x - 6 + k * 4;
        px(c, COL.seedlingDark, x, g.y); px(c, COL.seedling, x, g.y - 1); px(c, COL.seedling, x - 1, g.y - 2); px(c, COL.seedling, x + 1, g.y - 2);
      }
      break;
    case FARM_ANIM.harvest:
      px(c, COL.handle, hand.x, hand.y + 1); px(c, COL.handle, hand.x, hand.y + 2);
      SICKLE[beat].forEach(([dx, dy], k) => px(c, k === 4 ? COL.edge : COL.blade, hand.x + dx * flip, hand.y + dy));
      // cut straw flying off
      for (let k = 0; k < 3; k++) px(c, k % 2 ? COL.strawDark : COL.straw, g.x - 2 + k * 2, g.y - 2 - ((beat + k) % 3));
      break;
    case FARM_ANIM.pump:
      for (const p of arc(hand, g, 7, flow * 7, 6)) { px(c, COL.water, p.x, p.y); px(c, COL.waterLight, p.x, p.y - 1); }
      for (let k = -2; k <= 2; k++) px(c, COL.waterLight, g.x + k * 2, g.y - (Math.abs(k) + beat) % 2);
      break;
    case FARM_ANIM.spray: {
      // the wand, then a mist cloud that breathes
      const tip = { x: hand.x + f.x * 5 + (f.x === 0 ? 2 : 0), y: hand.y + f.y * 3 - 1 };
      for (let k = 0; k <= 4; k++) px(c, COL.handle, hand.x + ((tip.x - hand.x) * k) / 4, hand.y + ((tip.y - hand.y) * k) / 4);
      const r = 3 + beat;
      for (let k = 0; k < 10; k++) {
        const ang = (k / 10) * Math.PI * 2 + beat * 0.4;
        px(c, COL.mist, g.x + Math.cos(ang) * r, g.y - 3 + Math.sin(ang) * r * 0.5);
      }
      break;
    }
    case FARM_ANIM.fertilize:
      for (const p of arc(hand, g, 5, flow * 5, 4)) px(c, COL.granule, p.x, p.y);
      for (let k = 0; k < 4; k++) px(c, COL.granule, g.x - 4 + k * 3, g.y + ((k + beat) % 2));
      break;
    case FARM_ANIM.crab:
      c.fillStyle = COL.crab;
      c.fillRect(Math.round(hand.x) - 2, Math.round(hand.y) - 2, 5, 3);
      px(c, COL.crabLight, hand.x - 1, hand.y - 2);
      // claws open and close
      px(c, COL.crab, hand.x - 3, hand.y - 3 - (beat % 2)); px(c, COL.crab, hand.x + 3, hand.y - 3 - (beat % 2));
      px(c, COL.crab, hand.x - 3, hand.y + 1); px(c, COL.crab, hand.x + 3, hand.y + 1);
      break;
    case FARM_ANIM.snails:
      c.fillStyle = COL.shell;
      c.fillRect(Math.round(hand.x) - 1, Math.round(hand.y) - 3, 4, 3);
      px(c, COL.shellLight, hand.x, hand.y - 2);
      // pink eggs scraped off the stems in front
      for (let k = 0; k < 3; k++) px(c, COL.egg, g.x - 3 + k * 3, g.y - 3 - ((k + beat) % 2));
      break;
    case FARM_ANIM.prepare: {
      // the hoe: up on the first beats, down in the mud on the last
      const down = beat >= 2;
      const head = hoe(c, hand, flip, down);
      if (down) for (let k = 0; k < 4; k++) px(c, COL.soil, head.x - 3 + k * 2, head.y - 1 - (k % 2) * 2);
      break;
    }
    case FARM_ANIM.dig: {
      // the hoe comes down, and three tubers pop up in front
      const down = beat >= 1;
      hoe(c, hand, flip, down);
      if (down) {
        for (let k = 0; k < 3; k++) {
          const x = g.x - 4 + k * 4, y = g.y - 1 - (reduced ? 1 : (beat + k) % 3);
          px(c, COL.tuber, x, y); px(c, COL.tuber, x + 1, y); px(c, COL.tuberDark, x + 1, y + 1); px(c, COL.soil, x - 1, y + 2);
        }
      }
      break;
    }
    case FARM_ANIM.pick: {
      // a hand reaching into the plants, and a woven basket at the feet filling with yellow and red
      const reach = { x: hand.x + f.x * 4 + (f.x === 0 ? 2 : 0), y: hand.y + f.y * 3 - (reduced ? 0 : beat % 2) };
      c.fillStyle = COL.hand;
      c.fillRect(Math.round(reach.x), Math.round(reach.y), 2, 2);
      px(c, beat % 2 ? COL.chili : COL.corn, reach.x + flip, reach.y - 1);
      const bx = Math.round(feet.x - 9 * flip) - 3, by = Math.round(feet.y) - 3;
      c.fillStyle = COL.basketDark;
      c.fillRect(bx, by, 7, 4);
      c.fillStyle = COL.basket;
      for (let k = 0; k < 7; k += 2) c.fillRect(bx + k, by + 1, 1, 3);
      const fill = reduced ? 3 : 1 + beat;
      for (let k = 0; k < fill; k++) px(c, k % 2 ? COL.chili : COL.corn, bx + 1 + k * 2, by);
      break;
    }
  }
}
