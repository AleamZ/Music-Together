import * as THREE from "three";
import type { PlotDraw } from "@/lib/game/art/crops";
import { getMap } from "@/lib/game/maps/registry";
import type { GameMap } from "@/lib/game/maps/types";
import type { Vec } from "@/lib/game/types";
import { openingRect } from "@/lib/game/world/compose";
import { CHUNK_PX, CHUNKS_X, CHUNKS_Y } from "@/lib/game/world/scenery";
import { DOMAIN, RIVER_LEVEL, standHeight, ZONE_ELEV, zoneUnder } from "@/lib/game/world/terrain";
import { OPENINGS } from "@/lib/game/world/wild";
import { WORLD_H, WORLD_W, ZONE_IDS, ZONES, type OutdoorMapId } from "@/lib/game/world/zones";
import { animateWater, type Built } from "../build";
import { flyForward, lerp3, orbitEye, smoothK, type FlyState, type Orbit, type V3 } from "../camera";
import { RIG } from "../character/build";
import { CharacterLayer } from "../character/layer";
import { createFpsMonitor, type FpsMonitor } from "../quality";
import type { CameraMode, DioramaFrame, Quality, View3D } from "../types";
import { WeatherLayer } from "../weather3d";
import { buildMapScene } from "../zones";
import { demoFieldPlots } from "../zones/field";
import { Forest } from "./forest";
import { getCam, pinchBy, setCam, subscribeCam, zoomBy, type GameCam } from "./game-camera";
import { LiveLayer } from "./live";
import { liveFromFrame, type WorldLive } from "./live-plan";
import { mergeStatic } from "./merge";
import { InkPass, SkyDome } from "./post";
import { buildBridges, buildLandmarks, buildSkyLife, buildWater, type Landmarks, type SkyLife, type Water } from "./props";
import { TerrainJobs } from "./terrain-jobs";
import { chunkGeometry, landColor, LOD_STEPS } from "./terrain-mesh";
import { buildDelta } from "./delta";
import { buildNuiCam } from "./nuicam";
import { toon, toonify } from "./toon";
import { pixelize, pixelizeTree } from "../pixeltex";

// Browser only: the unified world in 3D (spec P2/P3's visual part). One continuous landscape — the heightmap's chunks
// at three levels of detail, the zones' dioramas (unchanged, restyled to the toon ramp) on their plateaus, the river,
// bridges, forests, landmarks, clouds, balloons and birds — inked and papered by one post pass. World px in, like the
// engine's (focus, billboards, taps); 3D is absolute (px / 16, lib/game/diorama/coords.ts). The engine integration
// (switching the game to the world map) is not wired yet: /dev/world drives it.

export interface WorldViewOptions {
  /** A tap/click (not a drag) on the ground: the world px under it. */
  onTap?: (p: Vec) => void;
  allowFree?: boolean;
  /** The game's camera (game-camera.ts): the follow distance and first person come from the shared camera state, and
   *  the wheel / a pinch write it back. Off (the /dev pages): the orbit's own wheel zoom. */
  gameCamera?: boolean;
  quality?: Quality | "auto";
  /** 0.5 … 1: scenery density (low-end devices build fewer trees). */
  density?: number;
}

export interface WorldStats {
  fps: number; cpuMs: number; quality: Quality; calls: number; triangles: number; mode: CameraMode;
  chunks: string; trees: number;
  /** Live things drawn (stalls, animals, bosses, vehicles…). */
  live: number;
}

interface ZoneScene { id: OutdoorMapId; built: Built; heightAt: (x: number, y: number) => number; root: THREE.Group;
  roofs: Array<{ mats: THREE.Material[]; x: number; y: number; w: number; h: number }>; glow: THREE.MeshToonMaterial[] }

interface Chunk { mesh: THREE.Mesh | null; level: number; want: number; geos: Array<THREE.BufferGeometry | null>; center: THREE.Vector3 }

const SKY = {
  day: { zenith: new THREE.Color(0x5ea7e0), horizon: new THREE.Color(0xd8ebf2) },
  dusk: { zenith: new THREE.Color(0x5a6fb0), horizon: new THREE.Color(0xffb27a) },
  night: { zenith: new THREE.Color(0x070d22), horizon: new THREE.Color(0x1c2748) },
};
const GREY_SKY: Record<string, number> = { cloudy: 0x9aa4b0, fog: 0xc4c9ce, rain: 0x6f7c8e, thunder: 0x566074, storm: 0x4a5264, snow: 0xd6dfec };
const FOG_K: Record<string, number> = { clear: 1, cloudy: 0.8, fog: 0.12, rain: 0.45, thunder: 0.4, storm: 0.32, snow: 0.45 };
const FREE_KEYS: Record<string, keyof FlyInput> = {
  KeyW: "f", ArrowUp: "f", KeyS: "b", ArrowDown: "b", KeyA: "l", ArrowLeft: "l", KeyD: "r", ArrowRight: "r",
  Space: "u", KeyC: "d", ShiftLeft: "fast", ShiftRight: "fast",
};
interface FlyInput { f: boolean; b: boolean; l: boolean; r: boolean; u: boolean; d: boolean; fast: boolean }

