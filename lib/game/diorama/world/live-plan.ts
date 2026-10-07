import type { PetLook3D } from "./pet-looks";
import type { PetSpecies } from "@/lib/game/pets/catalog";
import type { BossId, WildSpeciesId } from "@/lib/game/realm/model";
import type { Roof } from "@/lib/game/housing/lot";
import { bobberPoint } from "@/lib/game/fishing/geometry";
import type { DioramaFrame, GameplayFrame } from "../types";

// The world's live things in 3D — pure part: what the engine hands the view (world px, like the billboards), and the
// small kinematics the models use (gaits, heading smoothing, the boat's wake, leaping fish, seats on vehicles). No
// three.js here: tests run it in node.

export type VehicleKind = "bike" | "moto" | "car";

export interface LiveStall { id: string; x: number; y: number; /** "player": a player's own stall (their name on it). */ owner: "npc" | "player"; name?: string | null; /** Awning colour. */ color?: number; /** 0…1: how full the table is. */ goods?: number }
export interface LiveRing { id: string; x: number; y: number; /** Radius, px. */ r: number; label: string; /** A fight is on. */ active: boolean }
export interface LiveTelegraph { shape: "circle" | "line"; x: number; y: number; /** Radius (circle) or half-width (line), px. */ r: number; /** line: its length (px) and direction (radians, 0 = +x). */ len?: number; dir?: number; /** 0 → 1 as it winds up. */ k: number }
export interface LiveBoss { id: string; kind: BossId; x: number; y: number; /** 0…1 */ hp: number; name: string; facing?: number; telegraphs?: LiveTelegraph[]; /** The arena's rect (world px) while a fight is on. */ arena?: { x: number; y: number; w: number; h: number } }
export interface LiveAnimal { id: string; species: WildSpeciesId; x: number; y: number; fleeing?: boolean }
export interface LiveHouse { /** LOTS index (Khu nhà). */ lot: number; owned: boolean; built: boolean; roof: Roof; ownerName?: string | null; mine?: boolean }
export interface LiveBoat { id: string; x: number; y: number; /** The rower's billboard id (the chibi rides in it). */ riderId?: string | null }
export interface LiveDig { id: string; x: number; y: number; state: "hint" | "dug" }
/** 0123: a hunter's trap set in the forest (world px): wood or iron, and whether something may be in it by now. */
export interface LiveTrap { id: string; x: number; y: number; iron: boolean; ready: boolean }
export interface LiveFishing { id: string; x: number; y: number; /** 0…1 how hard the fish pulls. */ tension: number; /** A fish is on. */ hooked: boolean }
export interface LivePet { id: string; ownerId: string; species: PetSpecies; x: number; y: number; look?: PetLook3D }
export interface LiveVehicle { riderId: string; kind: VehicleKind; color?: number }
export interface LiveGate { id: string; x: number; y: number; /** The road's direction across the gate (radians, 0 = +x). */ dir: number; /** Width, px. */ w: number; open: boolean; guard: boolean }
export interface LiveCritter { id: string; x: number; y: number; /** A rat knocked over (on its side). */ fallen?: boolean }
export interface LiveDog extends LiveCritter { coat?: "vang" | "muc" | "ven" | "dom" }
/** A fish in the air (the engine's pond leaps): where, and how high (0…1 of its arc). */
export interface LiveLeap { x: number; y: number; h: number }

