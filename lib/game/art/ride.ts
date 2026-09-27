import type { Facing, Vec } from "@/lib/game/types";
import type { VehicleId } from "@/lib/game/travel/vehicles";
import { disc, HIP_ROW, line, px, rect, seatedRider, sideSaddle, upperBody, wheel, type Pillion } from "./road";

export type { Pillion } from "./road";

// v18.7: riding in the world. Original pixel art at 1:1 world pixels, fillRect-based, with the rider sprite drawn in.
// The ground contact is at `feet`, so the group y-sorts like a walking character.
// Side views are drawn facing right and mirrored for "left" (the caller passes the right-facing rider frame then).

type Ctx = CanvasRenderingContext2D;

const SHADOW = "rgba(40, 25, 10, 0.28)";
const TIRE = "#1f1a22";
const INK = "#2a2230";
const CREAM = "#efe0bc";
const METAL = "#8a8494";
const BIKE = "#2f9e8f", BIKE_HI = "#5cc7b5";
const MOTO = "#74c2b0", MOTO_HI = "#b2e6d6", MOTO_SH = "#4f9a8a";
const CAR = "#d6504a", CAR_HI = "#f28068", CAR_SH = "#a33a38";

function shadow(c: Ctx, x: number, g: number, half: number): void {
  c.fillStyle = SHADOW;
  c.fillRect(x - half, g - 1, half * 2, 2);
  c.fillRect(x - half + 2, g + 1, half * 2 - 4, 1);
}

/** The rider's upper body (sprite rows 0..HIP_ROW) with the hips at (cx, hipY). */
function upper(c: Ctx, rider: HTMLCanvasElement, cx: number, hipY: number): void {
  c.drawImage(rider, 0, 0, 24, HIP_ROW + 1, cx - 12, hipY - HIP_ROW, 24, HIP_ROW + 1);
}

/**
 * Seen from the front or back a seated rider's legs come toward the viewer, so they look short: the sprite's own legs,
 * with the middle of the shin cut out (sprite rows 35..38 and 42..45), hips at (cx, hipY), each leg lifted by its pedal.
 */
function wholeRider(c: Ctx, rider: HTMLCanvasElement, cx: number, hipY: number, lift: [number, number], splay: number): void {
  const left = cx - 12, y0 = hipY + 1;
  ([[0, lift[0], -splay], [12, lift[1], splay]] as const).forEach(([sx, l, dx]) => {
    c.drawImage(rider, sx, HIP_ROW + 1, 12, 4, left + sx + dx, y0 - l, 12, 4);
    c.drawImage(rider, sx, 42, 12, 4, left + sx + dx, y0 + 4 - l, 12, 4);
  });
  upper(c, rider, cx, hipY);
}
/** A wheel seen edge-on (front or back view): a narrow tyre with tread marks rolling down while moving. */
function edgeWheel(c: Ctx, x: number, top: number, h: number, t: number): void {
  rect(c, x - 1, top + 1, 3, h - 2, TIRE);
  rect(c, x, top, 1, h, TIRE);
  rect(c, x, top + 2, 1, h - 4, "#4a4452");
  const k = Math.floor(t / 60) % 3;
  for (let y = top + 1 + k; y < top + h - 1; y += 3) px(c, x - 1, y, "#3c3644");
}

function puff(c: Ctx, cx: number, cy: number, r: number, col: string, a: number): void {
  disc(c, cx, cy, r, col.replace("A", a.toFixed(3)));
}

/**
 * A character riding `v` with its ground contact at `feet`. `rider` is the character's frame for `facing`
 * (for "left", the right-facing frame: side views are mirrored). `moving` animates wheels, pedalling, shake and dust;
 * standing still or `reduced` draws a still vehicle. `pillion` (v18.13) seats a passenger: side-saddle on the bike's
 * rack, on the scooter's pillion, in the car's other seat.
 */
