import * as THREE from "three";
import { ModelMats, Paint } from "../world/models";
import type { CharAct } from "./pose";

// Browser only: what a chibi holds or works at for wave 3's acts (pose-extra.ts) — the smith's hammer and the anvil,
// the long spoon and the cauldron on its fire, the nia of grain, the camera, a fan of cards, the deck. Toon vertex
// colours with the creatures' one-draw-call ink outline (the chibis' black line). Each kind is built once and shared
// (one mesh per prop on a rig). Units: 1 = 16 px; +z is the chibi's forward.

export type HeldKind = "hammer" | "anvil" | "spoon" | "cauldron" | "nia" | "camera" | "cards" | "deck" | "card_table";
/** Where a prop goes: in the right / left fist (the forearm's end; −y runs on along the forearm) or on the ground
 *  in front of the feet (the rig's root). */
export type HeldSlot = "handR" | "handL" | "ground";

/** Per act: the props and where they sit. */
export const HELD_BY_ACT: Partial<Record<CharAct, ReadonlyArray<{ kind: HeldKind; slot: HeldSlot }>>> = {
  hammer: [{ kind: "hammer", slot: "handR" }, { kind: "anvil", slot: "ground" }],
  stir: [{ kind: "spoon", slot: "handR" }, { kind: "cauldron", slot: "ground" }],
  sort: [{ kind: "nia", slot: "handR" }],
  camera_up: [{ kind: "camera", slot: "handR" }],
  card_hold: [{ kind: "cards", slot: "handL" }],
  card_play: [{ kind: "cards", slot: "handL" }],
  card_deal: [{ kind: "deck", slot: "handL" }],
};

let shared: ModelMats | null = null;
/** The props' materials (shared by every rig, never disposed: a few small geometries). */
export function heldMats(): ModelMats {
  return (shared ??= new ModelMats());
}

const cache = new Map<HeldKind, THREE.BufferGeometry>();
const cyl = (r0: number, r1: number, h: number, n = 10) => new THREE.CylinderGeometry(r0, r1, h, n);