const CENTER: V3 = { x: WORLD_W / 32, y: 3, z: WORLD_H / 32 };
const ORBITS: Record<"follow" | "overview", { o: Orbit; min: number; max: number }> = {
  follow: { o: { yaw: 0.35, pitch: 0.62, distance: 30 }, min: 8, max: 120 },
  overview: { o: { yaw: -0.55, pitch: 0.44, distance: 225 }, min: 60, max: 520 },
};
/** Terrain LOD distances (units) by quality. */
const TERRAIN_LOD: Record<Quality, [number, number]> = { high: [90, 320], low: [50, 150] };
const LAMP_POOL = 4;

/** A zone's map with its openings cleared (the walls and hedges where the roads come in are left out). */
function openedMap(id: OutdoorMapId): GameMap {
  const m = getMap(id);
  const blocked = m.blocked.slice();
  for (const op of OPENINGS.filter((o) => o.zone === id)) {
    const portal = m.interactables.find((i) => i.id === op.portal);
    if (!portal) continue;
    const rc = openingRect(op, portal.use);
    for (let y = Math.max(0, Math.floor(rc.y / m.cell)); y < Math.min(m.rows, Math.ceil((rc.y + rc.h) / m.cell)); y++)
      for (let x = Math.max(0, Math.floor(rc.x / m.cell)); x < Math.min(m.cols, Math.ceil((rc.x + rc.w) / m.cell)); x++) blocked[y * m.cols + x] = 0;
  }
  return { ...m, blocked };
}

