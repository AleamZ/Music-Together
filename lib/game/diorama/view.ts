import * as THREE from "three";
import type { PlotDraw } from "@/lib/game/art/crops";
import type { GameMap } from "@/lib/game/maps/types";
import type { Vec } from "@/lib/game/types";
import { CharacterLayer } from "./character/layer";
import { animateWater, type Built } from "./build";
import {
  clampOrbit, flyForward, flyFromOrbit, FOLLOW_ORBIT, lerp3, orbitEye, OVERVIEW_ORBIT, smoothK, stepFly, type FlyState, type Orbit, type V3,
} from "./camera";
import { pxToWorld, rayToMapPx } from "./coords";
import { createFpsMonitor, type FpsMonitor } from "./quality";
import type { CameraMode, DioramaFrame, Quality, View3D } from "./types";
import { WeatherLayer } from "./weather3d";
import { buildMapScene } from "./zones";

// Browser only: the diorama view of a map (the pond for now). The engine keeps the game — movement, collision, the
// network — and hands this view a DioramaFrame every animation frame; the view draws it with Three.js (WebGL2).

export interface DioramaViewOptions {
  /** A tap/click (not a drag) on the ground: the map px under it. */
  onTap?: (p: Vec) => void;
  /** Allow the free-fly camera (dev only). */
  allowFree?: boolean;
  /** Start in "low" quality, or pin a quality (no auto pick). */
  quality?: Quality | "auto";
}

/** `cpuMs`: the average CPU time of one render() call (the GPU's share is not included). */
export interface DioramaStats { fps: number; cpuMs: number; quality: Quality; calls: number; triangles: number; mode: CameraMode }

const SKY_DAY = new THREE.Color(0x9fd3f0), SKY_DUSK = new THREE.Color(0xf2a36b), SKY_NIGHT = new THREE.Color(0x0d1a3a);
const GREY_SKY: Record<string, number> = { cloudy: 0x9aa4b0, fog: 0xc4c9ce, rain: 0x6f7c8e, thunder: 0x566074, storm: 0x4a5264, snow: 0xd6dfec };
const FOG: Record<string, [number, number]> = {
  clear: [70, 160], cloudy: [55, 130], fog: [6, 42], rain: [30, 95], thunder: [26, 85], storm: [20, 70], snow: [22, 80],
};
const FREE_KEYS: Record<string, keyof FlyInput> = {
  KeyW: "f", ArrowUp: "f", KeyS: "b", ArrowDown: "b", KeyA: "l", ArrowLeft: "l", KeyD: "r", ArrowRight: "r",
  Space: "u", KeyC: "d", ShiftLeft: "fast", ShiftRight: "fast",
};
interface FlyInput { f: boolean; b: boolean; l: boolean; r: boolean; u: boolean; d: boolean; fast: boolean }