export function drawRide(c: Ctx, feet: Vec, facing: Facing, v: VehicleId, rider: HTMLCanvasElement, t: number, moving: boolean, reduced: boolean, pillion: Pillion | null = null): void {
  const anim = moving && !reduced;
  const tt = anim ? t : 0;
  const x = Math.round(feet.x), g = Math.round(feet.y);
  if (facing === "left" || facing === "right") {
    c.save();
    if (facing === "left") { c.translate(2 * x, 0); c.scale(-1, 1); }
    if (v === "bike") sideBike(c, x, g, tt, rider, pillion);
    else if (v === "moto") sideMoto(c, x, g, tt, rider, anim, pillion);
    else sideCar(c, x, g, tt, rider, anim, pillion);
    c.restore();
    return;
  }
  const front = facing === "down";
  if (v === "bike") endBike(c, x, g, tt, rider, front, pillion);
  else if (v === "moto") endMoto(c, x, g, tt, rider, front, anim, pillion);
  else endCar(c, x, g, tt, rider, front, anim, pillion);
}

// ---------- side views (facing right) ----------
function sideBike(c: Ctx, x: number, g: number, t: number, rider: HTMLCanvasElement, p: Pillion | null): void {
  shadow(c, x, g, 14);
  const spin = t / 90;
  const rear = { x: x - 9, y: g - 5 }, front = { x: x + 9, y: g - 5 }, bb = { x: x - 1, y: g - 5 };
  const seatTop = { x: x - 4, y: g - 12 }, head = { x: x + 6, y: g - 12 };
  wheel(c, rear.x, rear.y, 5, spin, TIRE, "#9a98a8", "#d0ccd8");
  wheel(c, front.x, front.y, 5, spin + 0.5, TIRE, "#9a98a8", "#d0ccd8");
  for (let k = -2; k <= 2; k++) { px(c, rear.x + k, rear.y - 6 + (Math.abs(k) > 1 ? 1 : 0), CREAM); px(c, front.x + k, front.y - 6 + (Math.abs(k) > 1 ? 1 : 0), CREAM); }
  line(c, bb.x, bb.y, rear.x, rear.y, "#56505e");
  line(c, bb.x, bb.y, seatTop.x, seatTop.y, BIKE);
  line(c, seatTop.x, seatTop.y, rear.x, rear.y, BIKE);
  line(c, bb.x, bb.y, head.x, head.y, BIKE);
  line(c, seatTop.x, seatTop.y, head.x, head.y, BIKE_HI);
  line(c, head.x, head.y, front.x, front.y, BIKE);
  rect(c, x - 13, g - 12, 5, 1, METAL);
  rect(c, x - 7, g - 14, 5, 2, "#3a2a22");
  const a = t / 140;
  const p1 = { x: Math.round(bb.x + Math.cos(a) * 2), y: Math.round(bb.y + Math.sin(a) * 2) };
  const p2 = { x: Math.round(bb.x - Math.cos(a) * 2), y: Math.round(bb.y - Math.sin(a) * 2) };
  const bob = Math.floor(t / 220) % 2 === 0 ? 0 : -1;
  // v18.13: the passenger side-saddle on the rack, facing the viewer, legs dangling (behind the rider)
  if (p) sideSaddle(c, p.down, { x: x - 13, y: g - 13 + bob }, 4);
  seatedRider(c, rider, { x: x - 4, y: g - 14 + bob }, { x: x + 3, y: g - 14 + Math.round((p1.y - bb.y) / 2) }, [{ x: p1.x, y: p1.y - 1 }, { x: p2.x, y: p2.y - 1 }], { x: x + 5, y: g - 18 });
  line(c, bb.x, bb.y, p1.x, p1.y, "#3a3440");
  rect(c, p1.x - 1, p1.y, 3, 1, TIRE);
  // stem, bars, a little basket with a flower, the lamp
  line(c, head.x, head.y, x + 7, g - 16, BIKE);
  rect(c, x + 4, g - 17, 4, 1, INK);
  rect(c, x + 3, g - 17, 1, 2, "#6a4a34");
  rect(c, x + 9, g - 16, 5, 4, "#b8864a");
  rect(c, x + 9, g - 16, 5, 1, "#d8a868");
  px(c, x + 10, g - 14, "#8a5e30"); px(c, x + 12, g - 14, "#8a5e30");
  px(c, x + 11, g - 17, "#f07aa0"); px(c, x + 13, g - 17, "#ffe07a");
  px(c, x + 14, g - 11, "#ffe8a0");
}