export class WorldView implements View3D {
  private readonly canvas: HTMLCanvasElement;
  private readonly opts: WorldViewOptions;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.5, 1500);
  private readonly hemi = new THREE.HemisphereLight(0xdff2ff, 0x5a7a3a, 1.2);
  private readonly sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
  private readonly fog = new THREE.Fog(0xd8ebf2, 150, 900);
  private readonly sky = new SkyDome();
  private readonly ink: InkPass;
  private readonly terrainMat = toon({ vertexColors: true });
  private readonly chunks: Chunk[] = [];
  private readonly terrain = new THREE.Group();
  private readonly jobs = new TerrainJobs((c, level, geo) => this.chunkBuilt(c, level, geo));
  private horizon: THREE.Mesh | null = null;
  private sea: THREE.Mesh | null = null;
  /** The muddy brown-green water of the delta (the river mouths, the canals). */
  private readonly seaMat = toon({ color: 0x8a8a52, transparent: true, opacity: 0.9 });
  private readonly zones: ZoneScene[] = [];
  private readonly mergedGeos: THREE.BufferGeometry[] = [];
  private readonly mergedMats: THREE.Material[] = [];
  /** Per zone: its meshes before and after the static merge (dev stats). */
  readonly meshCounts: Partial<Record<OutdoorMapId, [number, number]>> = {};
  private readonly lamps: Array<{ pos: THREE.Vector3; color: THREE.Color; distance: number }> = [];
  private readonly pool: THREE.PointLight[] = [];
  private readonly forest: Forest;
  private readonly water: Water;
  private readonly landmarks: Landmarks;
  private readonly life: SkyLife;
  private readonly bridges: THREE.Group;
  /** The delta's life along the water: canal bridges, stilt houses, moored xuồng, the floating market (one mesh). */
  private readonly delta = buildDelta();
  /** The mountain (Núi Cấm-like) and its landmarks: lake, temple, tower, Di Lặc, waterfall, cable car, clouds, gate. */
  private readonly nui = buildNuiCam();
  private readonly people: CharacterLayer;
  private readonly live: LiveLayer;
  private liveState: WorldLive = {};
  /** P3: this view draws the frame's gameplay (DioramaFrame.gameplay: rats, dogs, leaping fish, gate barriers) and the
   *  vehicles/boats under riders (Billboard.vehicle) itself — no extra layer needed. */
  readonly drawsGameplay = true;
  private readonly weather = new WeatherLayer();
  private readonly monitor: FpsMonitor;
  private readonly ro: ResizeObserver;
  private mode: CameraMode = "overview";
  private orbit: Record<"follow" | "overview", Orbit> = { follow: { ...ORBITS.follow.o }, overview: { ...ORBITS.overview.o } };
  private fly: FlyState = { pos: { x: 130, y: 60, z: 200 }, yaw: 0, pitch: -0.3 };
  private flyIn: FlyInput = { f: false, b: false, l: false, r: false, u: false, d: false, fast: false };
  private eye: V3 = orbitEye(CENTER, ORBITS.overview.o);
  private look: V3 = { ...CENTER };
  private lastT = -1;
  private quality: Quality = "high";
  private drag: { id: number; x: number; y: number; moved: boolean; button: number } | null = null;
  private flashUntil = 0;
  private cpuMs = 0;
  private shadowKey = "";
  private shadowFrame = 0;
  private disposed = false;
  private frameNo = 0;
  /** The game's camera (options.gameCamera), its unsubscribe, the first-person pitch and the pinch's fingers. */
  private gcam: GameCam | null = null;
  private unsubCam: (() => void) | null = null;
  private fpPitch = -0.1;
  private readonly touches = new Map<number, { x: number; y: number }>();
  private pinchD = 0;

  constructor(canvas: HTMLCanvasElement, opts: WorldViewOptions = {}) {
    this.canvas = canvas;
    this.opts = opts;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.shadowMap.enabled = true;
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.autoUpdate = false;                           // re-rendered when the light or its box moves (updateShadow)
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.monitor = createFpsMonitor({ start: opts.quality === "low" ? "low" : "high", minFps: 40 });
    if (opts.quality === "high" || opts.quality === "low") this.monitor.force(opts.quality);
    this.ink = new InkPass(this.monitor.quality() === "high" ? 4 : 0);

    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(0xd8ebf2);
    this.scene.add(this.sky.mesh, this.hemi, this.sun, this.sun.target);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.05;

    // the land: every chunk at its coarsest first; nearer levels are built as the camera comes
    this.terrain.name = "terrain";
    for (let c = 0; c < CHUNKS_X * CHUNKS_Y; c++) {
      const cx = c % CHUNKS_X, cy = Math.floor(c / CHUNKS_X);
      const center = new THREE.Vector3((DOMAIN.x0 + (cx + 0.5) * CHUNK_PX) / 16, 2, (DOMAIN.y0 + (cy + 0.5) * CHUNK_PX) / 16);
      this.chunks.push({ mesh: null, level: -1, want: 2, geos: [null, null, null], center });
      this.setChunkLevel(c, 2);
    }
    this.scene.add(this.terrain);
    this.buildHorizon();

    // the zones on their plateaus
    for (const id of ZONE_IDS) this.addZone(id, opts.density ?? 1);
    for (let i = 0; i < LAMP_POOL; i++) {
      const l = new THREE.PointLight(0xffb060, 0, 14, 1.6);
      this.pool.push(l);
      this.scene.add(l);
    }

    this.water = buildWater();
    this.bridges = buildBridges();
    this.landmarks = buildLandmarks();
    this.life = buildSkyLife();
    this.forest = new Forest(opts.density ?? 1);
    this.scene.add(this.water.root, this.bridges, this.landmarks.root, this.life.root, this.forest.root, this.delta.root, this.nui.root);
    // the pixel texels (pixeltex.ts: grass, dirt, planks, thatch, tin, water) on the land and everything built on it
    pixelize(this.terrainMat);
    pixelize(this.seaMat, true);
    pixelizeTree(this.water.root, true);
    for (const r of [this.bridges, this.landmarks.root, this.forest.root, this.delta.root, this.nui.root]) pixelizeTree(r);

    this.people = new CharacterLayer({ width: 0, height: 0 }, (x, y) => this.heightAt(x, y));
    this.live = new LiveLayer((x, y) => this.heightAt(x, y));
    this.scene.add(this.people.root, this.weather.root, this.live.root);
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
    if (opts.gameCamera) {
      this.applyGameCam(getCam());
      this.unsubCam = subscribeCam((c) => this.applyGameCam(c));
    }
  }

  /** The game's camera changed (the HUD, the wheel, a pinch): the follow distance and first person. */
  private applyGameCam(c: GameCam): void {
    if (this.gcam?.view !== c.view && c.view === "first") this.fpPitch = -0.1;
    this.gcam = c;
    this.orbit.follow = { ...this.orbit.follow, distance: c.distance };
    this.people.setHideMyHead(c.view === "first");
  }

  // ------------------------------------------------------------ building

  private addZone(id: OutdoorMapId, density: number): void {
    const map = openedMap(id);
    const { built, heightAt } = buildMapScene(map, { density, openEnds: true });
    const z = ZONES[id];
    const root = new THREE.Group();
    root.name = `zone:${id}`;
    root.add(built.root);
    root.position.set((z.ox + z.w / 2) / 16, ZONE_ELEV[id], (z.oy + z.h / 2) / 16);
    const swap = toonify(built.root);
    const roofs = built.roofs.map((r) => ({ ...r, mats: r.mats.map((m) => swap.get(m) ?? m) }));
    const glow = (built.glow ?? []).map((m) => swap.get(m)).filter((m): m is THREE.MeshToonMaterial => !!m);
    built.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.receiveShadow = true; });
    // one mesh per material for everything that never moves (the probe runs the zone's hooks to find what does)
    const merged = mergeStatic(built.root, {
      keep: [built.water, ...built.sway.map((s) => s.obj), ...built.lamps],
      keepMats: [...roofs.flatMap((r) => r.mats), ...glow, ...built.bulbs],
      probe: () => {
        animateWater(built, 1234, 10);
        animateWater(built, 98_765, 40);
        built.setPlots?.(demoFieldPlots(), Date.now());
        built.setPlots?.([], Date.now());
      },
    });
    this.mergedGeos.push(...merged.geos);
    this.mergedMats.push(...merged.mats);
    this.meshCounts[id] = [merged.before, merged.after];
    pixelizeTree(root);
    this.scene.add(root);
    root.updateMatrixWorld(true);
    for (const l of built.lamps) {
      const pos = new THREE.Vector3();
      l.getWorldPosition(pos);
      this.lamps.push({ pos, color: l.color.clone(), distance: l.distance });
      l.parent?.remove(l);
    }
    this.zones.push({ id, built, heightAt, root, roofs, glow });
  }

  private setChunkLevel(c: number, level: number): void {
    const ch = this.chunks[c];
    if (ch.level === level) return;
    let geo = ch.geos[level];
    if (!geo) { geo = chunkGeometry(c, LOD_STEPS[level]); ch.geos[level] = geo; }
    if (!ch.mesh) {
      ch.mesh = new THREE.Mesh(geo, this.terrainMat);
      ch.mesh.receiveShadow = true;
      this.terrain.add(ch.mesh);
    } else ch.mesh.geometry = geo;
    ch.level = level;
    // drop the finest level of a chunk now far away (memory)
    if (level === 2 && ch.geos[0]) { ch.geos[0].dispose(); ch.geos[0] = null; }
  }

  /** The far mountains past the chunks, to the horizon: one coarse ring whose inner edge meets the land's rim. */
  private buildHorizon(): void {
    const step = 320, reach = 14000;
    const x0 = DOMAIN.x0 - Math.ceil(reach / step) * step, y0 = DOMAIN.y0 - Math.ceil(reach / step) * step;
    const nx = Math.round((DOMAIN.x1 - DOMAIN.x0 + 2 * (DOMAIN.x0 - x0)) / step), ny = Math.round((DOMAIN.y1 - DOMAIN.y0 + 2 * (DOMAIN.y0 - y0)) / step);
    const pos = new Float32Array((nx + 1) * (ny + 1) * 3), col = new Float32Array((nx + 1) * (ny + 1) * 3);
    const c = new THREE.Color(), far = new THREE.Color(0x7d9a8a);
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      const x = x0 + i * step, y = y0 + j * step, k = (j * (nx + 1) + i) * 3;
      const inside = x > DOMAIN.x0 && x < DOMAIN.x1 && y > DOMAIN.y0 && y < DOMAIN.y1;
      const out = Math.max(DOMAIN.x0 - x, x - DOMAIN.x1, DOMAIN.y0 - y, y - DOMAIN.y1, 0);
      const h = inside ? -30 : RIVER_LEVEL - 1.6;
      pos.set([x / 16, h, y / 16], k);
      landColor(x, y, h, 0.3, c).lerp(far, Math.min(0.6, out / 9000));
      col.set([c.r, c.g, c.b], k);
    }
    const idx: number[] = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, d = a + nx + 1, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.horizon = new THREE.Mesh(g, this.terrainMat);
    this.horizon.name = "horizon";
    this.scene.add(this.horizon);
    // the delta's one water table: the river mouths out to the horizon, and every canal carved below it in the land
    // (the river's own ribbon lies on top of it, a hair higher)
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(2 * reach + (DOMAIN.x1 - DOMAIN.x0), 2 * reach + (DOMAIN.y1 - DOMAIN.y0)).rotateX(-Math.PI / 2), this.seaMat);
    sea.position.set((DOMAIN.x0 + DOMAIN.x1) / 32, RIVER_LEVEL - 0.05, (DOMAIN.y0 + DOMAIN.y1) / 32);
    sea.name = "sea";
    sea.renderOrder = -1;                                                  // under the river's ribbon, always
    sea.receiveShadow = true;
    this.sea = sea;
    this.scene.add(sea);
  }

  // ------------------------------------------------------------ hooks for the engine

  /** Where feet stand at world px (units): a zone's own ground on its plateau, else the land or a bridge. */
  heightAt(x: number, y: number): number {
    const id = zoneUnder(x, y);
    if (id) {
      const z = this.zones.find((s) => s.id === id);
      if (z) { const Z = ZONES[id]; return ZONE_ELEV[id] + z.heightAt(x - Z.ox, y - Z.oy); }
    }
    return standHeight(x, y);
  }

  /** Add an extra object to the world's scene (absolute units: world px / 16), e.g. a debug or gameplay overlay; the
   *  view never disposes it — the caller removes it (removeLayer) and disposes its own geometry. */
  addLayer(obj: THREE.Object3D): void {
    this.scene.add(obj);
  }

  removeLayer(obj: THREE.Object3D): void {
    this.scene.remove(obj);
  }

  /** The world's live things besides the people (world px): stalls, fight rings, bosses, wild animals, Khu nhà's
   *  houses, dig spots, fishing bobbers, pets… Kept until the next call; the frame's own gameplay is added on top. */
  setLive(live: WorldLive): void {
    this.liveState = live;
  }

  /** The field's plots (the crops by stage). */
  setPlots(plots: ReadonlyArray<PlotDraw>): void {
    this.zones.find((z) => z.id === "field")?.built.setPlots?.(plots, Date.now());
  }

  /** Dev screenshots: put the free camera exactly here (units), looking along yaw/pitch, with no keys held. */
  setFly(pos: V3, yaw: number, pitch: number): void {
    this.setCameraMode("free");
    this.flyIn = { f: false, b: false, l: false, r: false, u: false, d: false, fast: false };
    this.fly = { pos: { ...pos }, yaw, pitch };
  }

  setCameraMode(m: CameraMode): void {
    if (m === "free" && !this.opts.allowFree) return;
    if (m === "free" && this.mode !== "free") {
      const dx = this.look.x - this.eye.x, dy = this.look.y - this.eye.y, dz = this.look.z - this.eye.z;
      this.fly = { pos: { ...this.eye }, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
    }
    this.mode = m;
    this.flyIn = { f: false, b: false, l: false, r: false, u: false, d: false, fast: false };
  }

  cameraMode(): CameraMode {
    return this.mode;
  }

  /** Set the orbit of a mode (dev shots). */
  setOrbit(mode: "follow" | "overview", o: Partial<Orbit>): void {
    this.orbit[mode] = { ...this.orbit[mode], ...o };
  }

  setQuality(q: Quality | "auto"): void {
    if (q === "auto") return;
    this.monitor.force(q);
    this.applyQuality(q);
  }

  stats(): WorldStats {
    const info = this.renderer.info.render;
    const lv = [0, 0, 0];
    for (const c of this.chunks) lv[c.level]++;
    return {
      fps: Math.round(this.monitor.fps()), cpuMs: Math.round(this.cpuMs * 10) / 10, quality: this.quality, calls: info.calls,
      triangles: info.triangles, mode: this.mode, chunks: lv.join("/"), trees: this.forest.counts.trees, live: this.live.count(),
    };
  }

  finish(): void {
    this.renderer.getContext().finish();
  }

  /** The world px under a client point (marching the ray over the land), or null (the sky). */
  pick(clientX: number, clientY: number): Vec | null {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    const o = rc.ray.origin, d = rc.ray.direction;
    let prev = 0;
    for (let t = 0.5; t < 1200; t += Math.max(0.25, t * 0.01)) {
      const x = (o.x + d.x * t) * 16, y = (o.z + d.z * t) * 16;
      if (o.y + d.y * t <= this.heightAt(x, y)) {
        // one refinement between the last two steps
        const tm = (prev + t) / 2, px = (o.x + d.x * tm) * 16, py = (o.z + d.z * tm) * 16;
        const hit = o.y + d.y * tm <= this.heightAt(px, py) ? { x: px, y: py } : { x, y };
        return hit.x >= 0 && hit.y >= 0 && hit.x < WORLD_W && hit.y < WORLD_H ? hit : null;
      }
      prev = t;
    }
    return null;
  }

  private applyQuality(q: Quality): void {
    this.quality = q;
    const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === "high" ? Math.min(dpr, 1.75) : Math.min(dpr, 1) * 0.8);
    this.sun.castShadow = q === "high";
    this.ink.setSamples(q === "high" ? 4 : 0);
    this.people.setQuality(q);
    this.forest.setQuality(q === "high");
    for (const z of this.zones) for (const t of z.built.thinnable) t.mesh.count = q === "high" ? t.full : Math.ceil(t.full * 0.45);
    this.resize();
  }

  private resize(): void {
    const w = Math.max(1, this.canvas.clientWidth), h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(w, h, false);
    const pr = this.renderer.getPixelRatio();
    this.ink.setSize(Math.round(w * pr), Math.round(h * pr), pr);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ input

  private readonly onContextMenu = (e: Event): void => { e.preventDefault(); };

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size === 2) this.pinchD = this.spread();
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, button: e.button };
    this.canvas.setPointerCapture?.(e.pointerId);
  };

  /** The two first fingers' spread (px). */
  private spread(): number {
    const [a, b] = [...this.touches.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size >= 2) {                                          // a pinch: zoom the game camera, no orbit, no tap
      const s = this.spread();
      if (this.gcam && this.mode === "follow" && this.pinchD > 0 && s > 0) setCam(pinchBy(getCam(), s / this.pinchD));
      this.pinchD = s;
      if (this.drag) this.drag.moved = true;
      return;
    }
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
    const m = this.mode, o = this.orbit[m];
    if (m === "follow" && this.gcam?.view === "first") {                     // first person: look around (the yaw is the orbit's)
      this.orbit.follow = { ...o, yaw: o.yaw - dx * 0.005 };
      this.fpPitch = Math.max(-1.2, Math.min(1.1, this.fpPitch - dy * 0.004));
      return;
    }
    this.orbit[m] = { ...o, yaw: o.yaw - dx * 0.006, pitch: Math.max(0.12, Math.min(1.45, o.pitch + dy * 0.004)) };
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.pinchD = 0;
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    this.drag = null;
    if (d.moved || d.button !== 0 || e.type === "pointercancel") return;
    const p = this.pick(e.clientX, e.clientY);
    if (p) this.opts.onTap?.(p);
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (this.mode === "free") return;
    if (this.gcam && this.mode === "follow") {                               // the game: zoom within its limits, kept
      setCam(zoomBy(getCam(), e.deltaY));
      return;
    }
    const m = this.mode, o = this.orbit[m], lim = ORBITS[m];
    this.orbit[m] = { ...o, distance: Math.max(lim.min, Math.min(lim.max, o.distance * Math.exp(e.deltaY * 0.001))) };
  };

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
    this.renderer.info.reset();
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
    this.updateLod();
    this.updateLight(f);
    const t = f.reduced ? 0 : f.t;
    // the zones' water (per-vertex waves: Sông Cái's alone is ~2 ms): every frame near the camera, a zone in four
    // frames farther out, not at all past the fog
    const n = ++this.frameNo, cam = this.camera.position, near = this.quality === "high" ? 140 : 90;
    this.zones.forEach((z, i) => {
      const d = Math.hypot(z.root.position.x - cam.x, z.root.position.z - cam.z);
      if (d < near || (d < this.fog.far && n % 4 === i % 4)) animateWater(z.built, t, f.windKmh);
    });
    this.water.animate(t, f.windKmh);
    this.landmarks.animate(t, f.windKmh);
    this.nui.animate(t, f.reduced);
    this.forest.animate(t, f.windKmh, f.reduced);
    this.life.animate(f.t, f.windKmh, f.reduced);
    const amp = f.reduced ? 0 : 0.03 + Math.min(0.25, f.windKmh / 200);
    for (const z of this.zones) for (const s of z.built.sway) s.obj.rotation.z = s.base + Math.sin(t / 700 + s.seed) * amp;

    // x-ray roofs over the walker (follow mode), in the zone's own px
    const k = smoothK(dt, 8);
    for (const z of this.zones) {
      const Z = ZONES[z.id], fx = f.focus.x - Z.ox, fy = f.focus.y - Z.oy;
      for (const r of z.roofs) {
        const near = fx > r.x - 12 && fx < r.x + r.w + 12 && fy > r.y - 56 && fy < r.y + r.h + 40;
        const target = this.mode === "follow" && near ? 0.22 : 1;
        for (const m of r.mats) {
          m.opacity += (target - m.opacity) * (f.reduced ? 1 : k);
          m.depthWrite = m.opacity > 0.95;
        }
      }
    }

    const yaw = this.mode === "free" ? this.fly.yaw : Math.atan2(this.eye.x - this.look.x, this.eye.z - this.look.z);
    const live = liveFromFrame(f, this.liveState);
    const people = this.live.adjust(f.billboards, live);
    this.people.setCull(this.camera.position, this.quality === "high" ? 170 : 110);
    this.people.setLifts(this.live.lifts());
    this.people.update(people, yaw, f.t, f.reduced);
    this.live.update(live, this.people, f.t, f.night, f.reduced);
    this.weather.update(f.weather, f.fx, f.reduced, f.t, new THREE.Vector3(this.look.x, this.look.y, this.look.z), f.windKmh, this.quality === "low");
    this.sky.follow(this.camera.position);
    this.ink.render(this.renderer, this.scene, this.camera);
  }

  private updateCamera(f: DioramaFrame, dt: number): void {
    let eye: V3, look: V3, rate = 5;
    if (this.mode === "follow" && this.gcam?.view === "first") {
      // first person: the eyes (the head's middle), looking along the orbit's yaw and the view's own pitch
      const y = this.heightAt(f.focus.x, f.focus.y) + RIG.hipY + RIG.neckY + RIG.headH * 0.45;
      const o = this.orbit.follow, c = Math.cos(this.fpPitch);
      eye = { x: f.focus.x / 16, y, z: f.focus.y / 16 };
      look = { x: eye.x - Math.sin(o.yaw) * c, y: y + Math.sin(this.fpPitch), z: eye.z - Math.cos(o.yaw) * c };
      rate = 30;
    } else if (this.mode === "follow") {
      look = { x: f.focus.x / 16, y: this.heightAt(f.focus.x, f.focus.y) + 1.3, z: f.focus.y / 16 };
      eye = orbitEye(look, this.orbit.follow);
      const ground = this.heightAt(eye.x * 16, eye.z * 16) + 6.5;               // never in a hill or the treetops
      if (eye.y < ground) eye = { ...eye, y: ground };
    } else if (this.mode === "overview") {
      if (!f.reduced && !this.drag) this.orbit.overview = { ...this.orbit.overview, yaw: this.orbit.overview.yaw + dt * 0.02 };
      look = CENTER;
      eye = orbitEye(look, this.orbit.overview);
      rate = 3;
    } else {
      const i = this.flyIn;
      const speed = (i.fast ? 110 : 32) * dt;
      const fx = -Math.sin(this.fly.yaw), fz = -Math.cos(this.fly.yaw), rx = Math.cos(this.fly.yaw), rz = -Math.sin(this.fly.yaw);
      const fw = +i.f - +i.b, rt = +i.r - +i.l, up = +i.u - +i.d;
      const p = this.fly.pos;
      const nx = p.x + (fx * fw + rx * rt) * speed, nz = p.z + (fz * fw + rz * rt) * speed;
      this.fly = { ...this.fly, pos: { x: nx, y: Math.max(this.heightAt(nx * 16, nz * 16) + 1, p.y + up * speed), z: nz } };
      const d = flyForward(this.fly);
      eye = this.fly.pos;
      look = { x: eye.x + d.x, y: eye.y + d.y, z: eye.z + d.z };
      rate = 30;
    }
    const k = f.reduced ? 1 : smoothK(dt, rate);
    this.eye = lerp3(this.eye, eye, k);
    this.look = lerp3(this.look, look, k);
    this.camera.position.set(this.eye.x, this.eye.y, this.eye.z);
    this.camera.lookAt(this.look.x, this.look.y, this.look.z);
    this.camera.updateMatrixWorld();

    // the sun's shadow box follows what the camera looks at
    const ext = this.mode === "overview" ? 150 : 55;
    const cam = this.sun.shadow.camera;
    if (cam.right !== ext) {
      Object.assign(cam, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 600 });
      cam.updateProjectionMatrix();
      this.sun.shadow.mapSize.set(this.mode === "overview" ? 4096 : 2048, this.mode === "overview" ? 4096 : 2048);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  /** Terrain chunks and the forest's detail from the camera. Missing levels are built by the terrain workers (a
   *  chunk keeps its current mesh until its new one arrives); without workers, one chunk a frame as before. */
  private updateLod(): void {
    const cam = this.camera.position;
    const [d0, d1] = TERRAIN_LOD[this.quality];
    this.jobs.clearQueue();
    for (let c = 0; c < this.chunks.length; c++) {
      const ch = this.chunks[c];
      const d = Math.hypot(ch.center.x - cam.x, ch.center.z - cam.z, (ch.center.y - cam.y) * 0.5);
      const want = d < d0 ? 0 : d < d1 ? 1 : 2;
      ch.want = want;
      if (want === ch.level) continue;
      if (ch.geos[want]) { this.setChunkLevel(c, want); continue; }
      this.jobs.request(c, want, d);
    }
    this.jobs.pump();
    this.forest.update(cam);
  }

  private chunkBuilt(c: number, level: number, geo: THREE.BufferGeometry): void {
    const ch = this.chunks[c];
    if (this.disposed || !ch || ch.geos[level]) { geo.dispose(); return; }
    ch.geos[level] = geo;
    if (ch.want === level) this.setChunkLevel(c, level);
  }

  private readonly tmpA = new THREE.Color();
  private readonly tmpB = new THREE.Color();

  private updateLight(f: DioramaFrame): void {
    const kind = f.weather ?? "clear";
    const grey = GREY_SKY[kind];
    const overcast = grey === undefined ? 0 : kind === "cloudy" ? 0.45 : kind === "fog" ? 0.7 : 0.75;
    const fxK = f.fx / 4;
    const zen = this.tmpA.copy(SKY.day.zenith).lerp(SKY.dusk.zenith, f.warm * 0.7).lerp(SKY.night.zenith, f.night);
    const hor = this.tmpB.copy(SKY.day.horizon).lerp(SKY.dusk.horizon, f.warm * 0.85).lerp(SKY.night.horizon, f.night * f.night);
    if (grey !== undefined) { const g = new THREE.Color(grey); zen.lerp(g, overcast * fxK); hor.lerp(g, overcast * fxK * 0.9); }
    this.sky.zenith.copy(zen);
    this.sky.horizon.copy(hor);
    (this.scene.background as THREE.Color).copy(hor);
    this.fog.color.copy(hor);
    const base = this.mode === "follow" ? [80, 520] : this.mode === "overview" ? [180, 980] : [90, 760];
    const fk = 1 - (1 - (FOG_K[kind] ?? 1)) * fxK;
    this.fog.near = base[0] * fk;
    this.fog.far = base[1] * Math.max(0.25, fk);

    const stormy = kind === "thunder" || kind === "storm";
    if (stormy && !f.reduced && f.fx > 0 && f.t > this.flashUntil + 1500 && Math.random() < (kind === "storm" ? 0.006 : 0.003)) this.flashUntil = f.t + 140;
    const flash = f.t < this.flashUntil ? 1.6 * fxK : 0;

    const day = 1 - f.night;
    // the sun low in the west at dusk, high by day; the moon's cool light at night
    const elev = 0.25 + 0.75 * (1 - f.warm) * day + 0.35 * f.night;
    const dir = new THREE.Vector3(-0.55, elev, 0.35).normalize();
    this.sky.sunDir.copy(dir);
    this.sky.sunColor.setRGB(1, 0.85 - 0.3 * f.warm, 0.6 - 0.35 * f.warm).multiplyScalar(day * (1 - overcast * fxK));
    this.sun.position.set(this.look.x + dir.x * 300, this.look.y + dir.y * 300, this.look.z + dir.z * 300);
    this.sun.target.position.set(this.look.x, this.look.y, this.look.z);
    this.sun.target.updateMatrixWorld();
    this.updateShadow(dir);
    this.sun.intensity = (0.3 + 2.4 * day) * (1 - overcast * 0.55 * fxK);
    this.sun.color.setRGB(1, 0.95 - 0.4 * f.warm, 0.86 - 0.6 * f.warm).lerp(new THREE.Color(0x8fa8ff), f.night);
    this.hemi.intensity = 0.5 + 0.9 * day + flash;
    this.hemi.color.setHex(0xdff2ff).lerp(new THREE.Color(0xffb88a), f.warm * 0.6).lerp(new THREE.Color(0x3a4a8a), f.night);
    this.hemi.groundColor.setHex(0x5a7a3a).lerp(new THREE.Color(0x141a30), f.night);
    this.ink.setInk(0.85, 1, new THREE.Color(0x2a2320).lerp(new THREE.Color(0x05060c), f.night));

    // night: the lamp pool at the lamps nearest the camera's target
    const tgt = new THREE.Vector3(this.look.x, this.look.y, this.look.z);
    const near = this.lamps.map((l) => ({ l, d: l.pos.distanceToSquared(tgt) })).sort((a, b) => a.d - b.d).slice(0, LAMP_POOL);
    this.pool.forEach((p, i) => {
      const n = near[i];
      if (!n) { p.intensity = 0; return; }
      p.position.copy(n.l.pos);
      p.color.copy(n.l.color);
      p.distance = n.l.distance;
      p.intensity = 9 * f.night;
    });
    for (const z of this.zones) {
      for (const b of z.built.bulbs) b.color.setHex(0xd23a3a).lerp(new THREE.Color(0xffd27a), f.night);
      for (const m of z.glow) m.emissiveIntensity = f.night * 0.9;
    }
  }

  /** The shadow map is re-rendered only when its box or the sun has moved enough, or every few frames in follow
   *  (the walkers' shadows), rarely in the overview: the shadow pass would otherwise draw the world twice. */
  private updateShadow(dir: THREE.Vector3): void {
    if (!this.sun.castShadow) return;
    const grid = this.mode === "overview" ? 16 : 3;
    const key = `${this.mode}|${Math.round(this.look.x / grid)}|${Math.round(this.look.z / grid)}|${dir.x.toFixed(2)}|${dir.y.toFixed(2)}`;
    const every = this.mode === "follow" ? 3 : 90;
    if (key !== this.shadowKey || ++this.shadowFrame >= every) {
      this.shadowKey = key;
      this.shadowFrame = 0;
      this.renderer.shadowMap.needsUpdate = true;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubCam?.();
    this.unsubCam = null;
    this.ro.disconnect();
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("keyup", this.onKey, true);
    this.jobs.dispose();
    this.live.dispose();
    this.people.dispose();
    this.weather.dispose();
    for (const z of this.zones) z.built.dispose();
    for (const g of this.mergedGeos) g.dispose();
    for (const m of this.mergedMats) m.dispose();
    for (const c of this.chunks) for (const g of c.geos) g?.dispose();
    this.horizon?.geometry.dispose();
    this.sea?.geometry.dispose();
    this.seaMat.dispose();
    this.terrainMat.dispose();
    this.forest.dispose();
    this.water.dispose();
    this.landmarks.dispose();
    this.life.dispose();
    this.bridges.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
    this.delta.dispose();
    this.nui.dispose();
    this.sky.dispose();
    this.ink.dispose();
    this.sun.shadow.map?.dispose();
    this.scene.clear();
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