export class DioramaView implements View3D {
  private readonly canvas: HTMLCanvasElement;
  private readonly map: GameMap;
  private readonly opts: DioramaViewOptions;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.3, 400);
  private readonly hemi = new THREE.HemisphereLight(0xdff2ff, 0x5a7a3a, 1.4);
  private readonly sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
  private readonly fog = new THREE.Fog(0x9fd3f0, 70, 160);
  private readonly built: Built;
  private readonly heightAt: (x: number, y: number) => number;
  private readonly people: CharacterLayer;
  private readonly weather = new WeatherLayer();
  private readonly monitor: FpsMonitor;
  private readonly ro: ResizeObserver;
  private mode: CameraMode = "follow";
  private follow: Orbit = { ...FOLLOW_ORBIT };
  private overview: Orbit = { ...OVERVIEW_ORBIT };
  private fly: FlyState = flyFromOrbit({ x: 0, y: 0, z: 0 }, OVERVIEW_ORBIT);
  private flyIn: FlyInput = { f: false, b: false, l: false, r: false, u: false, d: false, fast: false };
  private eye: V3 = { x: 0, y: 40, z: 40 };
  private look: V3 = { x: 0, y: 0, z: 0 };
  private lastT = -1;
  private quality: Quality = "high";
  private drag: { id: number; x: number; y: number; moved: boolean; button: number } | null = null;
  private flashUntil = 0;
  private cpuMs = 0;
  private disposed = false;
  private readonly tmpSky = new THREE.Color();
  private readonly tmpTint = new THREE.Color();

  constructor(canvas: HTMLCanvasElement, map: GameMap, opts: DioramaViewOptions = {}) {
    this.canvas = canvas;
    this.map = map;
    this.opts = opts;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.monitor = createFpsMonitor({ start: opts.quality === "low" ? "low" : "high" });
    if (opts.quality === "high" || opts.quality === "low") this.monitor.force(opts.quality);

    const scene = buildMapScene(map);
    this.built = scene.built;
    this.heightAt = scene.heightAt;
    this.scene.add(this.built.root);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(0x9fd3f0);
    this.scene.add(this.hemi);
    const half = Math.max(map.width, map.height) / 16 / 2 + 4;
    this.sun.position.set(-18, 34, 14);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 100 });
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    this.people = new CharacterLayer(map, this.heightAt);
    this.scene.add(this.people.root, this.weather.root);
    this.applyQuality(this.monitor.quality());

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("keyup", this.onKey, true);
  }

  // ------------------------------------------------------------ controls

  setCameraMode(m: CameraMode): void {
    if (m === "free" && !this.opts.allowFree) return;
    if (m === "free" && this.mode !== "free") {
      // take off from where the camera is now
      const dx = this.look.x - this.eye.x, dy = this.look.y - this.eye.y, dz = this.look.z - this.eye.z;
      this.fly = { pos: { ...this.eye }, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
    }
    this.mode = m;
    this.flyIn = { f: false, b: false, l: false, r: false, u: false, d: false, fast: false };
  }

  cameraMode(): CameraMode {
    return this.mode;
  }

  /** Pin a quality, or "auto" (drops to low when the fps stays under 40). */
  setQuality(q: Quality | "auto"): void {
    if (q === "auto") { this.monitor.auto(); this.applyQuality(this.monitor.quality()); return; }
    this.monitor.force(q);
    this.applyQuality(q);
  }

  stats(): DioramaStats {
    const info = this.renderer.info.render;
    return { fps: Math.round(this.monitor.fps()), cpuMs: Math.round(this.cpuMs * 10) / 10, quality: this.quality, calls: info.calls, triangles: info.triangles, mode: this.mode };
  }

  /** The field's plots (the crops by stage); the other maps ignore them. */
  setPlots(plots: ReadonlyArray<PlotDraw>): void {
    this.built.setPlots?.(plots, Date.now());
  }

  /** Waits for the GPU to finish the queued frames (benchmarks only). */
  finish(): void {
    this.renderer.getContext().finish();
  }

  /** The map px under a client point (null off the map). */
  pick(clientX: number, clientY: number): Vec | null {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    const o = rc.ray.origin, d = rc.ray.direction;
    return rayToMapPx({ origin: [o.x, o.y, o.z], dir: [d.x, d.y, d.z] }, this.map);
  }

  private applyQuality(q: Quality): void {
    this.quality = q;
    const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === "high" ? Math.min(dpr, 2) : Math.min(dpr, 1) * 0.75);
    this.sun.castShadow = q === "high";
    this.people.setQuality(q);
    for (const t of this.built.thinnable) t.mesh.count = q === "high" ? t.full : Math.ceil(t.full * 0.45);
    this.resize();
  }

  private resize(): void {
    const w = Math.max(1, this.canvas.clientWidth), h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private readonly onContextMenu = (e: Event): void => { e.preventDefault(); };

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, button: e.button };
    this.canvas.setPointerCapture?.(e.pointerId);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    d.moved = true;
    d.x = e.clientX; d.y = e.clientY;
    if (this.mode === "free") {
      this.fly = { ...this.fly, yaw: this.fly.yaw - dx * 0.004, pitch: Math.max(-1.5, Math.min(1.5, this.fly.pitch - dy * 0.004)) };
      return;
    }
    const o = this.mode === "follow" ? this.follow : this.overview;
    const next = clampOrbit({ ...o, yaw: o.yaw - dx * 0.006, pitch: o.pitch + dy * 0.004 });
    if (this.mode === "follow") this.follow = next; else this.overview = next;
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    this.drag = null;
    if (d.moved || d.button !== 0 || e.type === "pointercancel") return;
    const p = this.pick(e.clientX, e.clientY);
    if (p) this.opts.onTap?.(p);
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const f = Math.exp(e.deltaY * 0.001);
    if (this.mode === "follow") this.follow = clampOrbit({ ...this.follow, distance: this.follow.distance * f });
    else if (this.mode === "overview") this.overview = clampOrbit({ ...this.overview, distance: this.overview.distance * f });
  };

  /** Free-fly keys: caught before the game sees them (the character stays put while the camera flies). */
  private readonly onKey = (e: KeyboardEvent): void => {
    if (this.mode !== "free") return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const k = FREE_KEYS[e.code];
    if (!k) return;
    this.flyIn = { ...this.flyIn, [k]: e.type === "keydown" };
    e.preventDefault();
    e.stopPropagation();
  };

  // ------------------------------------------------------------ frame

  render(f: DioramaFrame): void {
    if (this.disposed) return;
    const start = performance.now();
    this.draw(f);
    this.cpuMs += (performance.now() - start - this.cpuMs) * 0.05;
  }

  private draw(f: DioramaFrame): void {
    const dt = this.lastT < 0 ? 1 / 60 : Math.min(0.1, (f.t - this.lastT) / 1000);
    if (this.lastT >= 0) {
      const q = this.monitor.sample(f.t - this.lastT);
      if (q !== this.quality) this.applyQuality(q);
    }
    this.lastT = f.t;

    this.updateCamera(f, dt);
    this.updateLight(f);
    const t = f.reduced ? 0 : f.t;
    animateWater(this.built, t, f.windKmh);
    const amp = f.reduced ? 0 : 0.03 + Math.min(0.25, f.windKmh / 200);
    for (const s of this.built.sway) s.obj.rotation.z = s.base + Math.sin(t / 700 + s.seed) * amp;
    if (this.built.flowers) this.built.flowers.position.y = f.reduced ? 0 : Math.sin(t / 700) * 0.02;

    // x-ray roofs: a roof the player stands under (or just behind, where it hides them from the tilted camera) fades
    const k = smoothK(dt, 8);
    for (const r of this.built.roofs) {
      const near = f.focus.x > r.x - 12 && f.focus.x < r.x + r.w + 12 && f.focus.y > r.y - 56 && f.focus.y < r.y + r.h + 40;
      const target = this.mode === "follow" && near ? 0.22 : 1;
      for (const m of r.mats) {
        m.opacity += (target - m.opacity) * (f.reduced ? 1 : k);
        m.depthWrite = m.opacity > 0.95;
      }
    }

    const yaw = this.mode === "free" ? this.fly.yaw : Math.atan2(this.eye.x - this.look.x, this.eye.z - this.look.z);
    this.people.update(f.billboards, yaw, f.t, f.reduced);
    this.weather.update(f.weather, f.fx, f.reduced, f.t, new THREE.Vector3(this.look.x, 0, this.look.z), f.windKmh, this.quality === "low");
    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(f: DioramaFrame, dt: number): void {
    const focus = pxToWorld(f.focus, this.map);
    const onDeck = Math.max(0, this.heightAt(f.focus.x, f.focus.y));
    let eye: V3, look: V3, rate = 5;
    if (this.mode === "follow") {
      look = { x: focus.x, y: onDeck + 1.3, z: focus.z };
      eye = orbitEye(look, this.follow);
    } else if (this.mode === "overview") {
      if (!f.reduced && !this.drag) this.overview = { ...this.overview, yaw: this.overview.yaw + dt * 0.05 };
      look = { x: 0, y: 0, z: 0 };
      eye = orbitEye(look, this.overview);
      rate = 3;
    } else {
      const i = this.flyIn;
      this.fly = stepFly(this.fly, { fwd: +i.f - +i.b, right: +i.r - +i.l, up: +i.u - +i.d, fast: i.fast }, dt);
      const fw = flyForward(this.fly);
      eye = this.fly.pos;
      look = { x: eye.x + fw.x, y: eye.y + fw.y, z: eye.z + fw.z };
      rate = 30;
    }
    const k = f.reduced ? 1 : smoothK(dt, rate);
    this.eye = lerp3(this.eye, eye, k);
    this.look = lerp3(this.look, look, k);
    this.camera.position.set(this.eye.x, this.eye.y, this.eye.z);
    this.camera.lookAt(this.look.x, this.look.y, this.look.z);
  }

  /** The 2D game's light model in 3D: night/dusk from the same `night`/`warm`, the weather's grey, fog and the lamps. */
  private updateLight(f: DioramaFrame): void {
    if (this.built.cave) { this.caveLight(f); return; }
    const kind = f.weather ?? "clear";
    const grey = GREY_SKY[kind];
    const overcast = grey === undefined ? 0 : kind === "cloudy" ? 0.45 : kind === "fog" ? 0.7 : 0.75;
    const sky = this.tmpSky.copy(SKY_DAY);
    if (grey !== undefined) sky.lerp(new THREE.Color(grey), overcast * (f.fx / 4));
    sky.lerp(SKY_DUSK, f.warm * 0.6).lerp(SKY_NIGHT, f.night);
    (this.scene.background as THREE.Color).copy(sky);
    const [near, far] = FOG[kind] ?? FOG.clear;
    const fogK = f.fx / 4;
    this.fog.color.copy(sky);
    this.fog.near = FOG.clear[0] + (near - FOG.clear[0]) * fogK;
    this.fog.far = FOG.clear[1] + (far - FOG.clear[1]) * fogK;

    // lightning: a short white flash now and then in thunder and storms
    const stormy = kind === "thunder" || kind === "storm";
    if (stormy && !f.reduced && f.fx > 0 && f.t > this.flashUntil + 1500 && Math.random() < (kind === "storm" ? 0.006 : 0.003)) this.flashUntil = f.t + 140;
    const flash = f.t < this.flashUntil ? 1.6 * (f.fx / 4) : 0;

    const day = 1 - f.night;
    this.sun.intensity = (0.25 + 2.3 * day) * (1 - overcast * 0.55 * fogK);
    this.sun.color.setRGB(1, 0.95 - 0.25 * f.warm, 0.85 - 0.4 * f.warm).lerp(new THREE.Color(0x8fa8ff), f.night);
    this.hemi.intensity = 0.55 + 0.95 * day + flash;
    this.hemi.color.setHex(0xdff2ff).lerp(new THREE.Color(0x3a4a8a), f.night);
    this.hemi.groundColor.setHex(0x5a7a3a).lerp(new THREE.Color(0x141a30), f.night);
    for (const l of this.built.lamps) l.intensity = 9 * f.night;
    for (const b of this.built.bulbs) b.color.setHex(0xd23a3a).lerp(new THREE.Color(0xffd27a), f.night);
    for (const m of this.built.glow ?? []) m.emissiveIntensity = f.night * 0.9;

    // the sprites are unlit: tint them like the 2D night multiply (and the dusk's warmth)
    const tint = this.tmpTint.setRGB(1, 1, 1);
    tint.lerp(new THREE.Color(1, 0.86, 0.7), f.warm * 0.35);
    tint.lerp(new THREE.Color(0.36, 0.44, 0.72), f.night * 0.85);
    tint.multiplyScalar(1 - overcast * 0.15 * fogK);
    if (flash) tint.setRGB(1, 1, 1);
    this.people.setTint(tint);
  }

  /** P2: underground (Mỏ đá) — the same at any hour: a dark, warm fog, a dim cool fill from the tunnel and the lamps, the
   *  props' bulbs and the glowing moss always on (a flicker in the flames' light). */
  private caveLight(f: DioramaFrame): void {
    const bg = this.tmpSky.setHex(0x0c0a09);
    (this.scene.background as THREE.Color).copy(bg);
    this.fog.color.copy(bg);
    this.fog.near = 34;
    this.fog.far = 92;
    const flick = f.reduced ? 1 : 0.92 + 0.08 * Math.sin(f.t / 90) * Math.sin(f.t / 37);
    this.sun.intensity = 0.55;
    this.sun.color.setHex(0x9fb4d8);
    this.hemi.intensity = 0.75;
    this.hemi.color.setHex(0xb89a78);
    this.hemi.groundColor.setHex(0x1c140e);
    for (const l of this.built.lamps) l.intensity = 8 * flick;
    for (const b of this.built.bulbs) b.color.setHex(0xffd27a);
    for (const m of this.built.glow ?? []) m.emissiveIntensity = 0.9;
    this.people.setTint(this.tmpTint.setRGB(0.95, 0.86, 0.76));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ro.disconnect();
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("keyup", this.onKey, true);
    this.people.dispose();
    this.weather.dispose();
    this.built.dispose();
    this.sun.shadow.map?.dispose();
    this.scene.clear();
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
