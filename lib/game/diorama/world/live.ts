import * as THREE from "three";
import { CO_TU_LOOK } from "@/lib/game/look";
import { LOTS } from "@/lib/game/maps/khu-nha";
import { POND_CX, POND_CY, POND_RX, POND_RY } from "@/lib/game/maps/pond";
import { RIVER } from "@/lib/game/river/geometry";
import type { Facing } from "@/lib/game/types";
import { RIVER_LEVEL, ZONE_ELEV } from "@/lib/game/world/terrain";
import { ZONES } from "@/lib/game/world/zones";
import { WATER_Y } from "../build";
import type { CharacterLayer } from "../character/layer";
import type { Billboard } from "../types";
import {
  gait, hash01, leap, pushWake, SEAT_LIFT, stepMotion, telegraphLook, trailSpot,
  type LiveBoss, type Motion, type WakePoint, type WorldLive,
} from "./live-plan";
import {
  barrierModel, boatModel, bobberModel, bossModel, dogModel, digModel, duckModel, fishModel, houseModel, Labels,
  lotSign, ModelMats, petModel, ratModel, ringModel, spearModel, stallModel, vehicleModel, wildAnimal,
  type Barrier, type Boat, type Creature, type Vehicle,
} from "./models";

// Browser only: the world's live things in 3D — market and player stalls, the fight rings on Bãi đất, bosses with
// their arena and wind-up telegraphs, wild animals that walk and bolt, Khu nhà's houses by owner and roof, the ghe on
// Sông Cái with its wake, dig spots, fishing bobbers, pets at heel, vehicles under their riders, the dog and the field
// rats, the bamboo barriers and their guards — plus ambient leaping fish and ducks on the pond. The engine hands it a
// WorldLive (world px) each frame; things are made on first sight, kept by id, dropped when gone.

const U = (px: number) => px / 16;
const POND_WATER = ZONE_ELEV.pond + WATER_Y;
const GUARD_LOOK = CO_TU_LOOK;

interface Entry { obj: THREE.Object3D; key: string; seen: number; motion: Motion | null; data?: unknown; /** Parts placed in world space (not under obj): removed with it. */ extras: THREE.Object3D[] }

interface BossParts { c: Creature; bar: THREE.Sprite; fill: THREE.Sprite; decals: THREE.Mesh[]; arena: THREE.Object3D | null; arenaKey: string }
interface BoatParts { b: Boat; wake: WakePoint[]; foam: THREE.InstancedMesh }
interface FishParts { bob: THREE.Group; rings: THREE.Mesh[]; alert: THREE.Sprite }

export class LiveLayer {
  readonly root = new THREE.Group();
  private readonly mats = new ModelMats();
  private readonly labels = new Labels();
  private readonly entries = new Map<string, Entry>();
  private readonly lift = new Map<string, number>();
  private readonly ringGeo = new THREE.RingGeometry(0.8, 1, 24);
  private readonly discGeo = new THREE.CircleGeometry(1, 24);
  private readonly planeGeo = new THREE.PlaneGeometry(1, 1);
  private readonly ambient: { fish: Array<{ g: THREE.Group; splash: THREE.Mesh; x: number; y: number; w: number; dir: number; seed: number }>; ducks: Array<{ c: Creature; a: number; r: number; speed: number }> };
  private frame = 0;
  private lastT = -1;

  constructor(private readonly heightAt: (x: number, y: number) => number) {
    this.root.name = "live";
    this.ringGeo.rotateX(-Math.PI / 2);
    this.discGeo.rotateX(-Math.PI / 2);
    this.planeGeo.rotateX(-Math.PI / 2);
    this.ambient = { fish: [], ducks: [] };
    // leaping fish: along the wild river, in Sông Cái and in the pond
    const sc = ZONES.song_cai;
    const spots: Array<[number, number, number]> = [
      [sc.ox + 220, sc.oy + 180, RIVER_LEVEL], [sc.ox + 470, sc.oy + 300, RIVER_LEVEL], [sc.ox + 760, sc.oy + 160, RIVER_LEVEL],
      [sc.ox + (RIVER.x0 + RIVER.x1) / 2, sc.oy + (RIVER.y0 + RIVER.y1) / 2 + 60, RIVER_LEVEL],
      [2300, 1790, RIVER_LEVEL], [3320, 1860, RIVER_LEVEL], [480, 1910, RIVER_LEVEL],

    ];
    spots.forEach(([x, y, w], i) => {
      const g = fishModel(this.mats, [0xc8b060, 0x9aa8b0, 0xe08a4a][i % 3]);
      g.visible = false;
      const splash = new THREE.Mesh(this.ringGeo, this.mats.foam);
      splash.visible = false;
      this.root.add(g, splash);
      this.ambient.fish.push({ g, splash, x, y, w, dir: hash01(i, 3) * Math.PI * 2, seed: 17 + i * 31 });
    });
    for (let i = 0; i < 3; i++) {
      const c = duckModel(this.mats);
      this.root.add(c.root);
      this.ambient.ducks.push({ c, a: i * 2.1, r: 0.45 + i * 0.12, speed: 0.05 + i * 0.015 });
    }
  }

