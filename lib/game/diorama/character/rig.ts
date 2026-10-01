import * as THREE from "three";
import { RIG, SEGS, VOX, type BodyDims, type ChibiParts, type Seg } from "./build";
import { heldFishGeometry, heldMaterial, rodLookGeometry, toolGeometry, type RodLook, type ToolId } from "./held";
import { REST, type Pose } from "./pose";

// Browser only: one chibi on screen — a pivot hierarchy with a real two-bone chain per limb (hips → head;
// shoulder → upper arm → ELBOW → forearm + hand; hip → thigh → KNEE → shin → ANKLE → foot) whose meshes point at the
// shared, per-look geometry and atlas material, plus the face decal whose material is swapped for blinks and smiles.
// Each joint's two segments end in overlapping rounded caps, so bends never open a gap. The bone lengths and
// attachment points come from the look's proportions (body type + body sliders). `apply` poses it; the root's
// position/yaw are the caller's.

/** The rod's tilt in the fist (radians): it runs out along the forearm, so a forearm held forward at chest height
 *  points the rod ~30° up (the poses' arm angles count this in). */
export const ROD_GRIP = 0.9;

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
  private readonly bones = [new THREE.Bone(), new THREE.Bone(), new THREE.Bone(), new THREE.Bone(), new THREE.Bone()];
  private skeleton: THREE.Skeleton | null = null;
  private readonly face: THREE.Mesh<THREE.BufferGeometry, THREE.Material> = new THREE.Mesh(EMPTY, NONE);
  private parts: ChibiParts | null = null;
  private dims: BodyDims = DEFAULT_DIMS;
  /** Wave 1: what each fist holds (a tool, a fish: one outlined mesh each, hidden when empty) and the rod's look. */
  private readonly heldR = mesh();
  private readonly heldL = mesh();
  private heldKey = "";
  private rodKey = "";

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
    this.body.add(this.m.torso, this.m.hips, this.bones[0], this.bones[3], this.bones[4], this.head, this.armL, this.armR, this.legL, this.legR);
    this.legL.add(this.bones[1]);
    this.legR.add(this.bones[2]);
    this.root.add(this.body);
    this.heldR.visible = this.heldL.visible = false;
    this.heldR.name = "heldR"; this.heldL.name = "heldL";
    this.elbowR.add(this.heldR);
    this.elbowL.add(this.heldL);
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
    this.m.rod.rotation.x = ROD_GRIP;                                     // along the forearm, as a rod is held
    this.heldR.position.set(0, -d.foreLen - 0.8 * VOX, 0.2 * VOX);
    this.heldL.position.set(0, -d.foreLen - 0.8 * VOX, 0.2 * VOX);
  }

  setParts(p: ChibiParts): void {
    this.parts = p;
    for (const s of SEGS) { this.m[s].geometry = p[s]; this.m[s].material = p.material; }
    this.face.geometry = p.faceGeo;
    this.face.material = p.faces.open;
    const rk = this.rodKey;
    this.rodKey = "";
    if (rk) { const [rod, reel, bobber] = rk.split("|"); this.setRodLook({ rod, reel: reel === "null" ? null : reel, bobber: bobber === "null" ? null : bobber }); }
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
    this.heldR.castShadow = this.heldL.castShadow = on;
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
    // the áo dài panels (bones 3, 4): the front follows the forward-most thigh, the back the backward-most (clamped)
    this.bones[3].rotation.x = -Math.min(1.7, Math.max(0, p.legL.x, p.legR.x));
    this.bones[4].rotation.x = -Math.max(-0.9, Math.min(0, p.legL.x, p.legR.x));
    this.kneeL.rotation.x = p.kneeL;
    this.kneeR.rotation.x = p.kneeR;
    this.ankleL.rotation.x = p.ankleL;
    this.ankleR.rotation.x = p.ankleR;
    this.m.rod.visible = p.rod > 0;
    if (p.rod > 0 && this.parts) this.gripRod();
    if (this.parts) this.face.material = this.parts.faces[p.face];
  }

  private readonly ikT = new THREE.Vector3();
  private readonly ikM = new THREE.Matrix4();

  /** Two hands on the rod: the left arm solved (two-bone IK) so its hand closes on the rod's butt, wherever the right
   *  hand swings it. The arm pitches (x) and rolls (z) at the shoulder and bends at the elbow, as the poses do. */
  private gripRod(): void {
    const rod = this.m.rod, g = rod.geometry;
    let butt = g.userData.butt as THREE.Vector3 | undefined;
    if (!butt) {                                                  // a fist's width behind the right hand, on the grip
      const pos = g.getAttribute("position");
      let minZ = 0;
      for (let i = 0; i < pos.count; i++) minZ = Math.min(minZ, pos.getZ(i));
      butt = g.userData.butt = new THREE.Vector3(0, 0, minZ * 0.3);
    }
    this.body.updateMatrixWorld(true);
    // the butt in the body's frame (the left shoulder's parent), from the shoulder
    const t = this.ikT.copy(butt).applyMatrix4(rod.matrixWorld);
    t.applyMatrix4(this.ikM.copy(this.body.matrixWorld).invert()).sub(this.armL.position);
    const u = this.dims.upperLen, f = this.dims.foreLen;
    const d = Math.min(u + f - 1e-4, Math.max(Math.abs(u - f) + 1e-4, t.length()));
    // the elbow: the law of cosines on the two bones
    const e = Math.PI - Math.acos(Math.max(-1, Math.min(1, (u * u + f * f - d * d) / (2 * u * f))));
    // the hand in the arm's own frame (rest: down -y; the elbow folds the forearm forward, +z)
    const vy = -(u + f * Math.cos(e)), vz = f * Math.sin(e);
    t.setLength(d);
    // pitch: Rx(ax) must bring the arm's (vy, vz) plane onto the target
    const rho = Math.hypot(t.y, t.z), phi = Math.atan2(t.y, t.z);
    const ax = Math.acos(Math.max(-1, Math.min(1, vz / Math.max(1e-6, rho)))) - phi;
    const cy = t.y * Math.cos(ax) + t.z * Math.sin(ax);
    const az = Math.atan2(-t.x / vy, cy / vy);
    this.armL.rotation.set(ax, 0, az);
    this.elbowL.rotation.x = -e;
  }

  /** The rod's tip in world space (the line starts there), or null while no rod is out. */
  rodTip(out: THREE.Vector3): THREE.Vector3 | null {
    const rod = this.m.rod;
    if (!rod.visible || !this.parts) return null;
    const g = rod.geometry;
    let tip = g.userData.tip as THREE.Vector3 | undefined;
    if (!tip) {                                                   // the farthest point along the rod (+z): its tip
      const p = g.getAttribute("position");
      let best = 0;
      for (let i = 1; i < p.count; i++) if (p.getZ(i) > p.getZ(best)) best = i;
      tip = g.userData.tip = new THREE.Vector3(p.getX(best), p.getY(best), p.getZ(best));
    }
    this.root.updateMatrixWorld(true);
    return rod.localToWorld(out.copy(tip));
  }

  /** Between the two hands in world space (what they hold: a net's bundle, its rope). */
  hands(out: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    const l = this.elbowL.localToWorld(new THREE.Vector3(0, -this.dims.foreLen, 0));
    const r = this.elbowR.localToWorld(out.set(0, -this.dims.foreLen, 0));
    return r.add(l).multiplyScalar(0.5);
  }

  /** Wave 1: what the fists hold — a tool id or "fish:<species>" per hand (null = empty). Cheap when unchanged. */
  setHeld(r: ToolId | string | null, l: ToolId | string | null = null): void {
    const key = `${r ?? ""}|${l ?? ""}`;
    if (key === this.heldKey) return;
    this.heldKey = key;
    for (const [m, id] of [[this.heldR, r], [this.heldL, l]] as const) {
      if (!id) { m.visible = false; continue; }
      const t = id.startsWith("fish:") ? heldFishGeometry(id.slice(5)) : toolGeometry(id as ToolId);
      m.geometry = t.geo;
      m.material = heldMaterial();
      m.rotation.set(t.grip, id.startsWith("fish:") ? Math.PI / 2 : 0, 0);
      m.scale.setScalar(id.startsWith("fish:") ? 0.7 : 1);
      m.visible = true;
    }
  }

  /** What each fist holds now ("" = empty), for tests and the review sheet. */
  heldIds(): { R: string; L: string } {
    const [R, L] = this.heldKey.split("|");
    return { R: R ?? "", L: L ?? "" };
  }

  /** Wave 1: the rod's look from the fishing loadout (null = the default rod modelled with the look). */
  setRodLook(l: RodLook | null): void {
    const key = l ? `${l.rod}|${l.reel}|${l.bobber}` : "";
    if (key === this.rodKey) return;
    this.rodKey = key;
    if (!this.parts) return;
    this.m.rod.geometry = l ? rodLookGeometry(l) : this.parts.rod;
    this.m.rod.material = l ? heldMaterial() : this.parts.material;
  }

  /** Drops the geometry/material references (the factory owns them). */
  detach(): void {
    this.parts = null;
    this.skeleton?.dispose();
    this.skeleton = null;
    for (const s of SEGS) { this.m[s].geometry = EMPTY; this.m[s].material = NONE; }
    this.face.geometry = EMPTY;
    this.face.material = NONE;
    this.heldKey = ""; this.rodKey = "";
    this.heldR.visible = this.heldL.visible = false;
  }
}
