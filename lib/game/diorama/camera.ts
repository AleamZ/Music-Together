import type { CameraMode } from "./types";

// Pure camera math (no Three): where each mode wants the eye and the look-at point, and the smoothing between them.
// Axes as in coords.ts: x right, y up, z towards the viewer (the 2D map's "down").

export interface V3 { x: number; y: number; z: number }

export interface Orbit {
  /** Around the vertical axis; 0 = looking north from the south (the 2D map's view). */
  yaw: number;
  /** Above the horizon (radians). */
  pitch: number;
  distance: number;
}

export const FOLLOW_ORBIT: Orbit = { yaw: 0, pitch: 0.92, distance: 19 };
export const OVERVIEW_ORBIT: Orbit = { yaw: -0.35, pitch: 0.72, distance: 50 };
export const LIMITS = { pitchMin: 0.25, pitchMax: 1.45, distMin: 6, distMax: 90 };

/** The eye of an orbit around `target`. */
export function orbitEye(target: V3, o: Orbit): V3 {
  const c = Math.cos(o.pitch);
  return {
    x: target.x + Math.sin(o.yaw) * c * o.distance,
    y: target.y + Math.sin(o.pitch) * o.distance,
    z: target.z + Math.cos(o.yaw) * c * o.distance,
  };
}

export function clampOrbit(o: Orbit): Orbit {
  return {
    yaw: o.yaw,
    pitch: Math.min(LIMITS.pitchMax, Math.max(LIMITS.pitchMin, o.pitch)),
    distance: Math.min(LIMITS.distMax, Math.max(LIMITS.distMin, o.distance)),
  };
}

/** Frame-rate independent exponential approach: the fraction of the gap to close this frame. */
export function smoothK(dtSec: number, rate: number): number {
  return 1 - Math.exp(-Math.max(0, dtSec) * rate);
}

export function lerp3(a: V3, b: V3, k: number): V3 {
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
}

/** The free-fly camera: a position and a heading (yaw, pitch), moved by WASD/Space/C (Shift: faster). */
export interface FlyState { pos: V3; yaw: number; pitch: number }
export interface FlyKeys { fwd: number; right: number; up: number; fast: boolean }

/** The direction the fly camera looks. yaw 0, pitch 0 looks north (−z). */
export function flyForward(s: FlyState): V3 {
  const c = Math.cos(s.pitch);
  return { x: -Math.sin(s.yaw) * c, y: Math.sin(s.pitch), z: -Math.cos(s.yaw) * c };
}

export function stepFly(s: FlyState, k: FlyKeys, dtSec: number): FlyState {
  const speed = (k.fast ? 30 : 10) * dtSec;
  const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);                   // on the ground plane
  const rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
  return {
    ...s,
    pos: {
      x: s.pos.x + (fx * k.fwd + rx * k.right) * speed,
      y: Math.max(0.5, s.pos.y + k.up * speed),
      z: s.pos.z + (fz * k.fwd + rz * k.right) * speed,
    },
  };
}

/** A fly camera placed where an orbit's eye is, looking at its target. */
export function flyFromOrbit(target: V3, o: Orbit): FlyState {
  return { pos: orbitEye(target, o), yaw: o.yaw, pitch: -o.pitch };
}

export const CAMERA_MODES: readonly CameraMode[] = ["follow", "overview", "free"];