  /** The billboards with riders seated (vehicles, boats: their act) and the gate guards added; `lifts()` then says how
   *  far up each rider sits (CharacterLayer.setLifts). Call before CharacterLayer.update. */
  adjust(list: readonly Billboard[], live: WorldLive): Billboard[] {
    this.lift.clear();
    const riding = new Map<string, number>();
    for (const v of live.vehicles ?? []) riding.set(v.riderId, SEAT_LIFT[v.kind]);
    const boats = new Map<string, number>();
    for (const b of live.boats ?? []) if (b.riderId) boats.set(b.riderId, this.waterY(b.x, b.y));
    const out = list.map((b): Billboard => {
      const lift = riding.get(b.id);
      if (lift !== undefined) { this.lift.set(b.id, lift); return { ...b, act: b.act ?? "ride" }; }
      const wy = boats.get(b.id);
      if (wy !== undefined) {
        const l = wy + 0.56 - 0.28 - this.heightAt(b.x, b.y);                  // on the bench (the sit pose's hips ≈ 0.28 up)
        this.lift.set(b.id, l);
        return { ...b, act: b.act ?? "sit" };
      }
      return b;
    });
    for (const g of live.gates ?? []) {
      if (!g.guard) continue;
      const side = g.w / 2 + 18, nx = -Math.sin(g.dir), ny = Math.cos(g.dir);
      const facing: Facing = Math.abs(Math.cos(g.dir)) > Math.abs(Math.sin(g.dir)) ? (Math.cos(g.dir) > 0 ? "left" : "right") : "down";
      out.push({ id: `guard:${g.id}`, look: GUARD_LOOK, x: g.x + nx * side + Math.cos(g.dir) * 10, y: g.y + ny * side + Math.sin(g.dir) * 10, facing, frame: 0, name: null });
    }
    return out;
  }

  /** Rider id → units above the ground (from the last adjust). */
  lifts(): ReadonlyMap<string, number> {
    return this.lift;
  }

  private waterY(x: number, y: number): number {
    const z = ZONES.pond;
    if (x >= z.ox && x < z.ox + z.w && y >= z.oy && y < z.oy + z.h) return POND_WATER;
    return RIVER_LEVEL;
  }

  private get<T extends THREE.Object3D>(id: string, key: string, make: () => T, data?: () => unknown): Entry {
    let e = this.entries.get(id);
    if (e && e.key !== key) { this.drop(id, e); e = undefined; }
    if (!e) {
      const obj = make();
      this.root.add(obj);
      e = { obj, key, seen: this.frame, motion: null, data: data?.(), extras: [] };
      this.entries.set(id, e);
    }
    e.seen = this.frame;
    return e;
  }

  private drop(id: string, e: Entry): void {
    for (const o of [e.obj, ...e.extras]) {
      this.root.remove(o);
      o.traverse((x) => {
        const m = x as THREE.Mesh;
        if (!m.isMesh) return;
        if (m.material === this.mats.baked && m.geometry !== this.ringGeo && m.geometry !== this.discGeo && m.geometry !== this.planeGeo) this.mats.forget(m.geometry);
        if ((m.material as THREE.Material).userData.own) (m.material as THREE.Material).dispose();
        if ((m as THREE.InstancedMesh).isInstancedMesh) (m as THREE.InstancedMesh).dispose();
      });
    }
    this.entries.delete(id);
  }

  /** A creature by id: made on first sight (its parts kept with the entry). */
  private creature(id: string, key: string, make: () => Creature): { e: Entry; c: Creature } {
    const e = this.get(id, key, () => {
      const c = make();
      c.root.userData.creature = c;
      return c.root;
    });
    return { e, c: e.obj.userData.creature as Creature };
  }

