import * as THREE from "three";
import { martialById } from "@/lib/game/fight/dojo";
import type { Look } from "@/lib/game/types";
import { ChibiFactory } from "./build";
import type { Pose } from "./pose";
import { ChibiRig } from "./rig";
import { chibiSpec } from "./spec";
import { addVoxelLights } from "./voxel-material";

// Browser only: the 3D view of the Võ đài previews (dojo stances and specials, the kata master, the ready screen).
// ONE shared WebGL renderer draws every preview's frame and copies it onto the preview's own 2D canvas, so a dojo
// page with dozens of previews still holds a single GL context; chibis are cached per look (low detail, ≤ 16).

const W = 144, H = 192;
let shared: { r: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.PerspectiveCamera; f: ChibiFactory; rigs: Map<string, ChibiRig> } | null = null;

function ctx() {
  if (shared) return shared;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true });
  const scene = new THREE.Scene();
  addVoxelLights(scene, 2);
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 50);
  cam.position.set(0, 1.15, 4.6);
  cam.lookAt(0, 0.85, 0);
  shared = { r, scene, cam, f: new ChibiFactory(16), rigs: new Map() };
  return shared;
}

/** A fighter's look in the fight: the style's võ phục in the rank's belt, no hat (as the 2D chibi painter). */
export function fightLook(look: Look, style: number, rank: number): Look {
  const m = martialById(style);
  return { ...look, hat: null, ...(m ? { outfit: m.uniform, belt: Math.max(0, Math.min(4, Math.trunc(rank))) } : {}) };
}

/** Draws one frame of the fighter (seen from its near side, 3/4) onto `out`. */
export function drawFight3D(out: HTMLCanvasElement, look: Look, pose: Pose, flip = false): void {
  const s = ctx();
  const spec = chibiSpec(look);
  let rig = s.rigs.get(`low|${spec.key}`);
  if (!rig) {
    if (s.rigs.size >= 16) {
      const [k0, r0] = s.rigs.entries().next().value as [string, ChibiRig];
      r0.detach(); s.rigs.delete(k0); s.f.release(k0);
    }
    rig = new ChibiRig();
    const got = s.f.acquire(spec, "low");
    rig.setParts(got.parts);
    s.rigs.set(got.key, rig);
  }
  rig.root.rotation.y = (flip ? -1 : 1) * (Math.PI / 2 - 0.5);
  rig.apply(pose);
  s.scene.add(rig.root);
  s.r.render(s.scene, s.cam);
  s.scene.remove(rig.root);
  const g = out.getContext("2d");
  if (!g) return;
  g.clearRect(0, 0, out.width, out.height);
  g.drawImage(s.r.domElement, 0, 0, out.width, out.height);
}