/** Everything live the world draws besides the people. Every list is optional (absent = none). */
export interface WorldLive {
  stalls?: LiveStall[];
  rings?: LiveRing[];
  bosses?: LiveBoss[];
  animals?: LiveAnimal[];
  houses?: LiveHouse[];
  boats?: LiveBoat[];
  digs?: LiveDig[];
  /** 0123: my traps. */
  traps?: LiveTrap[];
  fishing?: LiveFishing[];
  pets?: LivePet[];
  vehicles?: LiveVehicle[];
  gates?: LiveGate[];
  dogs?: LiveDog[];
  rats?: LiveCritter[];
  leaps?: LiveLeap[];
  /** Net throws (quăng lưới): the thrower, the phase and its age (ms), the net's centre (world px) and radius (px). */
  nets?: LiveNet[];
  /** 0117: the ổ thính on the water (world px): a tinted patch 48 px round, bubbles, a label. */
  groundbait?: LiveGroundbait[];
}
export interface LiveGroundbait { id: number; x: number; y: number; /** 0xrrggbb */ color: number; stacks: number; label: string }
export interface LiveNet { id: string; throwerId: string; show: "aim" | "charge" | "throw" | "sunk" | "pull" | "won"; since: number; x: number; y: number; cx: number; cy: number; r: number; k: number }

/** How far up a rider sits on a vehicle (units above the ground under the vehicle; the "ride" pose's hips are at 0.6). */
export const SEAT_LIFT: Readonly<Record<VehicleKind, number>> = { bike: 0.32, moto: 0.3, car: -0.08 };

/** A walking gait from the speed (px/s): the leg swing's frequency (Hz) and amplitude (radians). */
export function gait(speedPxS: number, fleeing = false): { freq: number; amp: number } {
  if (speedPxS < 2) return { freq: 0, amp: 0 };
  const k = Math.min(1, speedPxS / (fleeing ? 140 : 90));
  return { freq: 1.4 + k * (fleeing ? 4.2 : 2.6), amp: 0.25 + k * (fleeing ? 0.6 : 0.4) };
}

/** Turn `from` toward `to` (radians) at most `rate`·dt, the short way round. */
export function turnTo(from: number, to: number, dt: number, rate = 6): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  const step = rate * dt;
  return Math.abs(d) <= step ? to : from + Math.sign(d) * step;
}

/** A moving thing's smoothed speed (px/s) and heading (radians, three's yaw: atan2(dx, dy)) from one step. */
export interface Motion { x: number; y: number; speed: number; yaw: number; phase: number }
export function stepMotion(m: Motion | null, x: number, y: number, dt: number, fleeing = false): Motion {
  if (!m) return { x, y, speed: 0, yaw: 0, phase: 0 };
  const dx = x - m.x, dy = y - m.y, d = Math.hypot(dx, dy);
  if (d > 120) return { x, y, speed: 0, yaw: m.yaw, phase: m.phase };                       // a jump, not a sprint
  const speed = dt > 0 ? m.speed + (d / dt - m.speed) * Math.min(1, dt * 8) : m.speed;
  const yaw = d > 0.2 ? turnTo(m.yaw, Math.atan2(dx, dy), dt, fleeing ? 10 : 6) : m.yaw;
  return { x, y, speed, yaw, phase: m.phase + dt * gait(speed, fleeing).freq * Math.PI * 2 };
}

/** The boat's wake: points dropped every `gap` px behind it, each fading over `life` ms; oldest first. */
export interface WakePoint { x: number; y: number; t: number; yaw: number }
export function pushWake(trail: WakePoint[], x: number, y: number, yaw: number, t: number, gap = 10, life = 2600, max = 40): WakePoint[] {
  const out = trail.filter((p) => t - p.t < life);
  const last = out[out.length - 1];
  if (!last || Math.hypot(x - last.x, y - last.y) >= gap) out.push({ x, y, t, yaw });
  return out.length > max ? out.slice(out.length - max) : out;
}

/** A leaping fish: every `period` ms (per seed) one ~900 ms arc; null between leaps. `u` 0…1 along the arc, its
 *  height (units) and pitch (radians: nose up, then down). */
export function leap(t: number, seed: number, period = 7000): { u: number; h: number; pitch: number; n: number } | null {
  const p = period + (seed % 7) * 900, off = (seed * 7919) % p;
  const n = Math.floor((t + off) / p), local = (t + off) % p, dur = 900;
  if (local > dur) return null;
  const u = local / dur;
  return { u, h: 4 * u * (1 - u) * 1.1, pitch: (0.5 - u) * 2.2, n };
}