  private place(o: THREE.Object3D, x: number, y: number, lift = 0): void {
    o.position.set(U(x), this.heightAt(x, y) + lift, U(y));
  }

  /** One frame. `people`: where the riders are drawn (vehicles and boats ride under them). */
  update(live: WorldLive, people: CharacterLayer, t: number, night: number, reduced: boolean): void {
    const f = ++this.frame;
    const dt = this.lastT < 0 ? 1 / 60 : Math.min(0.1, (t - this.lastT) / 1000);
    this.lastT = t;
    const tm = reduced ? 0 : t;

    for (const s of live.stalls ?? []) {
      const goods = Math.round((s.goods ?? 0.7) * 8);
      const e = this.get(`stall:${s.id}`, `${s.owner}|${s.color ?? 0}|${goods}|${s.name ?? ""}`, () => {
        const g = stallModel(this.mats, s.color ?? (s.owner === "player" ? 0x2a7ab8 : 0xc0392b), goods / 8, s.owner === "player");
        if (s.owner === "player" && s.name) { const l = this.labels.sprite(s.name, "name", 0.36); l.position.set(0, 2.75, 0.7); g.add(l); }
        return g;
      });
      this.place(e.obj, s.x, s.y);
    }

    for (const r of live.rings ?? []) {
      const e = this.get(`ring:${r.id}`, `${r.r}|${r.label}|${r.active}`, () => {
        const g = ringModel(this.mats, U(r.r));
        const l = this.labels.sprite(r.active ? `⚔ ${r.label}` : r.label, "ring", 0.5);
        l.position.set(0, 2.2, 0);
        g.add(l);
        if (r.active) {
          const glow = new THREE.Mesh(this.ringGeo, this.mats.decal);
          glow.scale.setScalar(U(r.r) + 0.4);
          glow.position.y = 0.1;
          glow.name = "glow";
          g.add(glow);
        }
        return g;
      });
      this.place(e.obj, r.x, r.y);
      const glow = e.obj.getObjectByName("glow");
      if (glow) glow.scale.setScalar(U(r.r) + 0.4 + Math.sin(tm / 200) * 0.12);
    }

    for (const b of live.bosses ?? []) this.boss(b, tm, dt);

    for (const a of live.animals ?? []) {
      const { e, c } = this.creature(`animal:${a.id}`, a.species, () => wildAnimal(this.mats, a.species));
      e.motion = stepMotion(e.motion, a.x, a.y, dt, a.fleeing);
      this.place(e.obj, a.x, a.y);
      if (a.species === "firefly") {
        e.obj.visible = night > 0.3;
        c.body.position.y = Math.sin(tm / 400 + e.motion.phase) * 0.3;
        c.body.children[0].scale.setScalar(0.8 + 0.4 * Math.abs(Math.sin(tm / 230 + a.x)));
      } else this.animate(c, e.motion, tm, !!a.fleeing, reduced);
    }

    for (const h of live.houses ?? []) {
      const lot = LOTS[h.lot];
      if (!lot) continue;
      const kz = ZONES.khu_nha, w = U(lot.w) - 0.5, d = U(lot.h) - 0.3;
      const wall = [0xf0e0c0, 0xe6b8a8, 0xcfe0d4, 0xa8bcd8, 0xecd07a][Math.floor(hash01(h.lot, (h.ownerName ?? "").length) * 5)];
      const e = this.get(`house:${h.lot}`, `${h.built}|${h.roof}|${h.owned}|${h.ownerName ?? ""}|${!!h.mine}`, () => {
        const g = h.built ? houseModel(this.mats, w, d, h.roof, wall) : lotSign(this.mats, h.owned, w, d);
        g.rotation.y = Math.PI;                                                         // the lots face the street (north)
        if (h.owned && h.ownerName) { const l = this.labels.sprite(h.mine ? `★ ${h.ownerName}` : h.ownerName, "name", 0.4); l.position.set(0, h.built ? 4.4 : 3, 0); g.add(l); }
        return g;
      });
      this.place(e.obj, kz.ox + lot.x + lot.w / 2, kz.oy + lot.y + lot.h / 2);
    }
    this.mats.windows.emissiveIntensity = night * 1.2;

    for (const b of live.boats ?? []) {
      const e = this.get(`boat:${b.id}`, "ghe", () => boatModel(this.mats).root, () => {
        const foam = new THREE.InstancedMesh(this.planeGeo, this.mats.foam, 40);
        foam.count = 0;
        foam.frustumCulled = false;
        return { wake: [], foam } as Partial<BoatParts>;
      });
      const parts = e.data as BoatParts;
      if (!parts.foam.parent) { this.root.add(parts.foam); e.extras.push(parts.foam); }
      parts.b ??= { root: e.obj as THREE.Group, oar: (e.obj as THREE.Group).children[1] };
      e.motion = stepMotion(e.motion, b.x, b.y, dt);
      const wy = this.waterY(b.x, b.y);
      e.obj.position.set(U(b.x), wy - 0.06 + (reduced ? 0 : Math.sin(tm / 600 + b.x) * 0.04), U(b.y));
      e.obj.rotation.y = e.motion.yaw;
      e.obj.rotation.z = reduced ? 0 : Math.sin(tm / 900) * 0.04;
      const moving = e.motion.speed > 3;
      parts.b.oar.rotation.y = moving && !reduced ? Math.sin(tm / 260) * 0.5 : 0.2;
      parts.wake = moving ? pushWake(parts.wake, b.x, b.y, e.motion.yaw, t) : pushWake(parts.wake, parts.wake.at(-1)?.x ?? b.x, parts.wake.at(-1)?.y ?? b.y, e.motion.yaw, t);
      this.drawWake(parts, t, wy);
    }

    for (const d of live.digs ?? []) {
      const e = this.get(`dig:${d.id}`, d.state, () => {
        const g = digModel(this.mats, d.state === "dug");
        if (d.state === "hint") {
          const sp = this.mats.mesh(new THREE.OctahedronGeometry(0.12, 0), this.mats.glow, false);
          sp.name = "sparkle";
          sp.position.y = 0.8;
          g.add(sp);
        }
        return g;
      });
      this.place(e.obj, d.x, d.y);
      const sp = e.obj.getObjectByName("sparkle");
      if (sp) { sp.rotation.y = tm / 300; sp.position.y = 0.7 + Math.sin(tm / 350) * 0.15; }
    }

    for (const fsh of live.fishing ?? []) {
      const e = this.get(`fish:${fsh.id}`, "bob", () => new THREE.Group(), () => {
        const bob = bobberModel(this.mats);
        const rings = [0, 1].map(() => new THREE.Mesh(this.ringGeo, this.mats.foam));
        const alert = this.labels.sprite("!", "alert", 0.9);
        return { bob, rings, alert } as FishParts;
      });
      const p = e.data as FishParts;
      if (!p.bob.parent) e.obj.add(p.bob, ...p.rings, p.alert);
      const wy = this.waterY(fsh.x, fsh.y);
      e.obj.position.set(U(fsh.x), wy, U(fsh.y));
      const pull = fsh.hooked ? fsh.tension : 0;
      p.bob.position.y = reduced ? 0 : -pull * 0.12 * (1 + Math.sin(tm / 70)) + Math.sin(tm / 500) * 0.03;
      p.bob.position.x = reduced ? 0 : pull * Math.sin(tm / 130) * 0.15;
      p.rings.forEach((r, i) => {
        const k = ((tm / (fsh.hooked ? 500 : 1400) + i * 0.5) % 1);
        r.scale.setScalar(0.2 + k * (fsh.hooked ? 1.3 : 0.8));
        r.position.y = 0.02;
      });
      p.alert.visible = fsh.hooked;
      p.alert.position.y = 1.2 + (reduced ? 0 : Math.abs(Math.sin(tm / 160)) * 0.2);
    }

    const petSlots = new Map<string, number>();
    for (const pet of live.pets ?? []) {
      const { e, c } = this.creature(`pet:${pet.id}`, pet.species, () => petModel(this.mats, pet.species));
      let { x, y } = pet;
      const owner = people.feetOf(pet.ownerId);
      if (!Number.isFinite(x) && owner) {
        const slot = petSlots.get(pet.ownerId) ?? 0;
        petSlots.set(pet.ownerId, slot + 1);
        ({ x, y } = trailSpot({ x: owner.pos.x * 16, y: owner.pos.z * 16 }, owner.yaw, slot));
      }
      e.motion = stepMotion(e.motion, x, y, dt);
      this.place(e.obj, x, y);
      e.obj.visible = !owner || owner.visible;
      this.animate(c, e.motion, tm, false, reduced);
    }

    for (const v of live.vehicles ?? []) {
      const rider = people.feetOf(v.riderId);
      const e = this.get(`veh:${v.riderId}`, `${v.kind}|${v.color ?? 0}`, () => new THREE.Group(), () => vehicleModel(this.mats, v.kind, v.color ?? 0xc0392b));
      const veh = e.data as Vehicle;
      if (!veh.root.parent) e.obj.add(veh.root);
      e.obj.visible = !!rider && rider.visible;
      if (!rider) continue;
      const lift = this.lift.get(v.riderId) ?? SEAT_LIFT[v.kind];
      e.obj.position.set(rider.pos.x, rider.pos.y - lift, rider.pos.z);
      e.obj.rotation.y = rider.yaw;
      e.motion = stepMotion(e.motion, rider.pos.x * 16, rider.pos.z * 16, dt);
      const spin = (e.motion.speed / 16) * dt / veh.radius;
      for (const w of veh.wheels) w.rotation.x += reduced ? 0 : spin;
    }

    for (const g of live.gates ?? []) {
      const e = this.get(`gate:${g.id}`, `${g.w}`, () => new THREE.Group(), () => {
        const b = barrierModel(this.mats, U(g.w));
        const spear = spearModel(this.mats);
        spear.position.set(U(g.w / 2 + 18) + 0.35, 0, 0.3);               // by the guard (the pole's side)
        return { b, spear };
      });
      const parts = e.data as { b: Barrier; spear: THREE.Group };
      if (!parts.b.root.parent) e.obj.add(parts.b.root, parts.spear);
      this.place(e.obj, g.x, g.y);
      e.obj.rotation.y = Math.atan2(-Math.cos(g.dir), -Math.sin(g.dir));   // local +x (the pole) across the road
      parts.spear.visible = g.guard;
      const want = g.open ? 1.35 : 0;
      parts.b.pole.rotation.z += (want - parts.b.pole.rotation.z) * (reduced ? 1 : Math.min(1, dt * 4));
    }

    for (const dg of live.dogs ?? []) {
      const { e, c } = this.creature(`dog:${dg.id}`, dg.coat ?? "vang", () => dogModel(this.mats, dg.coat));
      e.motion = stepMotion(e.motion, dg.x, dg.y, dt);
      this.place(e.obj, dg.x, dg.y);
      this.animate(c, e.motion, tm, false, reduced);
    }
    (live.leaps ?? []).forEach((l, i) => {
      const e = this.get(`leap:${i}`, "fish", () => fishModel(this.mats, 0xc8b060));
      const wy = this.waterY(l.x, l.y);
      e.obj.visible = l.h > 0;
      e.obj.position.set(U(l.x), wy + l.h * 1.3 - 0.1, U(l.y));
      e.obj.rotation.set(0.9 - l.h * 1.8 * (i % 2 ? -1 : 1) * 0.5, i * 1.3, 0);
    });
    for (const r of live.rats ?? []) {
      const { e, c } = this.creature(`rat:${r.id}`, "rat", () => ratModel(this.mats));
      e.motion = stepMotion(e.motion, r.x, r.y, dt, true);
      this.place(e.obj, r.x, r.y);
      this.animate(c, e.motion, tm, !r.fallen, reduced);
      c.root.rotation.z = r.fallen ? Math.PI / 2 : 0;
    }

    for (const [id, e] of this.entries) if (e.seen !== f) this.drop(id, e);
    this.animateAmbient(tm, dt, reduced);
  }