function sideMoto(c: Ctx, x: number, g: number, t: number, rider: HTMLCanvasElement, anim: boolean, p: Pillion | null): void {
  if (anim) for (let i = 0; i < 3; i++) {
    const age = ((t + i * 180) % 540) / 540;
    puff(c, x - 17 - age * 8, g - 5 - age * 4, 1 + age * 1.5, "rgba(206,200,214,A)", 0.7 * (1 - age));
  }
  const sy = anim ? Math.floor(t / 40) % 2 : 0;
  const gg = g - sy;
  shadow(c, x, g, 15);
  const spin = t / 60;
  wheel(c, x - 9, g - 4, 4, spin, TIRE, "#b8b6c4", "#6a6674");
  wheel(c, x + 10, g - 4, 4, spin + 1, TIRE, "#b8b6c4", "#6a6674");
  rect(c, x - 16, gg - 6, 6, 2, METAL);
  // rear cowl, a rounded bulb over the rear wheel
  for (let r = 0; r < 8; r++) {
    const f = (r - 4) / 4.5;
    const half = Math.round(Math.sqrt(Math.max(0, 1 - f * f)) * 7);
    rect(c, x - 8 - half, gg - 14 + r, half * 2 + 2, 1, r < 2 ? MOTO_HI : r > 5 ? MOTO_SH : MOTO);
  }
  rect(c, x - 16, gg - 11, 1, 2, "#e0403a");
  rect(c, x - 3, gg - 7, 10, 2, "#3a3440");
  rect(c, x - 3, gg - 7, 10, 1, MOTO_SH);
  // seat, then the rider with both feet on the floorboard
  rect(c, x - 13, gg - 16, 10, 2, "#3a2a2a");
  rect(c, x - 12, gg - 16, 8, 1, "#5a4440");
  // v18.13: the pillion passenger behind the rider, feet on the rear peg
  if (p) {
    rect(c, x - 11, gg - 7, 3, 1, "#3a3440");
    seatedRider(c, p.right, { x: x - 13, y: gg - 17 }, { x: x - 6, y: gg - 16 }, [{ x: x - 9, y: gg - 8 }, { x: x - 7, y: gg - 8 }]);
  }
  seatedRider(c, rider, { x: x - 7, y: gg - 16 }, { x: x + 1, y: gg - 15 }, [{ x: x + 1, y: gg - 8 }, { x: x + 3, y: gg - 8 }], { x: x + 4, y: gg - 24 });
  // leg shield, front fender
  for (let yy = 0; yy < 13; yy++) rect(c, x + 6 + Math.round(yy * 0.25), gg - 19 + yy, 3, 1, yy < 2 ? MOTO_HI : MOTO);
  for (let k = -3; k <= 3; k++) px(c, x + 10 + k, gg - 9 + (Math.abs(k) > 2 ? 1 : 0), MOTO);
  rect(c, x + 8, gg - 9, 5, 1, MOTO_HI);
  // headset, bar, lamp, mirror
  rect(c, x + 6, gg - 22, 6, 3, MOTO);
  rect(c, x + 6, gg - 22, 6, 1, MOTO_HI);
  rect(c, x + 3, gg - 23, 5, 1, INK);
  rect(c, x + 12, gg - 21, 1, 2, "#fff2b8");
  px(c, x + 13, gg - 21, "#ffffff");
  line(c, x + 5, gg - 23, x + 4, gg - 25, METAL);
  rect(c, x + 3, gg - 27, 3, 2, "#c8c4d0");
}