/** The prop's merged geometry (outlined), in its slot's frame. */
function geometry(kind: HeldKind): THREE.BufferGeometry {
  const hit = cache.get(kind);
  if (hit) return hit;
  const p = new Paint(0.05);
  switch (kind) {
    case "hammer":
      // the handle out of the fist (forward, along +z), the iron head across its end
      p.add(cyl(0.035, 0.04, 0.5, 6), 0x8a5a32, 0, 0, 0.2, Math.PI / 2)
        .box(0.12, 0.13, 0.26, 0x4a4c54, 0, 0, 0.46, 0, 0, 0).box(0.13, 0.14, 0.05, 0x6a6e78, 0, 0, 0.6);
      break;
    case "anvil":
      // the block on its stump: a wooden stump, the waist, the face with a horn pointing left, a glowing billet on it
      p.add(cyl(0.24, 0.27, 0.34, 10), 0x7a4e2c, 0, 0.17, 0)
        .box(0.22, 0.12, 0.2, 0x3a3c44, 0, 0.4, 0).box(0.42, 0.12, 0.24, 0x4a4c54, 0, 0.52, 0)
        .add(new THREE.ConeGeometry(0.09, 0.22, 6), 0x4a4c54, -0.31, 0.53, 0, 0, 0, Math.PI / 2)
        .box(0.2, 0.04, 0.06, 0xff8a3a, 0.04, 0.6, 0.02);
      break;
    case "spoon":
      // a long wooden spoon down out of the fist into the pot
      p.add(cyl(0.025, 0.025, 0.8, 6), 0xa8743f, 0, -0.32, 0).add(new THREE.SphereGeometry(0.07, 8, 5), 0x8b5a33, 0, -0.74, 0, 0, 0, 0, 1, 0.5, 1.2);
      break;
    case "cauldron":
      // the round iron pot on three stones over the fire, a green brew inside
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        p.add(new THREE.DodecahedronGeometry(0.1), 0x8a8478, Math.cos(a) * 0.3, 0.08, Math.sin(a) * 0.3);
      }
      p.add(new THREE.ConeGeometry(0.16, 0.22, 6), 0xff8a2a, 0, 0.12, 0).add(new THREE.ConeGeometry(0.08, 0.16, 5), 0xffd04a, 0, 0.12, 0)
        .add(new THREE.SphereGeometry(0.34, 12, 8, 0, Math.PI * 2, Math.PI * 0.3, Math.PI * 0.7), 0x2e2c30, 0, 0.5, 0)
        .add(new THREE.TorusGeometry(0.29, 0.035, 5, 14), 0x3e3c42, 0, 0.62, 0, Math.PI / 2)
        .add(cyl(0.27, 0.27, 0.02, 14), 0x6ac04a, 0, 0.6, 0);
      break;
    case "nia":
      // the round bamboo tray with grains (gold) and a few pebbles (grey)
      p.add(cyl(0.3, 0.26, 0.06, 14), 0xd2a866, 0, 0, 0).add(new THREE.TorusGeometry(0.3, 0.025, 4, 16), 0x9a7440, 0, 0.03, 0, Math.PI / 2);
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4, r = 0.06 + (i % 3) * 0.07;
        p.box(0.05, 0.03, 0.03, i % 4 === 0 ? 0x7d766e : 0xe9c46a, Math.cos(a) * r, 0.045, Math.sin(a) * r, 0, a);
      }
      break;
    case "camera":
      // a compact camera: the body, the lens toward +z (away from the face), the flash and the strap loop
      p.box(0.36, 0.22, 0.12, 0xc8ccd4, 0, 0, 0).add(cyl(0.065, 0.07, 0.1, 10), 0x4a4a54, 0.03, 0, 0.09, Math.PI / 2)
        .add(cyl(0.045, 0.045, 0.02, 10), 0x8ac4e0, 0.03, 0, 0.145, Math.PI / 2)
        .box(0.06, 0.04, 0.02, 0xf4f4ea, -0.1, 0.06, 0.055).box(0.05, 0.03, 0.06, 0xd04a3a, 0.1, 0.1, 0);
      break;
    case "cards":
      // five cards fanned, faces toward the holder (−z)
      for (let i = 0; i < 5; i++) p.box(0.17, 0.24, 0.008, i % 2 ? 0xfaf6ec : 0xf4f0e4, 0, 0.07, 0.004 * i, 0, 0, (i - 2) * 0.28);
      p.box(0.03, 0.03, 0.008, 0xd03a3a, 0, 0.13, 0.03);
      break;
    case "deck":
      p.box(0.12, 0.05, 0.17, 0xf4f0e4, 0, 0, 0).box(0.11, 0.01, 0.16, 0x2e5aa8, 0, 0.026, 0);
      break;
    case "card_table":
      // a low round table with a green felt, a few cards in the middle (for the review sheet)
      p.add(cyl(0.55, 0.55, 0.06, 18), 0x6e4a28, 0, 0.62, 0).add(cyl(0.5, 0.5, 0.01, 18), 0x2e7a4a, 0, 0.655, 0)
        .add(cyl(0.06, 0.1, 0.6, 8), 0x5a381e, 0, 0.3, 0).add(cyl(0.3, 0.3, 0.04, 12), 0x5a381e, 0, 0.02, 0)
        .box(0.12, 0.006, 0.17, 0xfaf6ec, 0.05, 0.665, 0, 0, 0.4).box(0.12, 0.006, 0.17, 0xfaf6ec, -0.08, 0.665, 0.05, 0, -0.3);
      break;
  }
  const g = p.geometry(true);
  cache.set(kind, g);
  return g;
}

/** Where each prop sits in its slot (position, rotation): tuned against the review sheet. */
const PLACE: Record<HeldKind, [number, number, number, number, number, number]> = {
  hammer: [0, -0.04, 0.02, 0.9, 0, 0],
  anvil: [0.12, 0, 0.5, 0, 0, 0],
  spoon: [0, -0.02, 0.02, 1.4, 0, 0],
  cauldron: [0, 0, 0.72, 0, 0, 0],
  nia: [-0.16, -0.1, 0.02, 1.57, 0, 0],
  camera: [-0.17, -0.08, 0.1, 0.2, 0, 0],
  cards: [0, -0.06, 0.06, -0.6, 0, 0],
  deck: [0, -0.06, 0.05, 0.5, 0, 0],
  card_table: [0, 0, 0.75, 0, 0, 0],
};

/** A new mesh of a prop (sharing the kind's geometry and the shared outlined material). */
export function heldMesh(kind: HeldKind): THREE.Mesh {
  const m = new THREE.Mesh(geometry(kind), heldMats().creature);
  const [x, y, z, rx, ry, rz] = PLACE[kind];
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.name = `held:${kind}`;
  return m;
}

/** The slots a rig exposes (rig.ts's hand and ground groups). */
export interface HeldSlots { handR: THREE.Object3D; handL: THREE.Object3D; ground: THREE.Object3D }

/** Shows the props of `act` in a rig's slots (removing the previous act's); returns the act's key to compare next. */
export function setHeld(slots: HeldSlots, act: CharAct | null): void {
  for (const s of [slots.handR, slots.handL, slots.ground]) {
    for (const c of [...s.children]) if (c.name.startsWith("held:")) s.remove(c);
  }
  for (const h of (act && HELD_BY_ACT[act]) || []) slots[h.slot].add(heldMesh(h.kind));
}