  private animate(c: Creature, m: Motion, t: number, fleeing: boolean, reduced: boolean): void {
    c.root.rotation.y = m.yaw;
    const g = gait(m.speed, fleeing);
    const s = reduced ? 0 : Math.sin(m.phase), k = g.amp;
    if (c.legs.length === 4) {
      c.legs[0].rotation.x = c.legs[3].rotation.x = s * k;
      c.legs[1].rotation.x = c.legs[2].rotation.x = -s * k;
    }
    c.body.position.y = c.hop && g.freq > 0 && !reduced ? Math.abs(Math.sin(m.phase / 2)) * 0.18 : 0;
    c.body.rotation.x = fleeing && g.freq > 0 ? -0.08 : 0;
    if (c.head) c.head.rotation.x = g.freq === 0 && !reduced ? Math.max(0, Math.sin(t / 1400 + m.phase)) * 0.5 : 0;   // grazing
    if (c.tail) c.tail.rotation.y = reduced ? 0 : Math.sin(t / (fleeing ? 90 : 220)) * 0.35;
    if (c.wings.length) {
      const air = c.flies && (fleeing || g.freq > 2.5);
      const flap = air && !reduced ? Math.sin(t / 55) * 0.9 : 0.1;
      c.wings[0].rotation.z = flap; c.wings[1].rotation.z = -flap;
      c.body.position.y = air ? Math.min(2.5, c.body.position.y + 0.5 + Math.sin(t / 300) * 0.2) : c.body.position.y;
    }
  }

