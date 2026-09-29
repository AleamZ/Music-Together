import * as THREE from "three";
import { liveLook, type PlotDraw, type PlotLook } from "@/lib/game/art/crops";
import {
  BRIDGES, CANAL, COOP, CRAB_HOLES, DRYING_SQUARES, DRYING_YARD, FARM_SHOP, FIELD_PLOTS, PUMP_HOUSE, RAT_HOLES, RICE_DEPOT, SNAIL_BEDS,
} from "@/lib/game/maps/field";
import type { GameMap, PlotGeom, Rect } from "@/lib/game/maps/types";
import { pxLen } from "../coords";
import { rng } from "../layout";
import { inRect, Kit, labelNear, type Inst, type OutdoorOptions } from "./outdoor-kit";
import type { SignIcon } from "./signart";

// Đồng lúa ("field") as a diorama: the paddies sunk between grassy bunds, the canal (Mương) with its two plank bridges
// and Cầu khỉ, the bamboo band along the north, the Hợp tác xã under its tiled roof, the farm shop's striped awning, the
// rice depot's tin roof, the pump house, anh Hai's machine shed, the drying yard's four numbered squares, the haystack,
// the scarecrow, palms and the banana plant, the name posts, rat and crab holes and snail beds. The crops on each plot
// are instanced hills that follow the farm state (plotLook: stage, water, the cut strips) — refilled when a look changes.
// Faithful to lib/game/maps/field.ts and field-art.ts. Pure layout first (testable), then the Three.js builder.

// ---------------------------------------------------------------- pure: ground

export type FieldGround = "canal" | "bridge" | "plot" | "yard" | "road" | "dike" | "grass" | "bamboo";

const inPlot = (x: number, y: number) => FIELD_PLOTS.some((p) => inRect(x, y, p.rect));
const inFarm = (x: number, y: number) => (x >= 64 && x < 516 ? y >= 40 && y < 412 : x >= 516 && x < 664 && y >= 40 && y < 176);

/** The roads of field-art.ts (the same wobbling bands). */
export function onFieldRoad(x: number, y: number): boolean {
  const wob = Math.sin(y * 0.13) * 1.5 + Math.sin(x * 0.21);
  if (x < 60 + wob) return true;
  if (y > 416 + wob && x < 560) return true;
  if (x >= 512 + wob && x < 586 && y >= 208) return true;
  if (y >= 212 + wob && y < 262 && x >= 586) return true;
  if (y >= 330 && y < 388 && x >= 586) return true;
  return x >= 660 && y >= 136 + wob && y < 176;
}

/** The ground at one px (the 2D painter's order: canal, plots, the yard, roads, the farmed bunds, grass). */
export function fieldGroundAt(x: number, y: number): FieldGround {
  if (y < 40) return "bamboo";
  if (inRect(x, y, CANAL)) return BRIDGES.some((b) => inRect(x, y, b)) ? "bridge" : "canal";
  if (inPlot(x, y)) return "plot";
  if (inRect(x, y, DRYING_YARD)) return "yard";
  if (onFieldRoad(x, y)) return "road";
  if (inFarm(x, y)) return "dike";
  return "grass";
}

const GROUND: Record<FieldGround, { top: number; color: number }> = {
  canal: { top: -0.95, color: 0x5a4a30 }, bridge: { top: -0.95, color: 0x5a4a30 }, plot: { top: -0.12, color: 0x8a6a3f },
  yard: { top: 0.04, color: 0xc9c5b8 }, road: { top: -0.02, color: 0xb8925e }, dike: { top: 0.02, color: 0x86b04e },
  grass: { top: 0, color: 0x6aa23c }, bamboo: { top: 0.02, color: 0x4f8a30 },
};

// ---------------------------------------------------------------- pure: crops

export type CropKind = "hill" | "head" | "stubble" | "sheaf" | "seedling" | "vine" | "stalk" | "tassel" | "bush" | "fruit";

/** One crop instance on a plot: px position, height px, lean (radians), colour. */
export interface CropPiece { kind: CropKind; x: number; y: number; h: number; lean: number; color: number }

export interface PlotModel {
  /** The soil's colour (dry, damp, wet) and the water level 0 khô … 3 sâu (a water sheet from 2). */
  soil: number;
  water: number;
  /** Hoa màu: raised beds along the plot (px rects). */
  beds: Rect[];
  pieces: CropPiece[];
}

const K = {
  mudDry: 0xa8875a, mud: 0x8a6a3f, mudWet: 0x6e5230, seed: 0x8fdc62, young: 0x6fbf4a, leaf: 0x5caa4a, leafDark: 0x3f7f2e,
  deepLeaf: 0x3d8a3a, panicle: 0xc9d88a, gold: 0xe0b33c, goldLight: 0xf6c945, goldDark: 0xb8902a, stubble: 0xd8c07a,
  vine: 0x8e4a8a, vineLeaf: 0x4f9a38, tuber: 0xb0486e, stalk: 0x6fae48, tassel: 0xd9c27a, silk: 0xc9607a, chili: 0xd8342a,
  chiliGreen: 0x6fbf4a, flower: 0xf4f1ea,
};