function sideCar(c: Ctx, x: number, g: number, t: number, rider: HTMLCanvasElement, anim: boolean, p: Pillion | null): void {
  if (anim) for (let i = 0; i < 4; i++) {
    const age = ((t + i * 120) % 480) / 480;
    puff(c, x - 20 - age * 12, g - 2 - age * 5, 1 + age * 2.5, "rgba(200,164,122,A)", 0.6 * (1 - age));
  }
  const bob = anim && Math.floor(t / 90) % 3 === 0 ? -1 : 0;
  const gg = g + bob;
  shadow(c, x, g, 23);
  // v18.13: the passenger in the far seat, a little ahead of the driver (seen past them, under the windscreen)
  if (p) upperBody(c, p.right, { x: x + 6, y: gg - 9 });
  // seat back behind the driver, the driver (head and shoulders over the door), the wheel and windscreen before them
  rect(c, x - 11, gg - 20, 3, 7, "#5a3430");
  rect(c, x - 11, gg - 20, 3, 1, "#7a4a42");
  upper(c, rider, x - 3, gg - 7);
  line(c, x + 5, gg - 18, x + 6, gg - 14, INK);
  rect(c, x + 4, gg - 19, 2, 1, INK);
  for (let k = 0; k < 7; k++) rect(c, x + 8 - Math.round(k * 0.5), gg - 14 - k, 3, 1, "rgba(180,215,255,0.45)");
  line(c, x + 11, gg - 14, x + 7, gg - 21, "#c8c4d0");
  // the body: a rounded tub, long hood, short deck
  for (let j = 0; j < 12; j++) {
    const l = x - 22 + (j === 0 ? 2 : j === 1 ? 1 : 0);
    const r = x + 21 - (j === 0 ? 3 : j === 1 ? 1 : 0) - (j === 11 ? 1 : 0);
    rect(c, l, gg - 14 + j, r - l + 1, 1, j === 0 ? CAR_HI : j > 8 ? CAR_SH : CAR);
  }
  rect(c, x - 22, gg - 10, 44, 1, "#f4e6c8");
  line(c, x - 6, gg - 13, x - 6, gg - 5, CAR_SH);
  rect(c, x - 3, gg - 12, 2, 1, "#f4e6c8");
  rect(c, x + 20, gg - 13, 2, 2, "#fff2b0");
  rect(c, x - 22, gg - 13, 1, 3, "#ff4a3a");
  rect(c, x + 20, gg - 6, 3, 2, "#c8c4d0");
  rect(c, x - 23, gg - 6, 3, 2, "#c8c4d0");
  // arches and wheels (they don't bob)
  disc(c, x - 13, g - 4, 6, "#1e1a24", 0.6);
  disc(c, x + 13, g - 4, 6, "#1e1a24", 0.6);
  const spin = t / 50;
  wheel(c, x - 13, g - 4, 4, spin, TIRE, "#cfcbd6", "#5a5664");
  wheel(c, x + 13, g - 4, 4, spin + 0.7, TIRE, "#cfcbd6", "#5a5664");
}

// ---------- front ("down") and back ("up") views ----------
function endBike(c: Ctx, x: number, g: number, t: number, rider: HTMLCanvasElement, front: boolean, pl: Pillion | null): void {
  shadow(c, x, g, 7);
  const a = t / 140;
  const p = Math.max(0, Math.round(Math.sin(a) * 2));
  const q = Math.max(0, Math.round(-Math.sin(a) * 2));
  const bars = () => {
    rect(c, x - 8, g - 22, 17, 1, INK);
    rect(c, x - 9, g - 22, 2, 2, "#6a4a34");
    rect(c, x + 8, g - 22, 2, 2, "#6a4a34");
    rect(c, x, g - 22, 1, 4, BIKE);
  };
  if (!front) bars();
  // v18.13: from the front the rack passenger peeks over the rider's shoulder, sitting sideways
  if (pl && front) upperBody(c, pl.right, { x: x - 4, y: g - 20 });
  // the cranks and pedals under the feet
  rect(c, x - 5, g - 8 - p, 3, 1, TIRE);
  rect(c, x + 3, g - 8 - q, 3, 1, TIRE);
  wholeRider(c, rider, x, g - 17, [p, q], 1);
  if (front) {
    bars();
    rect(c, x - 2, g - 14, 1, 8, BIKE);
    rect(c, x + 2, g - 14, 1, 8, BIKE);
    rect(c, x - 4, g - 19, 9, 5, "#b8864a");
    rect(c, x - 4, g - 19, 9, 1, "#d8a868");
    for (let k = -3; k <= 3; k += 2) px(c, x + k, g - 17, "#8a5e30");
    px(c, x - 2, g - 20, "#f07aa0"); px(c, x, g - 21, "#ffe07a"); px(c, x + 2, g - 20, "#f07aa0");
    edgeWheel(c, x, g - 12, 12, t);
    rect(c, x - 2, g - 13, 5, 1, CREAM);
    px(c, x, g - 14, "#ffe8a0");
  } else {
    rect(c, x - 3, g - 16, 7, 2, METAL);
    rect(c, x - 3, g - 16, 7, 1, "#a8a4b4");
    edgeWheel(c, x, g - 12, 12, t);
    rect(c, x - 2, g - 13, 5, 1, CREAM);
    rect(c, x - 1, g - 11, 3, 2, "#e0403a");
    // v18.13: from behind the rack passenger is nearest, legs hanging over the side
    if (pl) sideSaddle(c, pl.up, { x: x + 5, y: g - 13 }, 4);
  }
}