  private boss(b: LiveBoss, t: number, dt: number): void {
    const e = this.get(`boss:${b.id}`, b.kind, () => new THREE.Group(), () => {
      const c = bossModel(this.mats, b.kind);
      const bar = this.labels.sprite(b.name, "boss", 0.5);
      const fillMat = new THREE.SpriteMaterial({ color: 0xe0342a, depthTest: false });
      fillMat.userData.own = true;
      const fill = new THREE.Sprite(fillMat);
      fill.center.set(0, 0.5);
      fill.renderOrder = 11;
      return { c, bar, fill, decals: [], arena: null, arenaKey: "" } as BossParts;
    });
    const p = e.data as BossParts;
    if (!p.c.root.parent) {
      e.obj.add(p.c.root, p.bar, p.fill);
      p.bar.position.y = p.c.height + 1.35;
      p.fill.position.set(-1.2, p.c.height + 0.8, 0);
    }
    const water = b.kind === "thuy_quai";
    e.motion = stepMotion(e.motion, b.x, b.y, dt);
    e.obj.position.set(U(b.x), water ? this.waterY(b.x, b.y) - 0.3 : this.heightAt(b.x, b.y), U(b.y));
    if (b.facing !== undefined) e.motion.yaw = b.facing;
    this.animate(p.c, e.motion, t, false, false);
    if (water) p.c.body.position.y = Math.sin(t / 700) * 0.25;
    p.fill.scale.set(2.4 * Math.max(0, Math.min(1, b.hp)), 0.16, 1);
    // the arena's rope and flags (world px rect), rebuilt when it changes
    const ak = b.arena ? `${b.arena.x}|${b.arena.y}|${b.arena.w}|${b.arena.h}` : "";
    if (ak !== p.arenaKey) {
      if (p.arena) {
        this.root.remove(p.arena);
        e.extras.splice(e.extras.indexOf(p.arena), 1);
        p.arena.traverse((o) => { const m = o as THREE.InstancedMesh; if (m.isInstancedMesh) { this.mats.forget(m.geometry); m.dispose(); } });
      }
      p.arena = b.arena ? this.arenaRope(b.arena) : null;
      if (p.arena) { this.root.add(p.arena); e.extras.push(p.arena); }
      p.arenaKey = ak;
    }
    // telegraphs: red decals on the ground, filling as they wind up
    const tg = b.telegraphs ?? [];
    while (p.decals.length < tg.length) {
      const mat = this.mats.decal.clone();
      mat.userData.own = true;
      const d = new THREE.Mesh(this.discGeo, mat);
      d.renderOrder = 2;
      this.root.add(d);
      e.extras.push(d);
      p.decals.push(d);
    }
    p.decals.forEach((d, i) => {
      const x = tg[i];
      d.visible = !!x;
      if (!x) return;
      const look = telegraphLook(x.k, t);
      (d.material as THREE.MeshBasicMaterial).opacity = look.opacity;
      const gy = water ? this.waterY(x.x, x.y) + 0.04 : this.heightAt(x.x, x.y) + 0.06;
      if (x.shape === "circle") {
        d.geometry = this.discGeo;
        d.scale.set(U(x.r) * (0.35 + 0.65 * look.fill), 1, U(x.r) * (0.35 + 0.65 * look.fill));
        d.position.set(U(x.x), gy, U(x.y));
        d.rotation.y = 0;
      } else {
        const len = x.len ?? 120, dir = x.dir ?? 0;
        d.geometry = this.planeGeo;
        d.scale.set(U(x.r) * 2, 1, U(len) * look.fill);
        d.rotation.y = Math.atan2(Math.cos(dir), Math.sin(dir));           // the plane's +z along the line
        const mid = (len * look.fill) / 2;
        d.position.set(U(x.x + Math.cos(dir) * mid), gy, U(x.y + Math.sin(dir) * mid));
      }
    });
  }

