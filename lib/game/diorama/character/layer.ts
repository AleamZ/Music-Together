import * as THREE from "three";
import { pxToWorld, type MapSize } from "../coords";
import type { Billboard, Quality } from "../types";
import { ChibiFactory, RIG } from "./build";
import { FACING_YAW, locomotion, ONE_SHOT_ACTS, pedalAngle, poseAt, turnToward, yawOf, type CharAct } from "./pose";
import { heldFor, umbrellaArm } from "./held";
import { ChibiRig } from "./rig";
import { chibiSpec } from "./spec";

// Browser only: the diorama's people as 3D voxel chibis (replaces the billboard sprites). Same inputs as before —
// one entry per person per frame — plus an optional action; walking/running comes from how fast the feet move, the
// model turns smoothly toward where it is going, and a soft blob shadow and the name tag follow it.

const TAG_Y = RIG.hipY + RIG.neckY + RIG.headH + 0.75;
/** Deeper than this under the ground plane = in the water (the view lowers swimmers' feet by ~0.9). */
const WATER_DEPTH = -0.3;
const SWIM_LIFT = 0.9;
/** Only people this near the shadow focus (units; the camera's target) cast real shadows (~14 shadow draw calls
 *  each); farther, the blob does. */
const SHADOW_DIST = 42;

