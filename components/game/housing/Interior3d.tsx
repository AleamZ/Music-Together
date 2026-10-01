"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { CharacterLayer } from "@/lib/game/diorama/character/layer";
import { addVoxelLights } from "@/lib/game/diorama/character/voxel-material";
import type { Billboard } from "@/lib/game/diorama/types";
import { buildRoom } from "@/lib/game/diorama/world/interior3d";
import { ModelMats } from "@/lib/game/diorama/world/models";
import { APT_TILE, type Placed } from "@/lib/game/housing/apartment";
import type { Vec } from "@/lib/game/types";

/** Wave 3: the 3D mode's view of an interior (InteriorStage's apartment / house): the room as a 3D cutaway
 *  (world/interior3d.ts) with its furniture models, everyone inside as the 3D chibis, a fixed camera from the front.
 *  The stage keeps the simulation; `people()` is read every frame; a tap on the floor walks there (`onTap`, room px). */
export default function Interior3d({ w, h, gridTop, wall, floor, items, people, onTap, width, height }: {
  w: number; h: number; gridTop: number; wall: string | null; floor: string | null; items: readonly Placed[];
  people: () => Billboard[]; onTap: (p: Vec) => void; width: number; height: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const peopleRef = useRef(people);
  const tapRef = useRef(onTap);
  useEffect(() => { peopleRef.current = people; tapRef.current = onTap; }, [people, onTap]);
  const sceneRef = useRef<{ scene: THREE.Scene; room: THREE.Group | null; mats: ModelMats; cam: THREE.PerspectiveCamera; r: THREE.WebGLRenderer } | null>(null);

  // the renderer, the lights, the people and the loop
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    let r: THREE.WebGLRenderer;
    try { r = new THREE.WebGLRenderer({ canvas: cv, antialias: true }); } catch { return; }
    r.shadowMap.enabled = true;
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1e1a24);
    const { sun } = addVoxelLights(scene, Math.max(w, h) / APT_TILE / 2 + 1);
    sun.position.set(3, 12, 8);
    const cam = new THREE.PerspectiveCamera(32, 1, 0.5, 200);
    const mats = new ModelMats();
    sceneRef.current = { scene, room: null, mats, cam, r };
    const layer = new CharacterLayer({ width: w, height: h }, () => 0);
    scene.add(layer.root);
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const frame = (now: number) => {
      layer.update(peopleRef.current(), 0, now, reduced);
      r.render(scene, cam);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      layer.dispose();
      mats.dispose();
      r.dispose();
      sceneRef.current = null;
    };
  }, [w, h]);

  // the camera frames the room (front, from above) at the canvas's aspect
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const cols = w / APT_TILE, rows = h / APT_TILE;
    s.r.setSize(width, height, false);
    s.cam.aspect = width / height;
    const fit = Math.max(cols / s.cam.aspect, rows) * 1.25;
    s.cam.position.set(0, fit * 1.05, rows / 2 + fit * 0.95);
    s.cam.lookAt(0, 0.6, 0.6);
    s.cam.updateProjectionMatrix();
  }, [w, h, width, height]);

  // the room, rebuilt when the layout changes
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    if (s.room) s.scene.remove(s.room);
    s.room = buildRoom(s.mats, { cols: w / APT_TILE, rows: h / APT_TILE, wallRows: gridTop, wall, floor, items });
    s.scene.add(s.room);
  }, [w, h, gridTop, wall, floor, items]);

  const tap = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = sceneRef.current;
    if (!s) return;
    const b = e.currentTarget.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, s.cam);
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    if (hit) tapRef.current({ x: hit.x * APT_TILE + w / 2, y: hit.z * APT_TILE + h / 2 });
  };

  return (
    <canvas ref={ref} width={width} height={height} data-testid="interior-3d" onPointerDown={tap}
      className="max-w-full touch-none rounded-sm border-4 border-[#5a381e]" style={{ width, height }} />
  );
}
