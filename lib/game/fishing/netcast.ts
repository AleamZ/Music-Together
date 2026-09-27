import type { NetCast, NetCode } from "@/lib/game/net/protocol";
import type { Facing, Vec } from "@/lib/game/types";
import { NET, SCENE, type Pt } from "./net";

// v18.2 Quăng lưới, seen by everyone: the phase of a throw and where the net lies, relative to the thrower's feet, as
// the `n` of an `fs` message; and what a phase looks like `since` ms after it began (the others animate from their own
// clock). Pure.

export type NetShow = "aim" | "charge" | "throw" | "sunk" | "pull" | "won";
export const NET_CODE: Record<NetShow, NetCode> = { aim: 1, charge: 2, throw: 3, sunk: 4, pull: 5, won: 6 };
const FROM_CODE: Record<NetCode, NetShow> = { 1: "aim", 2: "charge", 3: "throw", 4: "sunk", 5: "pull", 6: "won" };

/** A throw as the world draws it: `dx`/`dy` = the net's centre from the feet (world px), `r` its radius, `k` the fish
 *  held up (won only). */
export interface NetState { show: NetShow; dx: number; dy: number; r: number; k: number }

/** How far the net may lie from the feet (world px), and its largest radius. */
export const NET_REACH = 120;
export const NET_MAX_R = 40;
/** How long the dripping bundle is held up after a won pull. */
export const NET_WON_MS = 2000;
/** A throw silent for this long is dropped (covers a lost clearing `fs`). */
export const NET_STALE_MS = 60_000;

const FWD: Record<Facing, Vec> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
/** The thrower's right hand side (the overlay's scene is seen from behind). */
const RIGHT: Record<Facing, Vec> = { up: { x: 1, y: 0 }, down: { x: -1, y: 0 }, left: { x: 0, y: -1 }, right: { x: 0, y: 1 } };
/** Facing up the net must clear the thrower's own 48-px sprite. */
const BASE: Record<Facing, number> = { up: 44, down: 20, left: 22, right: 22 };

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

/** A scene point (the overlay) → the net's offset from the feet in the world. */
export function sceneToOffset(p: Pt, facing: Facing): Vec {
  const fwd = BASE[facing] + Math.max(0, SCENE.hands.y - p.y) * 0.9;
  const side = (p.x - SCENE.hands.x) * 0.8;
  const f = FWD[facing], s = RIGHT[facing];
  return { x: clampInt(f.x * fwd + s.x * side, -NET_REACH, NET_REACH), y: clampInt(f.y * fwd + s.y * side, -NET_REACH, NET_REACH) };
}

/** The resting offset while aiming (straight ahead, mid range). */
export function aimOffset(facing: Facing): Vec {
  return sceneToOffset({ x: SCENE.hands.x, y: SCENE.hands.y - SCENE.range / 2 }, facing);
}

/** The overlay's ring radius → world px. */
export function worldRadius(sceneR: number): number {
  return clampInt(sceneR * 1.1, 4, NET_MAX_R);
}

/** The facing from `from` towards `to` (the larger axis wins). */
export function facingTowards(from: Vec, to: Vec): Facing {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "up" : "down";
}

/** What the minigame reports: the phase, and at the throw the landing point and ring radius (scene px); at won the
 *  fish count. */
export interface NetInput { show: NetShow; scene?: Pt; sceneR?: number; k?: number }

/** The next throw state: a new landing point replaces the target, later phases keep it; aiming points straight ahead. */
export function nextNet(prev: NetState | null, inp: NetInput, facing: Facing): NetState {
  const keep = prev && prev.show !== "aim" && prev.show !== "charge";
  const off = inp.scene ? sceneToOffset(inp.scene, facing) : keep ? { x: prev.dx, y: prev.dy } : aimOffset(facing);
  const r = inp.sceneR !== undefined ? worldRadius(inp.sceneR) : keep ? prev.r : 0;
  return { show: inp.show, dx: off.x, dy: off.y, r, k: Math.max(0, Math.min(9, Math.round(inp.k ?? 0))) };
}

export function encodeNet(s: NetState): NetCast {
  return [NET_CODE[s.show], clampInt(s.dx, -NET_REACH, NET_REACH), clampInt(s.dy, -NET_REACH, NET_REACH), clampInt(s.r, 0, NET_MAX_R), clampInt(s.k, 0, 9)];
}

export function decodeNet(n: NetCast): NetState {
  return { show: FROM_CODE[n[0]], dx: n[1], dy: n[2], r: n[3], k: n[4] };
}

/** Is a throw that entered `show` `since` ms ago still drawn? (won lasts NET_WON_MS; anything NET_STALE_MS.) */
export function netAlive(show: NetShow, since: number): boolean {
  return show === "won" ? since < NET_WON_MS : since < NET_STALE_MS;
}

/** The frame to draw: where the net is (0 at the hands … 1 at the target) and how open, the wind-up and the lean. */
export interface NetFrame {
  /** Throw only: the flight, 0 … 1. */
  flight: number;
  /** Pull only: how far the ring has come in, 0 … 0.7. */
  drawn: number;
  /** Charge only: the wind-up, 0 … 1 (a swell like the power bar). */
  wind: number;
  /** Pull: the body leans back this many px (0 … 2). */
  lean: number;
}

export function netFrame(show: NetShow, since: number, reduced: boolean): NetFrame {
  const s = Math.max(0, since);
  const t = reduced ? 0 : s;
  return {
    flight: show === "throw" ? Math.min(1, s / NET.flightMs) : show === "sunk" || show === "pull" ? 1 : 0,
    drawn: show === "pull" ? 0.7 * (1 - Math.exp(-s / 5000)) : 0,
    wind: show === "charge" ? (reduced ? 1 : (1 - Math.cos((2 * Math.PI * s) / NET.periodMs)) / 2) : 0,
    lean: show === "pull" ? (reduced ? 1 : 1 + Math.round((Math.sin(t / 160) + 1) / 2)) : 0,
  };
}
