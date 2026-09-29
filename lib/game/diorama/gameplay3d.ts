import * as THREE from "three";
import type { Facing } from "@/lib/game/types";
import { PX_PER_UNIT } from "./coords";
import type { Billboard, DioramaFrame } from "./types";

// P3 (unified world): the gameplay things the 3D world shows beside the people — the vehicle under each rider (and the
// boat on Sông Cái), the field's rats, the dogs, the pond's leaping fish and the shut level gates' bamboo barriers. Simple
// flat-shaded meshes, pooled by key, placed in absolute units (world px / 16) on the view's ground. Browser only.
// The engine fills DioramaFrame.gameplay and Billboard.vehicle; GameCanvas adds this layer to the WorldView's scene.

const U = PX_PER_UNIT;
const mat = (c: number) => new THREE.MeshLambertMaterial({ color: c });
const M = {
  rat: mat(0x6b5a4a), dog: mat(0xa0703c), fish: mat(0xc8d8e0), bamboo: mat(0x9bb04a), rope: mat(0x7a5a2a),
  bike: mat(0x2f6fb0), moto: mat(0xc0392b), car: mat(0xe0b020), boat: mat(0x7a5230), wheel: mat(0x222222),
};

const yawOf = (f: Facing): number => (f === "down" ? 0 : f === "right" ? Math.PI / 2 : f === "up" ? Math.PI : -Math.PI / 2);

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y + h / 2, z);
  return b;
}

function vehicleMesh(kind: NonNullable<Billboard["vehicle"]>): THREE.Group {
  const g = new THREE.Group();
  if (kind === "boat") {
    g.add(box(1.3, 0.35, 3.2, M.boat, 0, -0.2));
    return g;
  }
  if (kind === "car") {
    g.add(box(1.8, 0.7, 3, M.car, 0, 0.3), box(1.5, 0.55, 1.5, M.car, 0, 1.0, 0.2));
    for (const [x, z] of [[-0.9, -1], [0.9, -1], [-0.9, 1], [0.9, 1]]) g.add(box(0.25, 0.6, 0.6, M.wheel, x, 0, z));
    return g;
  }
  const m = kind === "bike" ? M.bike : M.moto;
  g.add(box(0.25, kind === "bike" ? 0.12 : 0.4, 1.8, m, 0, 0.55));
  g.add(box(0.2, 0.7, 0.7, M.wheel, 0, 0, -0.8), box(0.2, 0.7, 0.7, M.wheel, 0, 0, 0.8));
  return g;
}

function ratMesh(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.35, 0.25, 0.6, M.rat), box(0.06, 0.06, 0.5, M.rat, 0, 0.05, -0.5));
  return g;
}

function dogMesh(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.5, 0.45, 1.0, M.dog, 0, 0.35), box(0.4, 0.4, 0.4, M.dog, 0, 0.7, 0.55));
  for (const [x, z] of [[-0.18, -0.35], [0.18, -0.35], [-0.18, 0.35], [0.18, 0.35]]) g.add(box(0.12, 0.35, 0.12, M.dog, x, 0, z));
  return g;
}

/** A bamboo barrier over `r` (px): poles every ~12 px along its long side and two rails; or three poles by `at`. */
function gateMesh(barrier: { x: number; y: number; w: number; h: number } | null, at: { x: number; y: number }, groundAt: (x: number, y: number) => number): THREE.Group {
  const g = new THREE.Group();
  const r = barrier ?? { x: at.x - 18, y: at.y - 4, w: 36, h: 8 };
  const along = r.h > r.w;
  const len = along ? r.h : r.w, n = Math.max(3, Math.round(len / 12));
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const base = groundAt(cx, cy);
  for (let i = 0; i <= n; i++) {
    const px = along ? cx : r.x + (r.w * i) / n, py = along ? r.y + (r.h * i) / n : cy;
    g.add(box(0.18, 2.2, 0.18, M.bamboo, px / U, groundAt(px, py), py / U));
  }
  for (const y of [0.8, 1.6]) {
    const rail = box(along ? 0.1 : len / U, 0.1, along ? len / U : 0.1, M.rope, cx / U, base + y, cy / U);
    g.add(rail);
  }
  return g;
}

export class GameplayLayer {
  readonly root = new THREE.Group();
  private readonly groundAt: (x: number, y: number) => number;
  private readonly pools = new Map<string, THREE.Object3D>();
  private seen = new Set<string>();
  /** Draw a vehicle under each rider (off if the world's own renderer draws them). */
  drawVehicles = true;

  constructor(groundAt: (x: number, y: number) => number) {
    this.groundAt = groundAt;
    this.root.name = "gameplay";
  }

  private put(key: string, make: () => THREE.Object3D, x: number, y: number, lift: number, yaw: number): THREE.Object3D {
    let o = this.pools.get(key);
    if (!o) {
      o = make();
      this.pools.set(key, o);
      this.root.add(o);
    }
    o.position.set(x / U, this.groundAt(x, y) + lift, y / U);
    o.rotation.y = yaw;
    this.seen.add(key);
    return o;
  }

  update(f: DioramaFrame): void {
    this.seen = new Set();
    if (this.drawVehicles) {
      for (const b of f.billboards) {
        if (!b.vehicle) continue;
        const v = b.vehicle;
        this.put(`v:${b.id}:${v}`, () => vehicleMesh(v), b.x, b.y, v === "boat" ? 0.6 : 0, yawOf(b.facing));
      }
    }
    const g = f.gameplay;
    if (g) {
      for (const r of g.rats) {
        const o = this.put(`r:${r.key}`, ratMesh, r.x, r.y, 0, r.dir === 1 ? Math.PI / 2 : -Math.PI / 2);
        o.rotation.z = r.fallen ? Math.PI / 2 : 0;
      }
      for (const d of g.dogs) this.put(`d:${d.id}`, dogMesh, d.x, d.y, 0, yawOf(d.facing));
      g.leaps.forEach((l, i) => {
        const o = this.put(`l:${i}`, () => box(0.15, 0.2, 0.5, M.fish), l.x, l.y, 0.4 + l.h * 1.4, 0);
        o.visible = l.h > 0;
      });
      for (const gate of g.gates) {
        const key = `g:${gate.id}`;
        if (!this.pools.has(key)) {
          const m = gateMesh(gate.barrier, gate.at, this.groundAt);
          this.pools.set(key, m);
          this.root.add(m);
        }
        this.seen.add(key);
      }
    }
    for (const [k, o] of this.pools) {
      if (this.seen.has(k)) continue;
      this.root.remove(o);
      disposeTree(o);
      this.pools.delete(k);
    }
  }

  dispose(): void {
    for (const o of this.pools.values()) disposeTree(o);
    this.pools.clear();
    this.root.clear();
  }
}

function disposeTree(o: THREE.Object3D): void {
  o.traverse((c) => {
    if (c instanceof THREE.Mesh) c.geometry.dispose();                          // the materials are shared (M)
  });
}