/** Linear mix of two hex colours. */
export function mixHex(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const ch = (s: number) => Math.round(((a >> s) & 255) + ((((b >> s) & 255) - ((a >> s) & 255)) * k));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** What stands on a plot for its look (null = bare stubble after the harvest: the 2D background's plot). Rice hills
 *  8 px apart (the 2D paintHills grid), cut from the left by `cut`; hoa màu on raised beds. Pure. */
export function plotModel(rect: Rect, look: PlotLook | null): PlotModel {
  if (!look) {
    const pieces: CropPiece[] = [];
    for (let y = rect.y + 7; y < rect.y + rect.h - 1; y += 8) for (let x = rect.x + 4; x < rect.x + rect.w - 3; x += 8) {
      pieces.push({ kind: "stubble", x, y, h: 2, lean: 0, color: K.stubble });
    }
    return { soil: K.mud, water: 1, beds: [], pieces };
  }
  const R = rng(look.seed);
  const water = Math.max(0, Math.min(3, Math.round(look.water)));
  if (look.crop !== "rice") return bedModel(rect, look, R);
  const soil = water === 0 ? K.mudDry : water === 1 ? K.mud : K.mudWet;
  const pieces: CropPiece[] = [];
  const { stage, progress: p } = look;
  if (stage === "prepared") return { soil, water, beds: [], pieces };
  if (stage === "seedbed") {
    // the seedbed: a dense nursery strip along the west side
    for (let y = rect.y + 4; y < rect.y + rect.h - 3; y += 3) for (let x = rect.x + 4; x < rect.x + 34; x += 3) {
      pieces.push({ kind: "seedling", x: x + R() * 2, y: y + R() * 2, h: 1.5 + p * 4, lean: (R() - 0.5) * 0.3, color: R() < 0.5 ? K.seed : K.young });
    }
    return { soil, water, beds: [], pieces };
  }
  const cutX = rect.x + Math.round(look.cut * rect.w);
  let hill = 0;
  for (let y = rect.y + 7; y < rect.y + rect.h - 1; y += 8) for (let x = rect.x + 4; x < rect.x + rect.w - 3; x += 8) {
    const bx = x + (look.wobble ? (R() - 0.5) * 4 : 0), by = y + (look.wobble ? (R() - 0.5) * 3 : 0);
    const lean = (R() - 0.5) * 0.3;
    if (x < cutX) {
      pieces.push({ kind: "stubble", x: bx, y: by, h: 2, lean: 0, color: K.goldDark });
      if (hill++ % 3 === 0) pieces.push({ kind: "sheaf", x: bx + 2, y: by, h: 5, lean: 0, color: K.gold });
      continue;
    }
    switch (stage) {
      case "transplanted": pieces.push({ kind: "hill", x: bx, y: by, h: 3 + p * 1.5, lean, color: K.young }); break;
      case "tillering": pieces.push({ kind: "hill", x: bx, y: by, h: 4.5 + p * 3, lean, color: mixHex(K.leaf, K.leafDark, p * 0.4) }); break;
      case "panicle": pieces.push({ kind: "hill", x: bx, y: by, h: 7.5 + p * 2, lean, color: K.deepLeaf }); break;
      case "heading":
        pieces.push({ kind: "hill", x: bx, y: by, h: 9.5, lean, color: K.deepLeaf });
        if (R() < 0.3 + p * 0.6) pieces.push({ kind: "head", x: bx, y: by, h: 9.5, lean, color: K.panicle });
        break;
      case "ripening":
        pieces.push({ kind: "hill", x: bx, y: by, h: 9.5, lean, color: mixHex(K.leaf, K.gold, p) });
        pieces.push({ kind: "head", x: bx, y: by, h: 9.5, lean: lean + 0.2, color: mixHex(K.panicle, K.gold, p) });
        break;
      case "ripe":
        pieces.push({ kind: "hill", x: bx, y: by, h: 9.5, lean: lean + 0.1, color: K.gold });
        pieces.push({ kind: "head", x: bx + 1, y: by, h: 9.5, lean: 0.45, color: K.goldLight });
        break;
      case "overripe":
        // lodged: the stems lie over
        pieces.push({ kind: "hill", x: bx, y: by, h: 7, lean: 0.7 + p * 0.3, color: K.goldDark });
        pieces.push({ kind: "head", x: bx + 4, y: by, h: 5, lean: 1.1, color: K.goldDark });
        break;
      default: break;
    }
  }
  return { soil, water, beds: [], pieces };
}

/** Hoa màu (khoai, bắp, ớt) on raised beds: four beds along the plot, plants every 10 px. */
function bedModel(rect: Rect, look: PlotLook, R: () => number): PlotModel {
  const soil = look.water === 0 ? K.mudDry : look.water >= 3 ? K.mudWet : K.mud;
  const beds: Rect[] = [];
  const n = 4, gap = rect.h / n;
  for (let i = 0; i < n; i++) beds.push({ x: rect.x + 6, y: Math.round(rect.y + i * gap + gap * 0.22), w: rect.w - 12, h: Math.round(gap * 0.56) });
  const pieces: CropPiece[] = [];
  const g = look.stage.startsWith("g") ? Number(look.stage.slice(1)) : look.stage === "ripe" || look.stage === "overripe" || look.stage === "waiting" ? 4 : -1;
  const grow = g < 0 ? 0 : Math.min(1, (g + look.progress) / 4);
  const fruiting = look.stage === "ripe" || look.stage === "overripe";
  const left = Math.max(0, look.pickings - look.picked);
  for (const b of beds) {
    const cy = b.y + b.h / 2;
    for (let x = b.x + 5; x < b.x + b.w - 3; x += 10) {
      if (look.crop === "" || look.stage === "beds") continue;
      if (look.stage === "nursery") { pieces.push({ kind: "seedling", x, y: cy, h: 1.5 + look.progress * 3, lean: 0, color: K.seed }); continue; }
      const jx = x + (R() - 0.5) * 2;
      if (look.crop === "bap") {
        pieces.push({ kind: "stalk", x: jx, y: cy, h: 5 + grow * 23, lean: (R() - 0.5) * 0.15, color: look.stage === "overripe" ? K.tassel : K.stalk });
        if (g >= 3 || fruiting) pieces.push({ kind: "tassel", x: jx, y: cy, h: 5 + grow * 23, lean: 0, color: K.tassel });
        if (fruiting && left > 0) pieces.push({ kind: "fruit", x: jx + 1.5, y: cy, h: 3 + grow * 10, lean: 0.4, color: K.silk });
      } else if (look.crop === "khoai") {
        pieces.push({ kind: "vine", x: jx, y: cy, h: 2 + grow * 4, lean: R() * Math.PI, color: R() < 0.3 ? K.vine : K.vineLeaf });
        if (fruiting && left > 0 && R() < 0.5) pieces.push({ kind: "fruit", x: jx + 3, y: cy + 2, h: 1, lean: 0, color: K.tuber });
      } else {
        // ớt (and any other bush crop)
        pieces.push({ kind: "bush", x: jx, y: cy, h: 3 + grow * 8, lean: 0, color: K.chiliGreen });
        if (g >= 2 && !fruiting) pieces.push({ kind: "fruit", x: jx + 1, y: cy, h: 2 + grow * 6, lean: 0, color: K.flower });
        if (fruiting && left > 0) for (let k = 0; k < 3; k++) pieces.push({ kind: "fruit", x: jx + (k - 1) * 2, y: cy + (R() - 0.5) * 2, h: 2 + grow * 5 + k, lean: 0, color: look.stage === "overripe" ? 0x8e1f1a : K.chili });
      }
    }
  }
  return { soil, water: Math.min(look.water, 2), beds, pieces };
}

// ---------------------------------------------------------------- pure: the static layout

export interface FieldLayout {
  bamboo: Array<{ x: number; y: number; h: number; seed: number }>;
  tufts: Array<{ x: number; y: number; flower: boolean }>;
  lights: Array<{ x: number; y: number; r: number }>;
  plots: PlotGeom[];
}

/** The field's repeated plants and its lights (px), seeded: every client builds the same. */
export function fieldLayout(map: GameMap, opts: OutdoorOptions = {}): FieldLayout {
  const density = opts.density ?? 1;
  const R = rng(3101);
  const bamboo: FieldLayout["bamboo"] = [];
  for (let x = 3; x < map.width; x += 6 / density) bamboo.push({ x: x + R() * 3, y: 4 + R() * 30, h: 42 + R() * 26, seed: Math.floor(R() * 1e6) });
  const tufts: FieldLayout["tufts"] = [];
  for (let k = 0; k < 900 && tufts.length < Math.round(220 * density); k++) {
    const x = R() * map.width, y = 44 + R() * (map.height - 46);
    if (fieldGroundAt(x, y) !== "grass" && fieldGroundAt(x, y) !== "dike") continue;
    if ([COOP, FARM_SHOP, RICE_DEPOT, PUMP_HOUSE].some((r) => inRect(x, y, r, 6))) continue;
    tufts.push({ x, y, flower: R() < 0.12 });
  }
  return {
    bamboo, tufts, plots: map.plots,
    lights: [
      { x: COOP.x + 24, y: COOP.y + 40, r: 22 }, { x: COOP.x + 86, y: COOP.y + 40, r: 22 }, { x: COOP.x + 56, y: COOP.y + COOP.h + 10, r: 40 },
      { x: FARM_SHOP.x + FARM_SHOP.w / 2, y: FARM_SHOP.y + FARM_SHOP.h + 6, r: 42 }, { x: RICE_DEPOT.x + 72, y: RICE_DEPOT.y + RICE_DEPOT.h + 6, r: 38 },
    ],
  };
}

/** Where feet stand on the field (units): down in the paddies, up on the bridges and the yard. */
export function fieldHeightAt(x: number, y: number): number {
  const g = fieldGroundAt(x, y);
  return g === "bridge" ? 0.14 : g === "plot" ? -0.1 : g === "yard" ? 0.05 : 0;
}

// ---------------------------------------------------------------- Three.js

const PIECES_PER_PLOT = 460;

export function buildFieldZone(map: GameMap, opts: OutdoorOptions = {}): THREE.Group {
  const L = fieldLayout(map, opts);
  const k = new Kit(map);
  const { W } = { W: (x: number, y: number) => k.W(x, y) };
  k.terrain(map.cell, (x, y) => GROUND[fieldGroundAt(x, y)], 31);
  k.base();

  // ---- the canal: water between muddy banks; crab holes and snail beds on its lips
  k.water(CANAL, { y: -0.3, color: 0x4f8fa0, flow: 0.4, segs: [80, 4] });
  for (const r of CRAB_HOLES) {
    const c = W(r.x + r.w / 2, r.y + r.h / 2);
    k.mesh(k.geo(new THREE.CylinderGeometry(pxLen(5), pxLen(6), 0.06, 8)), k.lam(0x24190f), c.x, 0.01, c.z, k.root, false);
    k.box(pxLen(10), 0.08, pxLen(3), 0x6e5230, c.x, 0, c.z + pxLen(4));
  }
  const pebbles: Inst[] = [];
  const PR = rng(77);
  for (const r of SNAIL_BEDS) for (let i = 0; i < 7; i++) {
    const c = W(r.x + PR() * r.w, r.y + PR() * r.h);
    pebbles.push({ x: c.x, y: -0.28, z: c.z, sx: 0.12, sy: 0.07, sz: 0.1, ry: PR() * 3, color: i % 2 ? 0x8a8478 : 0x5a4a3a });
  }
  k.inst(k.geo(new THREE.DodecahedronGeometry(1, 0)), k.lam(0xffffff), pebbles);
  for (const h of RAT_HOLES) {
    const c = W(h.x, h.y);
    k.mesh(k.geo(new THREE.CylinderGeometry(pxLen(4), pxLen(4.5), 0.05, 7)), k.lam(0x24190f), c.x, 0.03, c.z, k.root, false);
    k.mesh(k.geo(new THREE.SphereGeometry(1, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2)), k.lam(0x8a6a3f), c.x + 0.3, 0, c.z + 0.2).scale.set(0.2, 0.1, 0.14);
  }

  // ---- bridges (planks on stringers with low rails) and Cầu khỉ off the east edge
  for (const b of BRIDGES) {
    const c = W(b.x + b.w / 2, b.y + b.h / 2);
    k.box(pxLen(b.w), 0.12, pxLen(b.h - 6), 0xb88a52, c.x, 0.02, c.z);
    for (let yy = b.y + 6; yy < b.y + b.h - 4; yy += 4) k.beam(b.x, yy, b.x + b.w, yy, 0.145, 0.03, 0x8b5a33, 0.01);
    for (const sx of [b.x + 1, b.x + b.w - 1]) {
      k.beam(sx, b.y + 4, sx, b.y + b.h - 4, 0.55, 0.06, 0x5a3a1e);
      for (const sy of [b.y + 5, b.y + b.h / 2, b.y + b.h - 5]) { const p = W(sx, sy); k.box(0.08, 1.4, 0.08, 0x5a3a1e, p.x, -0.9, p.z); }
    }
  }
  k.beam(786, 250, 800, 250, 0.3, 0.08, 0xa8b84e);
  k.beam(786, 242, 800, 242, 0.85, 0.05, 0x7aa640);
  for (const x of [788, 796]) { const p = W(x, 246); k.box(0.07, 0.9, 0.07, 0x7aa640, p.x, 0, p.z); }

  // ---- paddies: bunds round each plot, the name posts
  const bund = k.lam(0x7fa846);
  for (const g of FIELD_PLOTS) {
    const r = g.rect;
    for (const e of [
      { x: r.x - 2, y: r.y - 2, w: r.w + 4, h: 3 }, { x: r.x - 2, y: r.y + r.h - 1, w: r.w + 4, h: 3 },
      { x: r.x - 2, y: r.y, w: 3, h: r.h }, { x: r.x + r.w - 1, y: r.y, w: 3, h: r.h },
    ]) k.boxPx(e, -0.12, 0.2, bund);
    const p = W(g.post.x, g.post.y);
    k.box(0.1, 1.4, 0.1, 0x5a3a1e, p.x, 0, p.z);
    k.box(0.8, 0.34, 0.06, 0xf4f1e8, p.x, 1.05, p.z + 0.06);
  }

  // ---- the plots' soil, water sheets and crops: refilled from the farm state
  const soilMat: THREE.MeshLambertMaterial[] = [];
  const waterSheets: THREE.Mesh[] = [];
  const bedGroups: THREE.Group[] = [];
  const sheetMat = k.own(new THREE.MeshPhongMaterial({ color: 0x4f9ac8, transparent: true, opacity: 0.62, shininess: 80, specular: 0xbfe6ff, flatShading: true }));
  for (const g of FIELD_PLOTS) {
    const m = k.own(new THREE.MeshLambertMaterial({ color: K.mud, flatShading: true }));
    soilMat.push(m);
    const s = k.boxPx(g.rect, -0.13, 0.02, m, 1);
    s.userData.keep = true;
    s.castShadow = false;
    const sheet = k.boxPx(g.rect, -0.1, 0.02, sheetMat, 1);
    sheet.userData.keep = true;
    sheet.castShadow = false;
    sheet.visible = false;
    waterSheets.push(sheet);
    const bg = new THREE.Group();
    bg.userData.keep = true;
    k.root.add(bg);
    bedGroups.push(bg);
  }
  const cap = FIELD_PLOTS.length * PIECES_PER_PLOT;
  const hillGeo = k.geo(new THREE.ConeGeometry(0.16, 1, 5));
  hillGeo.translate(0, 0.5, 0);
  const headGeo = k.geo(new THREE.CapsuleGeometry(0.05, 0.22, 2, 4));
  const cubeGeo = k.geo(new THREE.BoxGeometry(1, 1, 1));
  cubeGeo.translate(0, 0.5, 0);
  const ballGeo = k.geo(new THREE.IcosahedronGeometry(1, 0));
  const cropMeshes = {
    hill: k.inst(hillGeo, k.lam(0xffffff), [], { capacity: cap }),
    head: k.inst(headGeo, k.lam(0xffffff), [], { capacity: cap, shadow: false }),
    cube: k.inst(cubeGeo, k.lam(0xffffff), [], { capacity: cap }),
    ball: k.inst(ballGeo, k.lam(0xffffff), [], { capacity: cap, shadow: false }),
  };
  for (const im of Object.values(cropMeshes)) { im.userData.keep = true; im.frustumCulled = false; }
  const keys: string[] = FIELD_PLOTS.map(() => "");
  const models: PlotModel[] = FIELD_PLOTS.map((g) => plotModel(g.rect, null));
  const refill = () => {
    const lists: Record<keyof typeof cropMeshes, Inst[]> = { hill: [], head: [], cube: [], ball: [] };
    FIELD_PLOTS.forEach((g, i) => {
      const m = models[i];
      soilMat[i].color.setHex(m.soil);
      waterSheets[i].visible = m.water >= 2;
      waterSheets[i].position.y = m.water >= 3 ? -0.03 : -0.08;
      const top = -0.11;
      for (const p of m.pieces) {
        const w = W(p.x, p.y), h = pxLen(p.h);
        switch (p.kind) {
          case "hill": lists.hill.push({ x: w.x, y: top, z: w.z, sx: 1, sy: h, sz: 1, rz: p.lean, color: p.color }); break;
          case "seedling": lists.hill.push({ x: w.x, y: top, z: w.z, sx: 0.35, sy: h, sz: 0.35, rz: p.lean, color: p.color }); break;
          case "head": lists.head.push({ x: w.x + Math.sin(p.lean) * h * 0.8, y: top + h * 0.92, z: w.z, rz: p.lean + 0.6, color: p.color }); break;
          case "stubble": lists.cube.push({ x: w.x, y: top, z: w.z, sx: 0.14, sy: h / 16 * 1.6, sz: 0.14, color: p.color }); break;
          case "sheaf": lists.hill.push({ x: w.x, y: top, z: w.z, sx: 0.9, sy: h, sz: 0.9, rx: Math.PI, color: p.color }); break;
          case "stalk": lists.cube.push({ x: w.x, y: top, z: w.z, sx: 0.07, sy: h, sz: 0.07, rz: p.lean, color: p.color });
            lists.hill.push({ x: w.x, y: top + h * 0.2, z: w.z, sx: 1.2, sy: h * 0.75, sz: 0.5, ry: p.x, color: 0x5a9a38 }); break;
          case "tassel": lists.hill.push({ x: w.x, y: top + h, z: w.z, sx: 0.5, sy: 0.35, sz: 0.5, color: p.color }); break;
          case "vine": lists.ball.push({ x: w.x, y: top + h * 0.3, z: w.z, sx: 0.28 + h * 0.4, sy: 0.1 + h * 0.3, sz: 0.24 + h * 0.3, ry: p.lean, color: p.color }); break;
          case "bush": lists.ball.push({ x: w.x, y: top + h * 0.5, z: w.z, sx: 0.12 + h * 0.3, sy: h * 0.55, sz: 0.12 + h * 0.3, color: p.color }); break;
          case "fruit": lists.ball.push({ x: w.x, y: top + h, z: w.z + 0.1, sx: 0.07, sy: 0.1, sz: 0.07, color: p.color }); break;
        }
      }
      // the raised beds (hoa màu)
      const bg = bedGroups[i];
      for (const c of bg.children) c.removeFromParent();
      for (const b of m.beds) k.boxPx(b, -0.12, 0.14, m.soil === K.mudDry ? 0x9a7a4c : 0x7a5a34, 0, bg);
    });
    for (const [name, im] of Object.entries(cropMeshes)) k.fill(im, lists[name as keyof typeof cropMeshes]);
  };
  refill();

  // ---- the bamboo band along the north (instanced culms and leafy tops)
  const culms: Inst[] = [], tops: Inst[] = [];
  for (const b of L.bamboo) {
    const w = W(b.x, b.y), h = pxLen(b.h);
    culms.push({ x: w.x, y: h / 2, z: w.z, sy: h, rx: ((b.seed % 20) - 10) / 90, rz: ((b.seed % 17) - 8) / 80, color: b.seed % 3 ? 0x8fb84e : 0x7aa640 });
    tops.push({ x: w.x, y: h * 0.78, z: w.z, sx: 0.7, sy: h * 0.55, sz: 0.7, ry: (b.seed % 100) / 16, color: [0x4f8a30, 0x44792a, 0x5a9a38][b.seed % 3] });
  }
  k.inst(k.geo(new THREE.CylinderGeometry(0.05, 0.06, 1, 5)), k.lam(0xffffff), culms, { thin: true });
  k.inst(k.geo(new THREE.ConeGeometry(1, 1, 5)), k.lam(0xffffff), tops, { thin: true });
  // grass tufts and flowers on the grass and the bunds
  k.inst(k.geo(new THREE.ConeGeometry(0.08, 0.3, 4)), k.lam(0xffffff),
    L.tufts.map((t, i) => { const w = W(t.x, t.y); return { x: w.x, y: 0.12, z: w.z, ry: i, color: t.flower ? (i % 2 ? 0xf6c945 : 0xf4f1ea) : i % 3 ? 0x4f8a2e : 0x86b04e }; }),
    { thin: true, shadow: false });

  // ---- buildings
  // Hợp tác xã: plastered walls, two shuttered windows, a tiled hip roof, a porch
  {
    const r = COOP, c = W(r.x + r.w / 2, r.y + 16 + (r.h - 16) / 2), w = pxLen(r.w), d = pxLen(r.h - 16), h = 2.4;
    k.box(w, h, d, 0xefe4c8, c.x, 0, c.z);
    k.box(w + 0.1, 0.18, d + 0.1, 0xd8c9a4, c.x, 0, c.z);
    for (const wx of [r.x + 24, r.x + 86]) {
      const p = W(wx, r.y + r.h);
      k.box(1.1, 0.8, 0.06, 0x3f7f7a, p.x, 1.0, p.z + 0.02);
      k.box(0.06, 0.8, 0.08, 0x2f5f5a, p.x, 1.0, p.z + 0.03);
      k.box(1.3, 0.08, 0.14, 0x8a5a30, p.x, 0.95, p.z + 0.06);
    }
    const door = W(r.x + r.w / 2, r.y + r.h);
    k.box(1.1, 1.5, 0.06, 0x6e4424, door.x, 0, door.z + 0.02);
    k.box(pxLen(r.w) * 0.5, 0.1, 0.9, 0xc9c5b8, door.x, 0, door.z + 0.45);
    const roof = k.roof({ x: r.x - 6, y: r.y - 12, w: r.w + 12, h: r.h + 12 });
    const cone = k.mesh(k.geo(new THREE.ConeGeometry(1, 1, 4, 1)), roof.mat(0xb5463a), c.x, h + 0.9, c.z);
    cone.scale.set((w + 0.8) * 0.72, 1.8, (d + 0.8) * 0.72);
    cone.rotation.y = Math.PI / 4;
    const eave = k.box(w + 0.8, 0.1, d + 0.8, roof.mat(0x8e3a30), c.x, h, c.z);
    eave.castShadow = true;
    k.bulb(door.x + 0.9, 1.9, door.z + 0.15);
  }
  // Tiệm vật tư: a green back wall with sacks on shelves under a green-white striped awning
  {
    const r = FARM_SHOP, c = W(r.x + r.w / 2, r.y + r.h / 2), w = pxLen(r.w), d = pxLen(r.h), h = 2.1;
    const back = W(r.x + r.w / 2, r.y + 2);
    k.box(w, h, 0.25, 0x9ab86a, back.x, 0, back.z);
    for (const sx of [-1, 1]) k.box(0.2, h, d * 0.8, 0x8aa85a, c.x + sx * (w / 2 - 0.1), 0, back.z + d * 0.4);
    for (let s = 0; s < 2; s++) {
      k.box(w - 0.6, 0.06, 0.5, 0x6e4424, back.x, 0.6 + s * 0.7, back.z + 0.35);
      for (let i = 0; i < 7; i++) k.box(0.4, 0.4, 0.34, i % 2 ? 0xf4ead8 : 0xe8dcc0, back.x - w / 2 + 0.6 + i * 0.75, 0.66 + s * 0.7, back.z + 0.35);
    }
    const front = W(r.x + r.w / 2, r.y + r.h - 6);
    k.box(w * 0.8, 0.8, 0.5, 0x6e4424, front.x, 0, front.z);
    const roof = k.roof({ x: r.x - 6, y: r.y - 14, w: r.w + 12, h: r.h + 14 });
    const n = 14;
    for (let i = 0; i < n; i++) {
      const s = k.box((w + 0.8) / n + 0.01, 0.1, d + 0.6, roof.mat(i % 2 ? 0xf4f1ea : 0x3f7f2e), c.x - (w + 0.8) / 2 + (i + 0.5) * ((w + 0.8) / n), h, c.z);
      s.rotation.x = 0.2;
    }
    for (const sx of [-1, 1]) k.box(0.14, h + 0.2, 0.14, 0x5a3a1e, c.x + sx * (w / 2), 0, c.z + d / 2);
    k.bulb(c.x - w / 2 + 0.2, h - 0.2, c.z + d / 2 + 0.1);
  }
  // Vựa lúa: plank walls, a big dark door, a corrugated tin roof
  {
    const r = RICE_DEPOT, c = W(r.x + r.w / 2, r.y + r.h / 2 - 6), w = pxLen(r.w), d = pxLen(r.h) - 0.8, h = 2.3;
    k.box(w, h, d, 0xb88a52, c.x, 0, c.z);
    for (let i = 0; i < 12; i++) k.box(0.04, h, d + 0.02, 0x8b5a33, c.x - w / 2 + (i + 0.5) * (w / 12), 0, c.z);
    const door = W(r.x + 72, r.y + r.h - 12);
    k.box(1.7, 1.9, 0.06, 0x6e4424, door.x, 0, c.z + d / 2 + 0.01);
    k.box(0.05, 1.9, 0.08, 0x3a2418, door.x, 0, c.z + d / 2 + 0.02);
    const roof = k.roof({ x: r.x - 6, y: r.y - 18, w: r.w + 12, h: r.h + 18 });
    for (const [side, rot] of [[-1, -0.32], [1, 0.32]] as const) {
      const s = k.box(w + 0.7, 0.08, d / 2 + 0.6, roof.mat(0x8fa3ad), c.x, h + 0.4, c.z + side * (d / 4 + 0.1));
      s.rotation.x = rot;
    }
    for (let i = 0; i < 10; i++) k.box(0.04, 0.1, d + 1.1, roof.mat(0xb3c4cc), c.x - w / 2 + (i + 0.5) * (w / 10), h + 0.36, c.z);
    // sacks of rice stacked out front
    for (let i = 0; i < 5; i++) k.box(0.5, 0.36, 0.34, 0xe8dcc0, c.x - w / 2 + 0.5 + (i % 3) * 0.55, (i > 2 ? 0.36 : 0), c.z + d / 2 + 0.5);
    k.bulb(door.x + 1.1, 1.8, c.z + d / 2 + 0.15);
  }
  // the pump house: a concrete block with a pipe down into the canal
  {
    const r = PUMP_HOUSE, c = W(r.x + r.w / 2, r.y + r.h / 2);
    k.box(pxLen(r.w), 1.5, pxLen(r.h), 0xc9c5b8, c.x, -0.2, c.z);
    k.box(pxLen(r.w) + 0.3, 0.12, pxLen(r.h) + 0.3, 0x8fa3ad, c.x, 1.3, c.z);
    k.beam(52, 206, 52, 214, 0.2, 0.14, 0x59616a);
    k.mesh(k.geo(new THREE.CylinderGeometry(0.1, 0.1, 0.7, 6)), k.lam(0x59616a), W(52, 214).x, -0.1, W(52, 214).z);
  }
  // anh Hai's machine shed: a tin shed with a tractor's nose showing
  {
    const r = { x: 405, y: 430, w: 54, h: 26 }, c = W(r.x + r.w / 2, r.y + r.h / 2), w = pxLen(r.w), d = pxLen(r.h);
    k.box(w, 1.8, 0.12, 0x71858f, c.x, 0, c.z - d / 2);
    for (const sx of [-1, 1]) k.box(0.12, 1.8, d, 0x71858f, c.x + sx * w / 2, 0, c.z);
    const roof = k.roof({ x: r.x - 4, y: r.y - 10, w: r.w + 8, h: r.h + 14 });
    const top = k.box(w + 0.5, 0.08, d + 0.6, roof.mat(0x8fa3ad), c.x, 1.85, c.z);
    top.rotation.x = -0.12;
    k.box(1.3, 0.7, 0.9, 0xd8342a, c.x - 0.5, 0.25, c.z + 0.1);
    k.box(0.6, 0.5, 0.6, 0xd8342a, c.x + 0.4, 0.25, c.z + 0.1);
    for (const [dx, rr] of [[-0.8, 0.38], [0.5, 0.26]] as const) {
      const wh = k.mesh(k.geo(new THREE.CylinderGeometry(rr, rr, 0.2, 10)), k.lam(0x2a2a2e), c.x + dx, rr, c.z + 0.6);
      wh.rotation.x = Math.PI / 2;
    }
  }
  // the drying yard: a concrete apron and four numbered squares (1…4 as pips)
  DRYING_SQUARES.forEach((s, i) => {
    k.boxPx(s, 0.04, 0.03, 0xdedacd, 1);
    const c = W(s.x + 6, s.y + 6);
    for (let n = 0; n <= i; n++) k.box(0.12, 0.01, 0.12, 0xaaa698, c.x + n * 0.2, 0.07, c.z);
    // a thin raked layer of paddy on the first two squares
    if (i < 2) {
      const lay = k.boxPx(s, 0.07, 0.03, 0xe0c56a, 6);
      for (let yy = s.y + 10; yy < s.y + s.h - 6; yy += 8) k.beam(s.x + 8, yy, s.x + s.w - 8, yy, 0.105, 0.05, 0xc9a23a, 0.01);
      lay.castShadow = false;
    }
  });
  // haystack, scarecrow, palms, the banana, signs, the city post
  for (const p of map.props) {
    switch (p.kind) {
      case "haystack": {
        const c = W(p.x, p.y);
        const hs = k.mesh(k.geo(new THREE.ConeGeometry(1, 1, 8)), k.lam(0xd9b85a), c.x, 0.7, c.z);
        hs.scale.set(0.95, 1.4, 0.8);
        k.mesh(k.geo(new THREE.CylinderGeometry(0.8, 0.95, 0.5, 8)), k.lam(0xc9a64a), c.x, 0.25, c.z);
        k.box(0.06, 0.6, 0.06, 0x5a3a1e, c.x, 1.3, c.z);
        break;
      }
      case "scarecrow": {
        const c = W(p.x, p.y);
        k.box(0.1, 1.9, 0.1, 0x5a3a1e, c.x, -0.1, c.z);
        k.box(1.4, 0.08, 0.08, 0x5a3a1e, c.x, 1.2, c.z);
        k.box(0.55, 0.6, 0.3, 0x3f6fb8, c.x, 0.85, c.z);
        k.mesh(k.geo(new THREE.SphereGeometry(0.2, 6, 5)), k.lam(0xe8dcc0), c.x, 1.65, c.z);
        const hat = k.mesh(k.geo(new THREE.ConeGeometry(0.42, 0.28, 10)), k.lam(0xe0c56a), c.x, 1.92, c.z);
        hat.castShadow = true;
        break;
      }
      case "palm": k.palm(p.x, p.y, p.h, p.lean, p.seed); break;
      case "banana": k.banana(p.x, p.y); break;
      case "sign": k.sign(p.x, p.y, "sign", labelNear(map, p.x, p.y - 12), (p as { icon?: SignIcon }).icon); break;
      case "city_map_post": k.sign(p.x, p.y, "city"); break;
      default: break;
    }
  }
  for (const l of L.lights) k.lamp(l.x, l.y, l.r);

  let lastPlots: ReadonlyArray<PlotDraw> = [], lastAt = -Infinity;
  const setPlots = (plots: ReadonlyArray<PlotDraw>, now: number) => {
    lastPlots = plots;
    lastAt = now;
    {
      let dirty = false;
      FIELD_PLOTS.forEach((g, i) => {
        const d = plots.find((p) => p.no === g.no);
        const look = d ? liveLook(d, now) : null;
        const key = look ? `${look.crop}|${look.stage}|${Math.floor(look.progress * 5)}|${look.water}|${look.wobble}|${Math.floor(look.cut * 12)}|${look.picked}` : "-";
        if (key === keys[i]) return;
        keys[i] = key;
        models[i] = plotModel(g.rect, look);
        dirty = true;
      });
      if (dirty) refill();
    }
  };
  return k.finish({
    heightAt: fieldHeightAt,
    setPlots,
    // the crops grow (and a harvester crosses) between the farm's fetches: look again every second
    animate() {
      const now = Date.now();
      if (lastPlots.length && now - lastAt > 1000) setPlots(lastPlots, now);
    },
  });
}



/** Dev (/dev/diorama): ten plots showing the stages side by side — rice from the seedbed to lodged, a cut half, the
 *  water levels, and khoai, bắp and ớt on beds. */
export function demoFieldPlots(): PlotDraw[] {
  const look = (no: number, crop: string, stage: PlotLook["stage"], progress: number, water: number, extra: Partial<PlotLook> = {}): PlotLook => ({
    crop, stage, progress, water, pests: [], wobble: false, cut: 0, picked: 0, pickings: 1, seed: no * 7919, ...extra,
  });
  const looks: PlotLook[] = [
    look(1, "rice", "seedbed", 0.7, 2), look(2, "rice", "tillering", 0.6, 3), look(3, "rice", "heading", 0.8, 2),
    look(4, "rice", "ripe", 0.3, 1, { cut: 0.5 }), look(5, "rice", "transplanted", 0.5, 2, { wobble: true }), look(6, "rice", "ripening", 0.6, 1),
    look(7, "rice", "overripe", 0.5, 0), look(8, "khoai", "ripe", 0.2, 1, { pickings: 2 }), look(9, "bap", "ripe", 0.2, 1, { pickings: 2 }),
    look(10, "ot", "ripe", 0.2, 1, { pickings: 3 }),
  ];
  return looks.map((l, i) => ({ no: i + 1, look: l, label: `${i + 1}`, urgent: false, parts: 0, harvester: null }));
}