/** A deterministic 0…1 hash (seed, i). */
export function hash01(seed: number, i: number): number {
  let h = (seed * 374761393 + i * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Where a pet trails its owner when the engine gives no spot: behind and to the side, px. */
export function trailSpot(owner: { x: number; y: number }, yaw: number, slot = 0): { x: number; y: number } {
  const back = 22 + slot * 14, side = (slot % 2 ? -1 : 1) * 12;
  return { x: owner.x - Math.sin(yaw) * back + Math.cos(yaw) * side, y: owner.y - Math.cos(yaw) * back - Math.sin(yaw) * side };
}

/** A boss telegraph's look at wind-up k (0…1): its fill opacity and the inner ring's scale (fills in as it lands). */
export function telegraphLook(k: number, t: number): { opacity: number; fill: number } {
  const kk = Math.max(0, Math.min(1, k));
  return { opacity: 0.25 + 0.35 * kk + 0.1 * Math.sin(t / 90) * kk, fill: kk };
}

/** The frame's own live things (P3: Billboard.vehicle, DioramaFrame.gameplay) folded into a WorldLive, on top of what
 *  the engine set with WorldView.setLive (stalls, rings, bosses, animals, houses, digs, fishing, pets). */
export function liveFromFrame(f: Pick<DioramaFrame, "billboards" | "gameplay">, extra: WorldLive = {}): WorldLive {
  const vehicles: LiveVehicle[] = [...(extra.vehicles ?? [])], boats: LiveBoat[] = [...(extra.boats ?? [])];
  for (const b of f.billboards) {
    if (!b.vehicle) continue;
    if (b.vehicle === "boat") boats.push({ id: b.id, x: b.x, y: b.y, riderId: b.id });
    else vehicles.push({ riderId: b.id, kind: b.vehicle });
  }
  const g = f.gameplay;
  if (!g) return { ...extra, vehicles, boats };
  const gates: LiveGate[] = [...(extra.gates ?? [])];
  for (const gt of g.gates) {
    const r = gt.barrier;
    if (r) gates.push({ id: gt.id, x: r.x + r.w / 2, y: r.y + r.h / 2, w: Math.max(r.w, r.h), dir: r.h > r.w ? 0 : Math.PI / 2, open: false, guard: false });
    else gates.push({ id: gt.id, x: gt.at.x, y: gt.at.y - 14, w: 36, dir: Math.PI / 2, open: false, guard: false });
  }
  return {
    ...extra, vehicles, boats, gates,
    rats: [...(extra.rats ?? []), ...g.rats.map((r) => ({ id: r.key, x: r.x, y: r.y, fallen: r.fallen }))],
    dogs: [...(extra.dogs ?? []), ...g.dogs.map((d) => ({ id: d.id, x: d.x, y: d.y }))],
    leaps: [...(extra.leaps ?? []), ...g.leaps],
    // P4: the pets at their owners' heels and everyone's bobbers (mine and the others' from realtime)
    pets: [...(extra.pets ?? []), ...(g.pets ?? []).map((p) => ({ id: `pet:${p.ownerId}`, ownerId: p.ownerId, species: p.species, x: p.x, y: p.y, look: p.look }))],
    fishing: [...(extra.fishing ?? []), ...(g.anglers ?? []).map(castLive)],
    nets: [...(extra.nets ?? []), ...(g.nets ?? []).map((n) => ({ ...n, id: `net:${n.id}`, throwerId: n.id }))],
    groundbait: [...(extra.groundbait ?? []), ...(g.groundbait ?? [])],                                       // 0117
  };
}

/** P4: an angler's bobber: out in front of the feet (the 2D bobberPoint), a fish on from the bite, pulling hard reeling. */
export function castLive(a: NonNullable<GameplayFrame["anglers"]>[number]): LiveFishing {
  const p = bobberPoint(a, a.facing);
  return { id: `cast:${a.id}`, x: p.x, y: p.y, hooked: a.phase >= 2, tension: a.phase === 3 ? 0.9 : a.phase === 2 ? 0.4 : 0 };
}