function endMoto(c: Ctx, x: number, g: number, t: number, rider: HTMLCanvasElement, front: boolean, anim: boolean, p: Pillion | null): void {
  const sy = anim ? Math.floor(t / 40) % 2 : 0;
  const gg = g - sy;
  shadow(c, x, g, 10);
  if (anim && front) for (let i = 0; i < 3; i++) {
    const age = ((t + i * 180) % 540) / 540;
    puff(c, x - 8 - age * 3, g - 9 - age * 6, 1 + age, "rgba(206,200,214,A)", 0.6 * (1 - age));
  }
  const bars = () => {
    rect(c, x - 9, gg - 21, 19, 2, MOTO);
    rect(c, x - 9, gg - 21, 19, 1, MOTO_HI);
    rect(c, x - 10, gg - 21, 2, 2, INK);
    rect(c, x + 9, gg - 21, 2, 2, INK);
    line(c, x - 7, gg - 21, x - 8, gg - 25, METAL);
    line(c, x + 7, gg - 21, x + 8, gg - 25, METAL);
    rect(c, x - 10, gg - 27, 3, 2, "#c8c4d0");
    rect(c, x + 7, gg - 27, 3, 2, "#c8c4d0");
  };
  if (!front) bars();
  // the floorboard's flanks, the feet rest on them
  rect(c, x - 11, gg - 7, 23, 3, MOTO_SH);
  rect(c, x - 11, gg - 7, 23, 1, MOTO);
  // v18.13: from the front the pillion passenger shows over the rider's shoulder
  if (p && front) upperBody(c, p.down, { x: x - 4, y: gg - 18 });
  wholeRider(c, rider, x, gg - 15, [0, 0], 3);
  if (front) {
    // the leg shield, rounded at the top, with the lamp and indicators
    for (let j = 0; j < 16; j++) {
      const half = j < 3 ? 3 + j : j > 13 ? 5 - (j - 13) : 5;
      rect(c, x - half, gg - 21 + j, half * 2 + 1, 1, j === 0 ? MOTO_HI : MOTO);
      px(c, x - half, gg - 21 + j, j < 13 ? MOTO_HI : MOTO_SH);
    }
    bars();
    disc(c, x, gg - 17, 1, "#fff2b8");
    px(c, x, gg - 18, "#ffffff");
    px(c, x - 5, gg - 19, "#f0a030"); px(c, x + 5, gg - 19, "#f0a030");
    edgeWheel(c, x, g - 6, 6, t);
    rect(c, x - 2, gg - 7, 5, 2, MOTO);
  } else {
    if (anim) for (let i = 0; i < 3; i++) {
      const age = ((t + i * 180) % 540) / 540;
      puff(c, x + 8 + age * 3, g - 4 - age * 5, 1 + age, "rgba(206,200,214,A)", 0.7 * (1 - age));
    }
    rect(c, x + 5, gg - 5, 3, 2, METAL);
    for (let j = 0; j < 11; j++) {
      const half = j < 2 ? 5 + j : j > 8 ? 6 - (j - 8) : 7;
      rect(c, x - half, gg - 16 + j, half * 2 + 1, 1, j === 0 ? MOTO_HI : j > 8 ? MOTO_SH : MOTO);
    }
    rect(c, x - 2, gg - 13, 5, 2, "#e0403a");
    px(c, x - 1, gg - 13, "#ff8a7a");
    rect(c, x - 2, gg - 9, 5, 2, "#f4e6c8");
    edgeWheel(c, x, g - 6, 6, t);
    // v18.13: from behind the pillion passenger is nearest, knees out over the pegs
    if (p) wholeRider(c, p.up, x + 6, gg - 12, [0, 0], 3);
  }
}
function endCar(c: Ctx, x: number, g: number, t: number, rider: HTMLCanvasElement, front: boolean, anim: boolean, p: Pillion | null): void {
  shadow(c, x, g, 18);
  if (anim) for (let i = 0; i < 4; i++) {
    const age = ((t + i * 120) % 480) / 480;
    const s = i % 2 === 0 ? -1 : 1;
    puff(c, x + s * (15 + age * 5), g - 2 - age * (front ? 9 : 4), 1 + age * 2, "rgba(200,164,122,A)", 0.55 * (1 - age));
  }
  const bob = anim && Math.floor(t / 90) % 3 === 0 ? -1 : 0;
  const gg = g + bob;
  // the driver sits on the car's left: the viewer's right from the front, the viewer's left from behind
  const dx = front ? x + 6 : x - 6;
  const screen = () => {
    rect(c, x - 13, gg - 20, 27, 7, "rgba(180,215,255,0.38)");
    rect(c, x - 13, gg - 21, 27, 1, "#c8c4d0");
    rect(c, x - 14, gg - 21, 1, 8, "#c8c4d0");
    rect(c, x + 14, gg - 21, 1, 8, "#c8c4d0");
    for (let k = 0; k < 4; k++) px(c, x - 10 + k, gg - 19 + k, "rgba(240,248,255,0.7)");
  };
  if (!front) screen();
  // seat backs (the driver's behind the driver from the front)
  if (front) { rect(c, x - 10, gg - 18, 7, 5, "#5a3430"); rect(c, x - 10, gg - 18, 7, 1, "#7a4a42"); }
  upper(c, rider, dx, gg - 8);
  // v18.13: the passenger in the other seat
  if (p) upperBody(c, front ? p.down : p.up, { x: front ? x - 6 : x + 6, y: gg - 8 });
  if (front) {
    screen();
    rect(c, dx - 3, gg - 15, 7, 1, INK);
  } else {
    for (const sx of [x - 10, x + 3]) { rect(c, sx, gg - 17, 8, 4, "#5a3430"); rect(c, sx, gg - 17, 8, 1, "#7a4a42"); }
  }
  // the body
  for (let j = 0; j < 12; j++) {
    const inset = j === 0 ? 2 : j === 1 ? 1 : j === 11 ? 1 : 0;
    rect(c, x - 17 + inset, gg - 14 + j, 35 - inset * 2, 1, j === 0 ? CAR_HI : j > 8 ? CAR_SH : CAR);
  }
  rect(c, x - 18, gg - 13, 1, 2, INK);
  rect(c, x + 18, gg - 13, 1, 2, INK);
  if (front) {
    rect(c, x - 5, gg - 10, 11, 4, "#3a2a2e");
    for (let k = 0; k < 11; k += 2) rect(c, x - 5 + k, gg - 10, 1, 4, "#8a6a64");
    disc(c, x - 12, gg - 9, 2, "#fff2b0");
    disc(c, x + 12, gg - 9, 2, "#fff2b0");
    px(c, x - 13, gg - 10, "#ffffff"); px(c, x + 11, gg - 10, "#ffffff");
  } else {
    rect(c, x - 16, gg - 11, 4, 2, "#ff4a3a");
    rect(c, x + 13, gg - 11, 4, 2, "#ff4a3a");
    px(c, x - 16, gg - 11, "#ff9a8a"); px(c, x + 13, gg - 11, "#ff9a8a");
    rect(c, x - 1, gg - 5, 3, 1, METAL);
  }
  rect(c, x - 17, gg - 4, 35, 2, "#c8c4d0");
  rect(c, x - 3, gg - 5, 7, 2, "#f4e6c8");
  rect(c, x - 2, gg - 5, 5, 1, "#8a8494");
  rect(c, x - 16, g - 3, 4, 3, TIRE);
  rect(c, x + 13, g - 3, 4, 3, TIRE);
}
