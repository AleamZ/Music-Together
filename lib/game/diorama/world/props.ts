import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { cumulative, pointAt, TRAILS } from "@/lib/game/world/roads";
import { LANDMARKS, type Landmark } from "@/lib/game/world/scenery";
import {
  bridgeAt, heightAt, RIVER_LEVEL, ZONE_ELEV, RIVER_PTS, riverHalfWidth, STREAM_HALF_W, STREAM_PTS, streamLevel, waterAt,
} from "@/lib/game/world/terrain";
import type { Vec } from "@/lib/game/types";
import { ZONES } from "@/lib/game/world/zones";
import { toon } from "./toon";

// Browser only: the world's set pieces — the river and the stream as flowing ribbons, the red bridges on the trails,
// the landmarks seen from afar (the đình's flag, the market arch, the dojo tower, the mine headframe), windmills,
// clouds, hot-air balloons and a few flocks of birds. All procedural, toon-shaded.

const U = (px: number) => px / 16;

function colored(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex), n = geo.getAttribute("position").count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  if (geo.getAttribute("uv")) geo.deleteAttribute("uv");
  return geo;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number, hex: number) =>
  colored(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex);

/** A texture of light streaks on the water (scrolled downstream). */
function streakTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, 128, 64);
  g.fillStyle = "rgba(255,255,255,1)";
  for (let i = 0; i < 26; i++) {
    const x = (i * 53) % 128, y = 4 + ((i * 29) % 56), w = 10 + (i % 4) * 7;
    g.fillStyle = i % 3 === 0 ? "#d9f3ff" : "#eaf7ff";
    g.fillRect(x, y, w, 1.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A ribbon along a polyline: `half(s)` px each side, at height `lvl(s)`, between arc lengths s0…s1. */
function ribbon(pts: readonly { x: number; y: number }[], s0: number, s1: number, stepPx: number,
  half: (s: number) => number, lvl: (s: number) => number): THREE.BufferGeometry {
  const cum = cumulative(pts);
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let i = 0;
  for (let s = s0; ; s = Math.min(s1, s + stepPx)) {
    const p = pointAt(pts, cum, s), hw = half(s), y = lvl(s);
    // a tangent smoothed over the corners (the inner edge must not fold back on itself)
    const a = pointAt(pts, cum, s - hw * 0.9), b = pointAt(pts, cum, s + hw * 0.9);
    const tl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / tl, ny = (b.x - a.x) / tl;
    pos.push(U(p.x + nx * hw), y, U(p.y + ny * hw), U(p.x - nx * hw), y, U(p.y - ny * hw));
    uv.push(s / 240, 0, s / 240, 1);
    if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    i++;
    if (s >= s1) break;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export interface Water { root: THREE.Group; animate(t: number, wind: number): void; dispose(): void }

/** Where the wild river's ribbon stops and starts again around Sông Cái (arc lengths): 8 px inside the zone's edges. */
export function riverRibbonSpan(): [number, number] {
  const cum = cumulative(RIVER_PTS), L = cum[cum.length - 1], sc = ZONES.song_cai;
  let sIn = 0, sOut = L;
  for (let s = 0; s < L; s += 2) { if (pointAt(RIVER_PTS, cum, s).x >= sc.ox + 8) { sIn = s; break; } }
  for (let s = L; s > 0; s -= 2) { if (pointAt(RIVER_PTS, cum, s).x <= sc.ox + sc.w - 8) { sOut = s; break; } }
  return [sIn, sOut];
}

/** The stream's water from inside the pond (its south shore) out to the river: the points, the length, where it
 *  leaves the pond zone (`lip`) and its surface. Over the pond's grass it rides just above the ground; past the lip
 *  it eases down onto the stream's own slope within 48 px. */
export function streamRunnel(): { pts: Vec[]; length: number; lip: number; level: (s: number) => number } {
  const pond = ZONES.pond, first = STREAM_PTS[0];
  // the lake's south shore under the stream's first point (the pond's oval: centre 300,180, radii 180×105; 12 px in)
  const shore = { x: first.x, y: pond.oy + 180 + 105 * Math.sqrt(Math.max(0, 1 - ((first.x - pond.ox - 300) / 180) ** 2)) - 12 };
  const pts: Vec[] = [shore, ...STREAM_PTS];
  const cum = cumulative(pts), length = cum[cum.length - 1];
  const lip = cum[1];                                          // STREAM_PTS[0] is on the zone's south edge
  const grass = ZONE_ELEV.pond + 0.05;
  const level = (s: number) => {
    if (s <= lip) return grass;
    const own = streamLevel(s - lip), k = Math.min(1, (s - lip) / 48);
    return grass + (own + 0.02 - grass) * (k * k * (3 - 2 * k));
  };
  return { pts, length, lip, level };
}

export function buildWater(): Water {
  const root = new THREE.Group();
  const tex = streakTexture();
  const mat = toon({ color: 0x4f9fb0, map: tex, transparent: true, opacity: 0.93, side: THREE.DoubleSide });
  const cum = cumulative(RIVER_PTS), L = cum[cum.length - 1];
  const sc = ZONES.song_cai;
  // in the world Sông Cái's own water runs to its west and east edges (openEnds): the ribbon meets it there, level
  // (the zone's water is at RIVER_LEVEL too), overlapping a few px just under it — no step at either end
  const [sIn, sOut] = riverRibbonSpan();
  const half = (s: number) => riverHalfWidth(s) + 6;
  const lvl = (s: number) => {
    const x = pointAt(RIVER_PTS, cum, s).x;
    return x > sc.ox - 2 && x < sc.ox + sc.w + 2 ? RIVER_LEVEL - 0.015 : RIVER_LEVEL;
  };
  const geos = [ribbon(RIVER_PTS, 0, sIn, 6, half, lvl), ribbon(RIVER_PTS, sOut, L, 6, half, lvl)];
  // the stream: out of the pond's water, across the pond's grass in a shallow runnel, then down to the river
  const run = streamRunnel();
  geos.push(ribbon(run.pts, 0, run.length, 8, (s) => (s < run.lip ? STREAM_HALF_W - 1 : STREAM_HALF_W + 3), run.level));  for (const g of geos) {
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    root.add(m);
  }
  return {
    root,
    animate(t, wind) { tex.offset.x = -(t / 1000) * (0.25 + wind / 300); tex.offset.y = Math.sin(t / 2400) * 0.02; },
    dispose() { for (const g of geos) g.dispose(); tex.dispose(); mat.dispose(); },
  };
}

// ---------------------------------------------------------------- bridges

/** The red arched bridges where the trails cross the river. */
export function buildBridges(): THREE.Group {
  const root = new THREE.Group();
  const parts: THREE.BufferGeometry[] = [];
  for (const t of TRAILS) {
    const cum = cumulative(t.pts), L = cum[cum.length - 1];
    let s0 = -1, s1 = -1;
    for (let s = 0; s <= L; s += 4) {
      const p = pointAt(t.pts, cum, s);
      if (waterAt(p.x, p.y) !== null) { if (s0 < 0) s0 = s; s1 = s; }
    }
    if (s0 < 0) continue;
    s0 -= 26; s1 += 26;
    const span = s1 - s0, hw = U(t.w / 2) + 0.35;
    for (let s = s0; s <= s1; s += 8) {
      const p = pointAt(t.pts, cum, s), k = (s - s0) / span;
      const deck = bridgeAt(p.x, p.y) ?? heightAt(p.x, p.y);
      const arch = Math.sin(k * Math.PI) * 0.9;
      const yaw = Math.atan2(p.dx, p.dy);
      const g = (geo: THREE.BufferGeometry) => { parts.push(geo.rotateY(yaw).translate(U(p.x), 0, U(p.y))); };
      g(box(hw * 2, 0.18, 0.62, 0, deck + 0.02, 0, 0x9a5a36));                          // planks
      g(box(0.12, 0.9, 0.12, hw, deck + 0.45 + arch * 0.4, 0, 0xc0392b));                // rail posts, the rail rising to the middle
      g(box(0.12, 0.9, 0.12, -hw, deck + 0.45 + arch * 0.4, 0, 0xc0392b));
      g(box(0.16, 0.12, 0.66, hw, deck + 0.95 + arch * 0.4, 0, 0xd4473a));
      g(box(0.16, 0.12, 0.66, -hw, deck + 0.95 + arch * 0.4, 0, 0xd4473a));
      g(box(hw * 2 + 0.3, 0.3, 0.3, 0, deck - 0.3 - (1 - Math.sin(k * Math.PI)) * 0.2, 0, 0xa8322a));   // the arch's beam
      if (Math.round((s - s0) / 8) % 5 === 0) g(box(0.36, 3, 0.36, 0, RIVER_LEVEL - 1.2, 0, 0x6b4a33));   // piers
    }
  }
  const mesh = new THREE.Mesh(mergeGeometries(parts)!, toon({ vertexColors: true }));
  mesh.castShadow = true;
  root.add(mesh);
  return root;
}

// ---------------------------------------------------------------- landmarks

export interface Landmarks { root: THREE.Group; animate(t: number, wind: number): void; dispose(): void }

export function buildLandmarks(): Landmarks {
  const root = new THREE.Group();
  const mat = toon({ vertexColors: true });
  const bladeMat = toon({ vertexColors: true, side: THREE.DoubleSide });
  const flagMat = toon({ color: 0xda251d, side: THREE.DoubleSide });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffc46a });
  const spinning: Array<{ obj: THREE.Object3D; speed: number }> = [];
  const flags: THREE.Mesh[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const add = (parts: THREE.BufferGeometry[], l: Landmark, m: THREE.Material = mat): THREE.Group => {
    const g = new THREE.Group();
    const geo = mergeGeometries(parts)!;
    geos.push(geo);
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = true;
    g.add(mesh);
    g.position.set(U(l.x), heightAt(l.x, l.y) - 0.1, U(l.y));
    g.rotation.y = l.yaw;
    root.add(g);
    return g;
  };
  for (const l of LANDMARKS) {
    if (l.kind === "windmill") {
      const parts = [
        colored(new THREE.CylinderGeometry(0.9, 1.5, 6.5, 8).translate(0, 3.25, 0), 0xf1e6d2),
        colored(new THREE.ConeGeometry(1.35, 1.7, 8).translate(0, 7.35, 0), 0xb4462e),
        box(0.7, 1.2, 0.2, 0, 0.6, 1.45, 0x6b4a33),
        box(0.5, 0.5, 0.1, 0, 3.8, 1.2, 0x5b7fa0),
      ];
      const g = add(parts, l);
      const hub = new THREE.Group();
      hub.position.set(0, 6.3, 1.25);
      const blades: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 4; i++) {
        blades.push(box(0.16, 4.6, 0.08, 0, 2.4, 0, 0x6b4a33).rotateZ((i * Math.PI) / 2));
        blades.push(box(0.9, 3.6, 0.04, 0.5, 2.8, 0.02, 0xf5eedf).rotateZ((i * Math.PI) / 2));
      }
      const bg = mergeGeometries(blades)!;
      geos.push(bg);
      const bm = new THREE.Mesh(bg, bladeMat);
      bm.castShadow = true;
      hub.add(bm);
      g.add(hub);
      spinning.push({ obj: hub, speed: 0.6 + (l.x % 7) * 0.05 });
    } else if (l.kind === "flag") {
      const g = add([
        colored(new THREE.CylinderGeometry(0.09, 0.13, 11, 6).translate(0, 5.5, 0), 0xe8e2d4),
        colored(new THREE.SphereGeometry(0.2, 6, 4).translate(0, 11.1, 0), 0xe0b43a),
        box(1.6, 0.5, 1.6, 0, 0.25, 0, 0x8e877a),
      ], l);
      const flagGeo = new THREE.PlaneGeometry(3.2, 2.1, 8, 2).translate(1.6, 9.8, 0);
      geos.push(flagGeo);
      const flag = new THREE.Mesh(flagGeo, flagMat);
      flag.userData.base = Float32Array.from(flagGeo.getAttribute("position").array);
      const starGeo = new THREE.CircleGeometry(0.55, 5).translate(1.25, 9.8, 0.02);
      geos.push(starGeo);
      const star = new THREE.Mesh(starGeo, toon({ color: 0xffdf3a, side: THREE.DoubleSide }));
      flag.add(star);
      g.add(flag);
      flags.push(flag);
    } else if (l.kind === "arch") {
      add([
        box(0.7, 5.2, 0.7, 0, 2.6, -2.1, 0xb8322a), box(0.7, 5.2, 0.7, 0, 2.6, 2.1, 0xb8322a),
        box(1.1, 0.5, 1.1, 0, 0.25, -2.1, 0x8e877a), box(1.1, 0.5, 1.1, 0, 0.25, 2.1, 0x8e877a),
        box(0.9, 0.45, 5.8, 0, 5.05, 0, 0xc0392b),
        colored(new THREE.CylinderGeometry(0.35, 0.35, 6.6, 3, 1).rotateX(Math.PI / 2).rotateZ(Math.PI / 2 + Math.PI / 6).scale(1.9, 1, 1).translate(0, 5.65, 0), 0x3d6e57),
        box(0.18, 1.1, 3.2, 0.5, 4.2, 0, 0xf1d36a),
      ], l);
    } else if (l.kind === "tower") {
      const parts: THREE.BufferGeometry[] = [box(3.6, 0.6, 3.6, 0, 0.3, 0, 0x8e877a)];
      let y = 0.6;
      for (let i = 0; i < 4; i++) {
        const w = 2.8 - i * 0.45, h = 2.1 - i * 0.15;
        parts.push(box(w, h, w, 0, y + h / 2, 0, i % 2 ? 0xe9dcc0 : 0xd9c8a4));
        y += h;
        parts.push(colored(new THREE.ConeGeometry(w * 0.95, 0.9, 4).rotateY(Math.PI / 4).translate(0, y + 0.3, 0), 0x9e3b2a));
        y += 0.5;
      }
      parts.push(colored(new THREE.CylinderGeometry(0.05, 0.12, 1.6, 5).translate(0, y + 0.8, 0), 0xe0b43a));
      add(parts, l);
    } else if (l.kind === "headframe") {
      const legs: THREE.BufferGeometry[] = [];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) legs.push(box(0.25, 9, 0.25, 0, 4.5, 0, 0x6b4a33).rotateZ(sx * 0.12).rotateX(sz * 0.12).translate(sx * 1.2, 0, sz * 1.2));
      for (let y = 2; y < 9; y += 2.2) legs.push(box(2.6 - y * 0.2, 0.18, 0.18, 0, y, 1.2 - y * 0.12, 0x5a3e2b), box(2.6 - y * 0.2, 0.18, 0.18, 0, y, -1.2 + y * 0.12, 0x5a3e2b));
      legs.push(box(2.4, 0.3, 0.6, 0, 9.1, 0, 0x5a3e2b), box(3.5, 1.8, 3, 0, 0.9, 0, 0x8a6a4a), box(3.8, 0.2, 3.3, 0, 1.9, 0, 0x5b6770));
      const g = add(legs, l);
      const wheelGeo = new THREE.TorusGeometry(1.1, 0.12, 5, 14);
      geos.push(wheelGeo);
      const wheel = new THREE.Mesh(wheelGeo, toon({ color: 0x3c3c3c }));
      wheel.position.set(0, 9.6, 0);
      g.add(wheel);
      spinning.push({ obj: wheel, speed: 0.4 });
    } else if (l.kind === "mine") {
      // P2: the mine mouth — a timber-framed tunnel into the hill (local +z = out of the tunnel), rails and a cart
      // coming out, a lantern each side; the dark inside is Mỏ đá (an interior, entered by the door in front)
      const parts: THREE.BufferGeometry[] = [];
      const R = (i: number) => ((Math.sin(i * 127.1 + l.x) * 43758.5453) % 1 + 1) % 1;
      for (let i = 0; i < 16; i++) {                                    // the rock round the mouth
        const a = (i / 15) * Math.PI, r = 2.3 + R(i) * 0.6;
        parts.push(colored(new THREE.DodecahedronGeometry(0.9 + R(i + 40) * 0.7, 0)
          .translate(Math.cos(a) * r, Math.sin(a) * r * 1.05 + 0.2, -1.4 - R(i + 80) * 1.2), [0x6d655c, 0x7a7266, 0x5f5850][i % 3]));
      }
      parts.push(colored(new THREE.DodecahedronGeometry(3.4, 1).scale(1.25, 0.8, 0.9).translate(0, 1.2, -5.4), 0x6a6258));
      parts.push(box(2.5, 2.7, 1.6, 0, 1.35, -0.7, 0x0e0c0b));          // the dark inside (a short bore)
      for (const s of [-1, 1]) parts.push(box(0.34, 2.9, 0.34, s * 1.35, 1.45, 0, 0x6e4424));
      parts.push(box(3.4, 0.4, 0.5, 0, 3.0, 0, 0x8a5a30), box(1.8, 0.5, 0.08, 0, 3.55, 0.2, 0xf4ead0));
      for (let z = -0.3; z < 5.6; z += 0.45) parts.push(box(1.5, 0.08, 0.16, 0, 0.04, z, 0x6e4424));
      for (const s of [-1, 1]) parts.push(box(0.08, 0.1, 6, s * 0.5, 0.12, 2.7, 0x8a939c));
      parts.push(box(1.2, 0.65, 0.9, 0, 0.55, 0.9, 0x5b636b), colored(new THREE.DodecahedronGeometry(0.45, 0).scale(1.1, 0.6, 0.8).translate(0, 0.95, 0.9), 0x8a8178));
      for (const s of [-1, 1]) parts.push(box(0.12, 1.6, 0.12, s * 2.1, 0.8, 0.6, 0x6e4424));
      const g = add(parts, l);
      for (const s of [-1, 1]) {
        const lampGeo = new THREE.SphereGeometry(0.2, 8, 6);
        geos.push(lampGeo);
        const lamp = new THREE.Mesh(lampGeo, lampMat);
        lamp.position.set(s * 2.1, 1.75, 0.6);
        g.add(lamp);
      }
    }
  }
  return {
    root,
    animate(t, wind) {
      for (const s of spinning) s.obj.rotation.z = -(t / 1000) * s.speed * (0.5 + wind / 30);
      for (const f of flags) {
        const pos = (f.geometry as THREE.BufferGeometry).getAttribute("position") as THREE.BufferAttribute, base = f.userData.base as Float32Array;
        for (let i = 0; i < pos.count; i++) {
          const x = base[i * 3];
          pos.setZ(i, Math.sin(x * 1.6 - t / 260) * 0.22 * Math.min(1, x / 1.5) * (0.5 + wind / 40));
        }
        pos.needsUpdate = true;
      }
    },
    dispose() { for (const g of geos) g.dispose(); mat.dispose(); bladeMat.dispose(); flagMat.dispose(); lampMat.dispose(); },
  };
}

// ---------------------------------------------------------------- the sky's life

export interface SkyLife { root: THREE.Group; animate(t: number, wind: number, reduced: boolean): void; dispose(): void }

export function buildSkyLife(): SkyLife {
  const root = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  // clouds: puffy clusters, drifting east with the wind
  const puffs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const r = 2.4 + (i % 3) * 0.9;
    puffs.push(new THREE.IcosahedronGeometry(r, 1).scale(1, 0.72, 1).translate((i - 3) * 2.6, Math.sin(i * 1.7) * 0.8 + (i % 2) * 0.9, Math.cos(i * 2.3) * 1.6));
  }
  const cloudGeo = mergeGeometries(puffs.map((p) => { p.deleteAttribute("uv"); return p; }))!;
  geos.push(cloudGeo, ...puffs);
  const cloudMat = toon({ color: 0xffffff, emissive: 0x9aa8b8, emissiveIntensity: 0.35 });
  mats.push(cloudMat);
  const CLOUDS = 22;
  const clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, CLOUDS);
  const cloudSeed = Array.from({ length: CLOUDS }, (_, i) => ({
    a: (i / CLOUDS) * Math.PI * 2 + ((i * 37) % 10) * 0.05, r: 190 + ((i * 53) % 7) * 22, y: 50 + (i % 5) * 8, s: 0.8 + ((i * 37) % 10) / 12, v: 0.004 + (i % 4) * 0.0015,
  }));
  clouds.frustumCulled = false;
  root.add(clouds);
  // hot-air balloons
  const balloons: Array<{ g: THREE.Group; x: number; z: number; y: number; ph: number }> = [];
  const stripes = [[0xe24a3b, 0xf4d35e], [0x3a86c8, 0xf2f0e6], [0x6bb04a, 0xf29a4a]];
  stripes.forEach(([a, b], i) => {
    const env = new THREE.SphereGeometry(2.2, 12, 10).scale(1, 1.2, 1).toNonIndexed();
    env.deleteAttribute("uv");
    const pos = env.getAttribute("position"), col = new Float32Array(pos.count * 3), ca = new THREE.Color(a), cb = new THREE.Color(b);
    for (let k = 0; k < pos.count; k++) {
      const ang = Math.atan2(pos.getZ(k), pos.getX(k));
      const c = Math.floor(((ang + Math.PI) / (2 * Math.PI)) * 12) % 2 ? ca : cb;
      col.set([c.r, c.g, c.b], k * 3);
    }
    env.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const basket = colored(new THREE.BoxGeometry(0.8, 0.6, 0.8).translate(0, -3.6, 0), 0x8a5a36);
    const ropes = colored(new THREE.CylinderGeometry(0.9, 0.45, 1.3, 4, 1, true).translate(0, -2.9, 0), 0x5a4030);
    const geo = mergeGeometries([env, basket, ropes])!;
    geos.push(geo, env, basket, ropes);
    const m = toon({ vertexColors: true });
    mats.push(m);
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = true;
    g.add(mesh);
    root.add(g);
    balloons.push({ g, x: [60, 175, 235][i], z: [30, 105, 40][i], y: [28, 34, 24][i], ph: i * 2.1 });
  });
  // birds: little flapping Vs in a few flocks
  const birdGeo = new THREE.BufferGeometry();
  birdGeo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, -0.9, 0, -0.35, 0, 0, 0.3, 0, 0, 0, 0, 0, 0.3, 0.9, 0, -0.35], 3));
  birdGeo.computeVertexNormals();
  geos.push(birdGeo);
  const birdMat = new THREE.MeshBasicMaterial({ color: 0x2b2a33, side: THREE.DoubleSide });
  mats.push(birdMat);
  const BIRDS = 27;
  const birds = new THREE.InstancedMesh(birdGeo, birdMat, BIRDS);
  birds.frustumCulled = false;
  root.add(birds);
  const up = new THREE.Vector3(0, 1, 0), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  return {
    root,
    animate(t, wind, reduced) {
      const ts = reduced ? 0 : t / 1000;
      cloudSeed.forEach((c, i) => {
        const a = c.a + ts * c.v * (0.4 + wind / 25);
        m4.compose(p.set(130 + Math.cos(a) * c.r * 1.25, c.y, 70 + Math.sin(a) * c.r * 0.9), q.setFromAxisAngle(up, -a), s.set(c.s * 1.4, c.s, c.s * 1.2));
        clouds.setMatrixAt(i, m4);
      });
      clouds.instanceMatrix.needsUpdate = true;
      for (const b of balloons) {
        b.g.position.set(b.x + Math.sin(ts * 0.05 + b.ph) * 12, b.y + Math.sin(ts * 0.4 + b.ph) * 1.2, b.z + Math.cos(ts * 0.04 + b.ph) * 8);
        b.g.rotation.y = ts * 0.1 + b.ph;
      }
      for (let i = 0; i < BIRDS; i++) {
        const flock = i % 3, k = Math.floor(i / 3);
        const cx = [90, 180, 40][flock], cz = [60, 40, 110][flock], r = [26, 34, 20][flock];
        const a = ts * (0.18 + flock * 0.04) + flock * 2;
        const ox = (k % 3) * 1.4 - 1.4, oz = Math.floor(k / 3) * 1.6;
        const x = cx + Math.cos(a) * r + ox * Math.sin(a), z = cz + Math.sin(a) * r - ox * Math.cos(a) + oz * 0.3;
        const flap = Math.sin(ts * 9 + i) * 0.6;
        m4.compose(p.set(x, 20 + flock * 4 + Math.sin(ts + k) * 0.5, z), q.setFromEuler(e.set(0, -a, flap * 0.3)), s.set(1, 1 + flap, 1));
        birds.setMatrixAt(i, m4);
      }
      birds.instanceMatrix.needsUpdate = true;
    },
    dispose() { for (const g of geos) g.dispose(); for (const m of mats) m.dispose(); clouds.dispose(); birds.dispose(); },
  };
}