/** A soft round contact shadow (alpha falls off smoothly to the rim). */
function softBlob(): THREE.DataTexture {
  const n = 32, px = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = Math.hypot((x + 0.5) / n - 0.5, (y + 0.5) / n - 0.5) * 2;
    const a = Math.max(0, 1 - d);
    const i = (y * n + x) * 4;
    px[i] = px[i + 1] = px[i + 2] = 255;
    px[i + 3] = Math.round(255 * a * a * (3 - 2 * a));
  }
  const t = new THREE.DataTexture(px, n, n, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

interface Actor {
  rig: ChibiRig;
  blob: THREE.Mesh;
  key: string;
  look: string;
  tag: THREE.Sprite | null;
  tagText: string | null;
  seen: number;
  x: number;
  y: number;
  speed: number;
  yaw: number;
  walkT: number;
  phase: number;
  /** The action shown and how long it has been going (s): a one-shot action (the cast) plays from its start. */
  act: CharAct;
  actT: number;
  /** Casting real shadows now (near the camera, high quality). */
  shadow: boolean;
}

export class CharacterLayer {
  readonly root = new THREE.Group();
  private readonly size: MapSize;
  private readonly groundAt: (x: number, y: number) => number;
  private readonly factory = new ChibiFactory();
  private readonly blobGeo: THREE.PlaneGeometry;
  private readonly blobMat: THREE.MeshBasicMaterial;
  private readonly tags = new Map<string, { tex: THREE.CanvasTexture; mat: THREE.SpriteMaterial; aspect: number }>();
  private readonly actors = new Map<string, Actor>();
  private frameNo = 0;
  private lastT: number | null = null;
  private quality: Quality = "high";
  /** Beyond this (units) from `cullFrom` a person is not drawn (me always is): the world's overview. */
  private cullFrom: THREE.Vector3 | null = null;
  private cullDist = Infinity;
  /** Where the sun's shadow box is (the camera's target), or null: everyone casts (high quality). */
  private shadowFrom: THREE.Vector3 | null = null;
  private lifts: ReadonlyMap<string, number> = new Map();
  /** First person: my own head, hat and name tag are not drawn (the camera is inside them). */
  private hideMyHead = false;

  constructor(size: MapSize, groundAt: (x: number, y: number) => number) {
    this.size = size;
    this.groundAt = groundAt;
    this.blobGeo = new THREE.PlaneGeometry(0.95, 0.95);
    this.blobGeo.rotateX(-Math.PI / 2);
    this.blobMat = new THREE.MeshBasicMaterial({ color: 0x3a2814, map: softBlob(), transparent: true, opacity: 0.42, depthWrite: false });
  }

  /** Low quality: coarser pixel atlases, no cast shadows. */
  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    for (const a of this.actors.values()) {
      a.shadow = false;
      a.rig.setShadow(false);                                            // the next update casts again near the camera
      if (a.key) this.factory.release(a.key);
      a.key = "";                                                        // re-acquired at the new detail next update
    }
  }

  /** Hide people farther than `dist` units from `eye` (the camera): in the world's overview they are a few pixels
   *  tall and ~13 draw calls each. `null` turns it off. */
  setCull(eye: THREE.Vector3 | null, dist = Infinity): void {
    this.cullFrom = eye;
    this.cullDist = dist;
  }

  /** Real shadows only within SHADOW_DIST of `at` (the world's camera target); null: everyone's. */
  setShadowFocus(at: THREE.Vector3 | null): void {
    this.shadowFrom = at;
  }

  setHideMyHead(on: boolean): void {
    this.hideMyHead = on;
  }

  /** Per person: how far above the ground their feet are drawn (units): on a vehicle's seat, in a boat. */
  setLifts(lifts: ReadonlyMap<string, number>): void {
    this.lifts = lifts;
  }

  /** Where a person's feet are drawn (units), or null (not here): hooks for what rides with them (vehicles, boats). */
  feetOf(id: string): { pos: THREE.Vector3; yaw: number; visible: boolean; crank: number | null } | null {
    const a = this.actors.get(id);
    return a ? { pos: a.rig.root.position, yaw: a.yaw, visible: a.rig.root.visible, crank: a.act === "pedal" ? pedalAngle(a.walkT, a.phase) : null } : null;
  }

  /** A person's rod tip (world units), or null (no rod out, not here). */
  rodTip(id: string, out: THREE.Vector3): THREE.Vector3 | null {
    const a = this.actors.get(id);
    return a && a.rig.root.visible ? a.rig.rodTip(out) : null;
  }

  /** Between a person's hands (world units), or null (not here). */
  hands(id: string, out: THREE.Vector3): THREE.Vector3 | null {
    const a = this.actors.get(id);
    return a && a.rig.root.visible ? a.rig.hands(out) : null;
  }

  /** Kept for the view's API: the chibis are lit by the scene, so night needs no tint. */
  setTint(c: THREE.Color): void {
    void c;
  }

  private tag(text: string, me: boolean): { mat: THREE.SpriteMaterial; aspect: number } {
    const key = `${me ? 1 : 0}|${text}`;
    const hit = this.tags.get(key);
    if (hit) return hit;
    const scale = 4, font = 9 * scale;
    const cv = document.createElement("canvas");
    const c = cv.getContext("2d");
    if (!c) throw new Error("canvas-2d-unavailable");
    c.font = `bold ${font}px monospace`;
    const w = Math.ceil(c.measureText(text).width) + 8 * scale, h = font + 6 * scale;
    cv.width = w; cv.height = h;
    c.font = `bold ${font}px monospace`;
    c.fillStyle = me ? "rgba(58, 36, 24, 0.85)" : "rgba(20, 20, 30, 0.65)";
    c.beginPath();
    c.roundRect(0, 0, w, h, 3 * scale);
    c.fill();
    c.fillStyle = me ? "#ffe08a" : "#ffffff";
    c.textBaseline = "middle";
    c.textAlign = "center";
    c.fillText(text, w / 2, h / 2 + scale / 2);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
    const entry = { tex, mat, aspect: w / h };
    this.tags.set(key, entry);
    return entry;
  }

  /** `t`: performance.now(); `reduced`: no idle/walk motion (the model still turns and moves). */
  update(list: readonly Billboard[], cameraYaw: number, t: number = performance.now(), reduced = false): void {
    void cameraYaw;
    const n = ++this.frameNo;
    const dt = this.lastT === null ? 0 : Math.min(0.1, Math.max(0, (t - this.lastT) / 1000));
    this.lastT = t;
    const detail = this.quality === "high" ? "high" : "low";
    for (const b of list) {
      let a = this.actors.get(b.id);
      if (!a) {
        const rig = new ChibiRig();
        rig.setShadow(false);
        const blob = new THREE.Mesh(this.blobGeo, this.blobMat);
        blob.position.y = 0.02;
        blob.renderOrder = 1;
        rig.root.add(blob);
        this.root.add(rig.root);
        let h = 0;
        for (let i = 0; i < b.id.length; i++) h = (h * 31 + b.id.charCodeAt(i)) | 0;
        a = { rig, blob, key: "", look: "", tag: null, tagText: null, seen: n, x: b.x, y: b.y, speed: 0, yaw: FACING_YAW[b.facing], walkT: 0, phase: (Math.abs(h) % 1000) / 250, act: "idle", actT: 0, shadow: false };
        this.actors.set(b.id, a);
      }
      a.seen = n;
      const spec = chibiSpec(b.look);
      if (spec.key !== a.look || !a.key) {
        if (a.key) this.factory.release(a.key);
        const got = this.factory.acquire(spec, detail);
        a.key = got.key;
        a.look = spec.key;
        a.rig.setParts(got.parts);
      }
      // speed (map px/s, smoothed) and heading from how the feet moved
      const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy);
      if (dist > 40) a.speed = 0;                                        // a teleport, not a sprint
      else if (dt > 0) a.speed += (dist / dt - a.speed) * Math.min(1, dt * 10);
      a.x = b.x; a.y = b.y;
      const act: CharAct = b.act ?? locomotion(a.speed);
      if (act !== a.act) { a.act = act; a.actT = 0; } else a.actT += dt;
      const moving = act === "walk" || act === "run" || act === "pedal" || (act === "swim" && dist > 0.05);
      const target = moving && dist > 0.05 && dist <= 40 ? yawOf(dx, dy) : b.yaw ?? FACING_YAW[b.facing];
      a.yaw = dt > 0 ? turnToward(a.yaw, target, dt) : target;
      // the gait's clock runs with the speed (walking, running, the pedals: a standing bike's cranks stay still)
      a.walkT += dt * (act === "walk" || act === "run" ? Math.max(0.6, a.speed / 70) : act === "pedal" ? Math.min(1.6, a.speed / 90) : 1);
      const ground = this.groundAt(b.x, b.y);
      const swim = act === "swim" || (b.act === undefined && ground < WATER_DEPTH);
      const hf = heldFor(swim ? "swim" : act, { fish: b.hand, umbrella: b.umbrella && b.vehicle !== "car" });
      a.rig.setHeld(hf.R, hf.L);
      a.rig.setRodLook(b.rodLook ?? null);
      const pose = poseAt(swim ? "swim" : act, ONE_SHOT_ACTS.has(act) ? a.actT : a.walkT, a.phase, reduced);
      a.rig.apply(hf.L === "umbrella" ? umbrellaArm(pose) : pose);
      a.rig.setAct(swim ? null : act);                                   // wave 3: the act's props (held3d.ts)
      const w = pxToWorld(b, this.size);
      a.rig.root.position.set(w.x, (swim && ground < WATER_DEPTH ? ground + SWIM_LIFT : ground) + (this.lifts.get(b.id) ?? b.lift ?? 0), w.z);
      a.rig.root.rotation.y = a.yaw;
      a.blob.visible = !swim;
      if (b.name !== a.tagText) {
        if (a.tag) { this.root.remove(a.tag); a.tag = null; }
        if (b.name) {
          const tg = this.tag(b.name, !!b.me);
          const s = new THREE.Sprite(tg.mat);
          const h = 0.42;
          s.scale.set(h * tg.aspect, h, 1);
          s.renderOrder = 10;
          a.tag = s;
          this.root.add(s);                                             // not under the rig: it must not turn with it
        }
        a.tagText = b.name;
      }
      a.tag?.position.set(a.rig.root.position.x, a.rig.root.position.y + TAG_Y, a.rig.root.position.z);
      const far = this.cullFrom ? a.rig.root.position.distanceTo(this.cullFrom) : 0;
      const shown = !this.cullFrom || !!b.me || far < this.cullDist;
      a.rig.root.visible = shown;
      const shadow = shown && this.quality === "high" && (!this.shadowFrom || a.rig.root.position.distanceTo(this.shadowFrom) < SHADOW_DIST);
      if (shadow !== a.shadow) { a.shadow = shadow; a.rig.setShadow(shadow); }
      const headless = !!b.me && this.hideMyHead;
      a.rig.setHeadVisible(!headless);
      if (a.tag) a.tag.visible = shown && !headless;
    }
    for (const [id, a] of this.actors) {
      if (a.seen === n) continue;
      this.drop(a);
      this.actors.delete(id);
    }
  }

  private drop(a: Actor): void {
    this.root.remove(a.rig.root);
    if (a.tag) this.root.remove(a.tag);
    a.rig.detach();
    if (a.key) this.factory.release(a.key);
  }

  /** How many people and built looks (dev stats). */
  counts(): { people: number; looks: number } {
    return { people: this.actors.size, looks: this.factory.size() };
  }

  dispose(): void {
    for (const a of this.actors.values()) this.drop(a);
    this.actors.clear();
    this.root.clear();
    this.factory.dispose();
    for (const tg of this.tags.values()) { tg.tex.dispose(); tg.mat.dispose(); }
    this.tags.clear();
    this.blobGeo.dispose();
    this.blobMat.map?.dispose();
    this.blobMat.dispose();
  }
}

