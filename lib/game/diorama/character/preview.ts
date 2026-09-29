import * as THREE from "three";
import type { Look } from "@/lib/game/types";
import { ChibiFactory } from "./build";
import { poseAt, type CharAct } from "./pose";
import { ChibiRig } from "./rig";
import { chibiSpec } from "./spec";
import { addVoxelLights } from "./voxel-material";

// Browser only: a small, self-contained live 3D preview of one character on a canvas (the wardrobe's "Dáng người"
// tab, the character creator): drag (mouse or touch) to turn it, it idles (or plays `act`), `setLook` swaps the look
// (rebuilt once per look, cached). Call `dispose` on unmount.

export interface ChibiPreview {
  setLook(look: Look): void;
  setAct(act: CharAct): void;
  dispose(): void;
}

export function mountChibiPreview(canvas: HTMLCanvasElement, look: Look, opts: { background?: number; act?: CharAct } = {}): ChibiPreview {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: opts.background === undefined });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  if (opts.background !== undefined) scene.background = new THREE.Color(opts.background);
  addVoxelLights(scene, 2);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.1, 40), new THREE.MeshLambertMaterial({ color: 0xe9e4da }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(0, 1.45, 4.2);
  camera.lookAt(0, 0.95, 0);
  const factory = new ChibiFactory(8);
  const rig = new ChibiRig();
  scene.add(rig.root);
  let cur = look, act: CharAct = opts.act ?? "idle", key = "", specKey = "";
  let yaw = -0.45, vel = 0, drag: { x: number; yaw: number } | null = null;

  const onDown = (e: PointerEvent) => { drag = { x: e.clientX, yaw }; canvas.setPointerCapture(e.pointerId); };
  const onMove = (e: PointerEvent) => {
    if (!drag) return;
    const ny = drag.yaw + (e.clientX - drag.x) * 0.012;
    vel = ny - yaw;
    yaw = ny;
  };
  const onUp = (e: PointerEvent) => { drag = null; if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.style.touchAction = "none";

  let raf = 0;
  const loop = (ms: number) => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w && h && (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio()))) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    const spec = chibiSpec(cur);
    if (spec.key !== specKey) {
      if (key) factory.release(key);
      const got = factory.acquire(spec, "high");
      key = got.key; specKey = spec.key;
      rig.setParts(got.parts);
    }
    if (!drag) { yaw += vel; vel *= 0.9; }
    rig.root.rotation.y = yaw;
    rig.apply(poseAt(act, ms / 1000));
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return {
    setLook(l) { cur = l; },
    setAct(a) { act = a; },
    dispose() {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      rig.detach();
      factory.dispose();
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      renderer.dispose();
    },
  };
}