  private arenaRope(a: { x: number; y: number; w: number; h: number }): THREE.Group {
    const g = new THREE.Group();
    const posts: Array<[number, number]> = [];
    const per = 48;
    for (let x = a.x; x <= a.x + a.w; x += per) posts.push([x, a.y], [x, a.y + a.h]);
    for (let y = a.y + per; y < a.y + a.h; y += per) posts.push([a.x, y], [a.x + a.w, y]);
    const geo = new THREE.CylinderGeometry(0.07, 0.08, 1.3, 5);
    geo.translate(0, 0.65, 0);
    const flag = new THREE.BoxGeometry(0.02, 0.3, 0.45);
    flag.translate(0, 1.1, 0.24);
    const pm = new THREE.InstancedMesh(geo, this.mats.baked, posts.length), fm = new THREE.InstancedMesh(flag, this.mats.baked, posts.length);
    this.mats.mesh(geo); this.mats.mesh(flag);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    posts.forEach(([x, y], i) => {
      m.makeTranslation(U(x), this.heightAt(x, y), U(y));
      pm.setMatrixAt(i, m); fm.setMatrixAt(i, m);
      pm.setColorAt(i, c.setHex(0x6e4424)); fm.setColorAt(i, c.setHex(i % 2 ? 0xf2c240 : 0xc0392b));
    });
    // vertex colours are white: the instance colour paints them
    for (const gg of [geo, flag]) { const n = gg.getAttribute("position").count; gg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3)); }
    g.add(pm, fm);
    return g;
  }

  private drawWake(p: BoatParts, t: number, wy: number): void {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    p.foam.count = p.wake.length;
    p.wake.forEach((w, i) => {
      const age = Math.min(1, (t - w.t) / 2600);
      const spread = 0.6 + age * 2.2;
      m.compose(pos.set(U(w.x), wy + 0.03, U(w.y)), q.setFromAxisAngle(up, w.yaw), s.set(spread, 1, 0.35 * (1 - age) + 0.05));
      p.foam.setMatrixAt(i, m);
    });
    p.foam.instanceMatrix.needsUpdate = true;
  }

  private animateAmbient(t: number, dt: number, reduced: boolean): void {
    for (const f of this.ambient.fish) {
      const l = reduced ? null : leap(t, f.seed);
      f.g.visible = !!l;
      f.splash.visible = false;
      if (!l) continue;
      const dir = f.dir + l.n * 1.7, span = 2.2;
      const ox = f.x / 16 + Math.cos(dir) * (l.u - 0.5) * span, oz = f.y / 16 + Math.sin(dir) * (l.u - 0.5) * span;
      f.g.position.set(ox, f.w + l.h - 0.1, oz);
      f.g.rotation.set(0, Math.atan2(Math.cos(dir), Math.sin(dir)), 0);
      f.g.rotateX(l.pitch * 0.6);
      if (l.u < 0.15 || l.u > 0.85) {
        f.splash.visible = true;
        f.splash.position.set(ox, f.w + 0.02, oz);
        f.splash.scale.setScalar(0.3 + (l.u < 0.5 ? l.u : 1 - l.u) * 3);
      }
    }
    const pond = ZONES.pond;
    for (const d of this.ambient.ducks) {
      if (!reduced) d.a += d.speed * dt;
      const x = pond.ox + POND_CX + Math.cos(d.a) * POND_RX * d.r, y = pond.oy + POND_CY + Math.sin(d.a) * POND_RY * d.r;
      d.c.root.position.set(U(x), POND_WATER - 0.2 + (reduced ? 0 : Math.sin(t / 500 + d.a * 9) * 0.02), U(y));
      d.c.root.rotation.y = Math.atan2(-Math.sin(d.a) * POND_RX, Math.cos(d.a) * POND_RY);
    }
  }

  /** How many live things are drawn (dev stats). */
  count(): number {
    return this.entries.size;
  }

  dispose(): void {
    for (const [id, e] of this.entries) this.drop(id, e);
    this.root.clear();
    this.mats.dispose();
    this.labels.dispose();
    this.ringGeo.dispose();
    this.discGeo.dispose();
    this.planeGeo.dispose();
  }
}
