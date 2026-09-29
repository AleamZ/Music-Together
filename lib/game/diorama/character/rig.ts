import * as THREE from "three";
import { RIG, SEGS, VOX, type BodyDims, type ChibiParts, type Seg } from "./build";
import { REST, type Pose } from "./pose";

// Browser only: one chibi on screen — a pivot hierarchy with a real two-bone chain per limb (hips → head;
// shoulder → upper arm → ELBOW → forearm + hand; hip → thigh → KNEE → shin → ANKLE → foot) whose meshes point at the
// shared, per-look geometry and atlas material, plus the face decal whose material is swapped for blinks and smiles.
// Each joint's two segments end in overlapping rounded caps, so bends never open a gap. The bone lengths and
// attachment points come from the look's proportions (body type + body sliders). `apply` poses it; the root's
// position/yaw are the caller's.

const EMPTY = new THREE.BufferGeometry();
const NONE = new THREE.MeshBasicMaterial({ visible: false });

function mesh(): THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
  const m = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(EMPTY, NONE);
  m.castShadow = true;
  return m;
}

/** The default measurements (before a look is set). */
const DEFAULT_DIMS: BodyDims = {
  shoulderX: RIG.shoulderX, shoulderY: RIG.shoulderY, legX: RIG.legX, hipY: RIG.hipY, neckY: RIG.neckY,
  upperLen: RIG.upperLen, foreLen: 4.35 * VOX, thighLen: RIG.thighLen, calfLen: 6.2 * VOX, footH: 1.85 * VOX,
  headScale: RIG.headScale, headX: 1, headY: 1, scale: 1, posture: { armZ: 0, legZ: 0, elbow: 0 },
};

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
  private readonly ankleL = new THREE.Group();
  private readonly ankleR = new THREE.Group();
  private readonly m = {} as Record<Seg, THREE.Mesh<THREE.BufferGeometry, THREE.Material>>;
  /** The skinned pelvis/skirt and its three bones (pelvis, left thigh, right thigh). */
  private readonly hips = new THREE.SkinnedMesh<THREE.BufferGeometry, THREE.Material>(EMPTY, NONE);
  private readonly bones = [new THREE.Bone(), new THREE.Bone(), new THREE.Bone()];
  private skeleton: THREE.Skeleton | null = null;
  private readonly face: THREE.Mesh<THREE.BufferGeometry, THREE.Material> = new THREE.Mesh(EMPTY, NONE);
  private parts: ChibiParts | null = null;
  private dims: BodyDims = DEFAULT_DIMS;

  constructor() {
    for (const s of SEGS) { this.m[s] = s === "hips" ? this.hips : mesh(); this.m[s].name = s; }
    this.legL.name = "legL"; this.legR.name = "legR";
    this.hips.castShadow = true;
    this.hips.frustumCulled = false;
    this.head.add(this.m.head, this.face);
    this.elbowL.add(this.m.foreL);
    this.elbowR.add(this.m.foreR, this.m.rod);
    this.armL.add(this.m.upperL, this.elbowL);
    this.armR.add(this.m.upperR, this.elbowR);
    this.ankleL.add(this.m.footL);
    this.ankleR.add(this.m.footR);
    this.kneeL.add(this.m.calfL, this.ankleL);
    this.kneeR.add(this.m.calfR, this.ankleR);
    this.legL.add(this.m.thighL, this.kneeL);
    this.legR.add(this.m.thighR, this.kneeR);
    this.body.add(this.m.torso, this.m.hips, this.bones[0], this.head, this.armL, this.armR, this.legL, this.legR);
    this.legL.add(this.bones[1]);
    this.legR.add(this.bones[2]);
    this.root.add(this.body);
    this.measure(DEFAULT_DIMS);
  }

  /** Places the joints for a set of measurements. */
  private measure(d: BodyDims): void {
    this.dims = d;
    this.body.position.y = d.hipY * d.scale;
    this.body.scale.setScalar(d.scale);
    this.head.position.y = d.neckY;
    this.head.scale.set(d.headScale * d.headX, d.headScale * d.headY, d.headScale);
    this.armL.position.set(-d.shoulderX, d.shoulderY, 0);
    this.armR.position.set(d.shoulderX, d.shoulderY, 0);
    this.elbowL.position.y = this.elbowR.position.y = -d.upperLen;
    this.legL.position.set(-d.legX, 0, 0);
    this.legR.position.set(d.legX, 0, 0);
    this.kneeL.position.y = this.kneeR.position.y = -d.thighLen;
    this.ankleL.position.y = this.ankleR.position.y = -d.calfLen;
    this.m.rod.position.set(0, -d.foreLen - 0.8 * VOX, 0.2 * VOX);
  }

  setParts(p: ChibiParts): void {
    this.parts = p;
    for (const s of SEGS) { this.m[s].geometry = p[s]; this.m[s].material = p.material; }
    this.face.geometry = p.faceGeo;
    this.face.material = p.faces.open;
    this.measure(p.dims);
    // bind the pelvis/skirt in the rest pose (the bones' inverses are taken from here)
    this.apply(REST);
    this.root.updateMatrixWorld(true);
    this.skeleton?.dispose();
    this.skeleton = new THREE.Skeleton(this.bones);
    this.hips.bind(this.skeleton);
  }

  setShadow(on: boolean): void {
    for (const s of SEGS) this.m[s].castShadow = on;
  }

  /** Show or hide the head (and the hat and face on it): first person hides my own. */
  setHeadVisible(on: boolean): void {
    this.head.visible = on;
  }

  apply(p: Pose): void {
    const d = this.dims, post = d.posture;
    // sinking (sitting, swimming) is measured on the default leg; longer or shorter legs sink in proportion
    const legK = (d.thighLen + d.calfLen) / (RIG.thighLen + 6.2 * VOX);
    this.body.position.y = (d.hipY + p.bob - p.drop * legK) * d.scale;
    this.body.rotation.set(p.lean, 0, p.roll);
    const q = p.squash;
    this.body.scale.set(d.scale * (1 - q * 0.5), d.scale * (1 + q), d.scale * (1 - q * 0.5));
    this.head.rotation.set(p.headX, 0, p.headZ);
    this.armL.rotation.set(-p.armL.x, 0, -(p.armL.z + post.armZ));
    this.armR.rotation.set(-p.armR.x, 0, p.armR.z + post.armZ);
    this.elbowL.rotation.x = -(p.elbowL + post.elbow);
    this.elbowR.rotation.x = -(p.elbowR + post.elbow);
    this.legL.rotation.set(-p.legL.x, 0, -(p.legL.z + post.legZ));
    this.legR.rotation.set(-p.legR.x, 0, p.legR.z + post.legZ);
    this.kneeL.rotation.x = p.kneeL;
    this.kneeR.rotation.x = p.kneeR;
    this.ankleL.rotation.x = p.ankleL;
    this.ankleR.rotation.x = p.ankleR;
    this.m.rod.visible = p.rod > 0;
    if (this.parts) this.face.material = this.parts.faces[p.face];
  }

  /** Drops the geometry/material references (the factory owns them). */
  detach(): void {
    this.parts = null;
    this.skeleton?.dispose();
    this.skeleton = null;
    for (const s of SEGS) { this.m[s].geometry = EMPTY; this.m[s].material = NONE; }
    this.face.geometry = EMPTY;
    this.face.material = NONE;
  }
}
