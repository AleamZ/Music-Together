import * as THREE from "three";
import { RIG, type ChibiParts } from "./build";
import type { Pose } from "./pose";

// Browser only: one chibi on screen — a small pivot hierarchy (hips → head, shoulders → elbows, hips → knees) whose
// meshes point at the shared, per-look geometry. `apply` poses it; the root's position/yaw are the caller's.

const EMPTY = new THREE.BufferGeometry();

function mesh(mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(EMPTY, mat);
  m.castShadow = true;
  return m;
}

export class ChibiRig {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly elbowL = new THREE.Group();
  private readonly elbowR = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly kneeL = new THREE.Group();
  private readonly kneeR = new THREE.Group();
  private readonly m: Record<keyof ChibiParts, THREE.Mesh>;

  constructor(mat: THREE.Material) {
    this.m = {
      head: mesh(mat), torso: mesh(mat), upperL: mesh(mat), upperR: mesh(mat), foreL: mesh(mat), foreR: mesh(mat),
      thighL: mesh(mat), thighR: mesh(mat), calfL: mesh(mat), calfR: mesh(mat), rod: mesh(mat),
    };
    this.body.position.y = RIG.hipY;
    this.head.position.y = RIG.neckY;
    this.armL.position.set(-RIG.shoulderX, RIG.shoulderY, 0);
    this.armR.position.set(RIG.shoulderX, RIG.shoulderY, 0);
    this.elbowL.position.y = this.elbowR.position.y = -RIG.upperLen;
    this.legL.position.set(-RIG.legX, 0, 0);
    this.legR.position.set(RIG.legX, 0, 0);
    this.kneeL.position.y = this.kneeR.position.y = -RIG.thighLen;
    this.m.rod.position.set(0, -RIG.foreLen - 0.04, 0.02);
    this.head.add(this.m.head);
    this.elbowL.add(this.m.foreL);
    this.elbowR.add(this.m.foreR, this.m.rod);
    this.armL.add(this.m.upperL, this.elbowL);
    this.armR.add(this.m.upperR, this.elbowR);
    this.kneeL.add(this.m.calfL);
    this.kneeR.add(this.m.calfR);
    this.legL.add(this.m.thighL, this.kneeL);
    this.legR.add(this.m.thighR, this.kneeR);
    this.body.add(this.m.torso, this.head, this.armL, this.armR, this.legL, this.legR);
    this.root.add(this.body);
  }

  setParts(p: ChibiParts): void {
    for (const k of Object.keys(this.m) as (keyof ChibiParts)[]) this.m[k].geometry = p[k];
  }

  setShadow(on: boolean): void {
    for (const k of Object.keys(this.m) as (keyof ChibiParts)[]) this.m[k].castShadow = on;
  }

  apply(p: Pose): void {
    this.body.position.y = RIG.hipY + p.bob - p.drop;
    this.body.rotation.x = p.lean;
    this.head.rotation.set(p.headX, 0, p.headZ);
    this.armL.rotation.set(-p.armL.x, 0, -p.armL.z);
    this.armR.rotation.set(-p.armR.x, 0, p.armR.z);
    this.elbowL.rotation.x = -p.elbowL;
    this.elbowR.rotation.x = -p.elbowR;
    this.legL.rotation.set(-p.legL.x, 0, -p.legL.z);
    this.legR.rotation.set(-p.legR.x, 0, p.legR.z);
    this.kneeL.rotation.x = p.kneeL;
    this.kneeR.rotation.x = p.kneeR;
    this.m.rod.visible = p.rod > 0;
  }

  /** Drops the geometry references (the factory owns them). */
  detach(): void {
    for (const k of Object.keys(this.m) as (keyof ChibiParts)[]) this.m[k].geometry = EMPTY;
  }
}
