import type { FarmCatalog, UplandCrop, Variety } from "@/lib/game/farm/catalog";
import { cropModel, cropPhase, hrs, waterAt } from "@/lib/game/farm/crop";
import type { CropView, PestKind, PlotView } from "@/lib/game/farm/state";
import { uplandModel, upNext, upOverAt, upPhase, upReadyAt, type UplandModel } from "@/lib/game/farm/upland";
import { C, ctx2d, makeCanvas, px, rect, rng, type Ctx } from "@/lib/game/maps/scene-art";

// The crops on a plot (spec §13.4, §14; v15.2 §15): what to draw (pure) and its procedural painters (browser only:
// canvas) — the rice stages and its cut strips, raised beds and the hoa-màu crops, the water by level, the pests and
// the co-op's harvester. Original art.

export type CropStage =
  | "prepared" | "seedbed" | "transplanted" | "tillering" | "panicle" | "heading" | "ripening" | "ripe" | "overripe"
  // hoa màu: bare beds, the ớt nursery, the config's stages by index, and the wait for the next picking
  | "beds" | "nursery" | "g0" | "g1" | "g2" | "g3" | "g4" | "waiting";

export interface PlotLook {
  /** "rice" on a paddy; on beds the hoa-màu crop's id, "" before planting. */
  crop: string;
  stage: CropStage;
  /** How far through the stage, 0–1. */
  progress: number;
  /** 0 khô … 3 sâu (on beds: Khô … Ngập). */
  water: number;
  /** The untreated pests. */
  pests: PestKind[];
  /** Crooked rows (a poor transplant, qT < 1). */
  wobble: boolean;
  /** Rice: the share cut from the left, 0–1 (the parts, and a harvester on its way). */
  cut: number;
  /** Hoa màu: the pickings gone (taken or lost) of the crop's `pickings`. */
  picked: number;
  pickings: number;
  seed: number;
}

/** A running harvester (v15.2 §6.3). */
export interface HarvesterJob { startedAt: number; endsAt: number }

/** What the engine draws on a plot: its look (null = the background's bare stubble), the name post's label, the
 *  farmer's urgent ring, and what changes every frame: the rice parts cut and a running harvester. */
export interface PlotDraw {
  no: number;
  look: PlotLook | null;
  label: string;
  urgent: boolean;
  parts: number;
  harvester: HarvesterJob | null;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const untreated = (crop: CropView): PestKind[] => crop.pests.filter((p) => p.treatedAt === null).map((p) => p.kind);

/** The share of a rice plot cut at `now`: its parts, and a harvester's progress over the rest (§15). */
export function riceCut(parts: number, harvester: HarvesterJob | null, now: number): number {
  const p = Math.max(0, Math.min(6, parts));
  if (!harvester) return p / 6;
  const span = harvester.endsAt - harvester.startedAt;
  return (p + (span > 0 ? clamp01((now - harvester.startedAt) / span) : 1) * (6 - p)) / 6;
}

/** The look of a plot's crop at `now`; null while the plot is unprepared (no crop, or seed soaking before preparing).
 *  `u` is the hoa-màu crop's config on beds. */
export function plotLook(no: number, crop: CropView | null, v: Variety | null, now: number, u: UplandCrop | null = null): PlotLook | null {
  if (!crop) return null;
  if (crop.kind === "upland") return bedLook(no, crop, u, now);
  if (crop.preparedAt === null) return null;
  const c = cropModel(crop);
  const s = v?.scale ?? 1;
  const T = c.transplantAt === null ? 0 : hrs(c.transplantAt, now);
  let stage: CropStage;
  let progress = 0;
  switch (cropPhase(c, v, now)) {
    case "seedling": stage = "seedbed"; progress = c.sowAt === null ? 0 : hrs(c.sowAt, now) / (14 * s); break;
    case "tillering":
      if (T < 3 * s) { stage = "transplanted"; progress = T / (3 * s); } else { stage = "tillering"; progress = (T - 3 * s) / (15 * s); }
      break;
    case "panicle": stage = "panicle"; progress = (T - 18 * s) / (12 * s); break;
    case "heading": stage = "heading"; progress = (T - 30 * s) / (10 * s); break;
    case "ripening": stage = "ripening"; progress = (T - 40 * s) / (8 * s); break;
    case "ripe": stage = "ripe"; progress = (T - 48 * s) / 12; break;
    case "overripe": stage = "overripe"; progress = (T - 48 * s - 12) / 48; break;
    default: stage = "prepared";
  }
  return {
    crop: "rice", stage, progress: clamp01(progress),
    // the farmer has the log (exact at any time); the others get the level at the last fetch
    water: crop.log ? waterAt(crop.log.water, now) : crop.water,
    pests: untreated(crop), wobble: (crop.log?.qTransplant ?? 1) < 1, cut: riceCut(crop.parts, crop.harvester, now), picked: 0,
    pickings: 1, seed: no * 7919,
  };
}

/** The farmer's model of the beds; a neighbour has no log, so the pickings before the server's next one are gone. */
function bedModel(crop: CropView): UplandModel {
  const c = uplandModel(crop);
  if (crop.log || crop.picking === null) return c;
  const gone = crop.picking === 0 ? crop.pickings : Math.max(0, crop.picking - 1);
  return { ...c, harvests: Array.from({ length: gone }, (_, j) => ({ t: 0, k: j + 1, kg: 0 })) };
}

function bedLook(no: number, crop: CropView, u: UplandCrop | null, now: number): PlotLook {
  const n = u?.pickings.length ?? 1;
  const base = {
    crop: crop.upland ?? "", water: crop.log ? waterAt(crop.log.water, now) : crop.water, pests: untreated(crop), wobble: false,
    cut: 0, pickings: n, seed: no * 7919,
  };
  if (!u || crop.upland === null) return { ...base, crop: "", stage: "beds", progress: 0, picked: 0 };
  const c = bedModel(crop);
  const k = upNext(c, u, now);
  let stage: CropStage = "beds";
  let progress = 0;
  const ph = upPhase(c, u, now);
  if (ph === "nursery") {
    stage = "nursery";
    progress = c.sowAt !== null && u.nurseryReadyH ? hrs(c.sowAt, now) / u.nurseryReadyH : 0;
  } else if (ph === "waiting") {
    stage = "waiting";
  } else if (ph === "ripe" && k > 0) {
    stage = "ripe";
    progress = hrs(upReadyAt(c, u, k)!, now) / u.ripeWindowH;
  } else if (ph === "overripe" && k > 0) {
    stage = "overripe";
    progress = hrs(upOverAt(c, u, k)!, now) / u.lostAfterH;
  } else {
    const i = u.stages.findIndex((st) => st.id === ph);
    if (i >= 0 && c.plantAt !== null) {
      stage = `g${Math.min(i, 4)}` as CropStage;
      const from = i === 0 ? 0 : u.stages[i - 1].untilH;
      progress = (hrs(c.plantAt, now) - from) / (u.stages[i].untilH - from);
    }
  }
  return { ...base, stage, progress: clamp01(progress), picked: k === 0 ? n : k - 1 };
}

/** The cache key of a look: progress in fifths is enough to see a crop grow, and the cut in twelfths (half strips) to
 *  see a harvester cross. */
export function lookKey(l: PlotLook): string {
  return `${l.crop}|${l.stage}|${Math.floor(l.progress * 5)}|${l.water}|${l.pests.join(",")}|${l.wobble ? 1 : 0}|${Math.floor(l.cut * 12)}|${l.picked}`;
}

/** The name post: the plot number and its owner (private) or farmer (village), else what it is. */
export function plotLabel(p: PlotView): string {
  const who = p.kind === "private" ? p.owner : p.farmer;
  return `${p.no} · ${who ? who.name : p.kind === "private" ? "đất bán" : "đất trống"}`;
}

/** The name post at `now` (v15.2 §13.6): "· máy gặt 25s" while a harvester runs, "· gặt 2/6" while partly cut. */
export function postLabel(d: PlotDraw, now: number): string {
  if (d.harvester) return now < d.harvester.endsAt ? `${d.label} · máy gặt ${Math.ceil((d.harvester.endsAt - now) / 1000)}s` : d.label;
  return d.parts > 0 && d.parts < 6 ? `${d.label} · gặt ${d.parts}/6` : d.label;
}

/** A plot's look at `now` with the cut a running harvester has reached (drawn every frame). */
export function liveLook(d: PlotDraw, now: number): PlotLook | null {
  return d.look && d.harvester ? { ...d.look, cut: riceCut(d.parts, d.harvester, now) } : d.look;
}

/** Everything the engine draws on the plots at `now`; `urgent` = the plots with an urgent task of mine. */
export function plotDraws(plots: readonly PlotView[], catalog: Pick<FarmCatalog, "varieties" | "uplands">, urgent: ReadonlySet<number>,
  now: number): PlotDraw[] {
  return plots.map((p) => ({
    no: p.no,
    look: plotLook(p.no, p.crop, catalog.varieties.find((v) => v.id === p.crop?.variety) ?? null, now,
      catalog.uplands.find((u) => u.id === p.crop?.upland) ?? null),
    label: plotLabel(p),
    urgent: urgent.has(p.no),
    parts: p.crop?.kind === "rice" ? p.crop.parts : 0,
    harvester: p.crop?.harvester ?? null,
  }));
}

const K = {
  mudWet: "#6e5230", mud: "#8a6a3f", mudDry: "#a8875a", crack: "#7a5c38", sheen: "#9fc3cf", deep: "#5d93ad",
  seed1: "#8fdc62", seed2: "#6fbf4a", young: "#6fbf4a", youngDark: "#4f9a38", leaf: "#5caa4a", leafDark: "#3f7f2e",
  deepLeaf: "#3d8a3a", panicle: "#c9d88a", gold: "#e0b33c", goldLight: "#f6c945", goldDark: "#b8902a",
  egg: "#f29bb5", shell: "#8a5a2b", roll: "#f4f1ea", hopper: "#7a4a2a", blast: "#8e5a2a", dike: "#5a7f30",
  // v15.2: the cut rice, khoai, bắp, ớt and their pests
  tie: "#8b5a33", vine: "#8e4a8a", tuber: "#b0486e", tuberDark: "#7e2f4e", yellowLeaf: "#d9c27a", tassel: "#d9c27a",
  silk: "#c9607a", husk: "#8fbf5a", tan: "#e0c56a", dry: "#b8902a", flower: "#f4f1ea", chiliGreen: "#6fbf4a",
  chiliRed: "#d8342a", chiliOld: "#8e1f1a", weevil: "#2f3a6e", waist: "#e0662f", worm: "#8a6a3f", frass: "#d9c9a0",
  thrips: "#c9a23a", ring: "#3a2a1a",
};

const mix = (a: string, b: string, t: number): string => {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
};

function paintSoil(c: Ctx, w: number, h: number, water: number, R: () => number): void {
  rect(c, water === 0 ? K.mudDry : water === 1 ? K.mud : K.mudWet, 0, 0, w, h);
  if (water === 1) {
    for (let i = 0; i < w * h * 0.04; i++) px(c, R() < 0.5 ? K.mudWet : K.crack, Math.floor(R() * w), Math.floor(R() * h));
  } else if (water === 0) {
    for (let i = 0; i < w * h * 0.02; i++) {
      const x = Math.floor(R() * w), y = Math.floor(R() * h);
      for (let k = 0; k < 4; k++) px(c, K.crack, x + k, y + (k % 2));
    }
  } else if (water >= 2) {
    // shallow: sheen lines; deep: the plot is water
    if (water === 3) rect(c, K.deep, 1, 1, w - 2, h - 2);
    for (let y = 3; y < h - 2; y += water === 3 ? 4 : 7) {
      for (let x = 2 + ((y * 5) % 9); x < w - 6; x += 11) rect(c, K.sheen, x, y, 4, 1);
    }
  }
}

/** A hill of rice standing at (x, y): 2·spread + 1 leaves fanning out, the middle one `hgt` px tall, all leaning by
 *  `lean` px at the top. */
function tuft(c: Ctx, x: number, y: number, hgt: number, spread: number, col: string, dark: string, lean: number): void {
  for (let s = -spread; s <= spread; s++) {
    const top = hgt - Math.abs(s);
    for (let k = 0; k < top; k++) {
      const dx = Math.round(s * 0.5 + ((lean + s * 0.9) * k) / Math.max(1, hgt));
      px(c, k < 2 || (s + k) % 4 === 0 ? dark : col, x + dx, y - k);
    }
  }
}

/** The transplanted hills in rows 8 px apart; returns where the panicles go ([x, y, kind]). Hills left of `cutX` are
 *  cut: stubble, with a tied sheaf on every third hill. */
function paintHills(c: Ctx, look: PlotLook, w: number, h: number, R: () => number): Array<[number, number, number]> {
  const heads: Array<[number, number, number]> = [];
  const { stage, progress } = look;
  const cutX = Math.round(look.cut * w);
  let hill = 0;
  for (let y = 7; y < h - 1; y += 8) {
    for (let x = 4; x < w - 3; x += 8) {
      const bx = x + (look.wobble ? Math.round((R() - 0.5) * 4) : 0);
      const by = y + (look.wobble ? Math.round((R() - 0.5) * 3) : 0);
      const lean = (R() - 0.5) * 2;
      if (x < cutX) {
        px(c, K.goldDark, bx - 1, by); px(c, K.goldDark, bx, by - 1); px(c, K.goldDark, bx + 1, by);
        if (hill++ % 3 === 0) {
          rect(c, K.gold, bx + 2, by - 4, 2, 4); px(c, K.goldLight, bx + 2, by - 5); px(c, K.goldDark, bx + 3, by - 1);
          px(c, K.tie, bx + 2, by - 2); px(c, K.tie, bx + 3, by - 2);
        }
        continue;
      }
      switch (stage) {
        case "transplanted": tuft(c, bx, by, 3 + Math.round(progress), 1, K.young, K.youngDark, 0); break;
        case "tillering": tuft(c, bx, by, 4 + Math.round(progress * 2), 1 + Math.round(progress), K.leaf, K.youngDark, lean); break;
        case "panicle": tuft(c, bx, by, 6 + Math.round(progress), 2, K.deepLeaf, K.leafDark, lean); break;
        case "heading":
          tuft(c, bx, by, 7, 2, K.deepLeaf, K.leafDark, lean);
          if (R() < 0.3 + progress * 0.6) heads.push([bx, by - 7, 0]);
          break;
        case "ripening":
          tuft(c, bx, by, 7, 2, mix(K.leaf, K.gold, progress), mix(K.leafDark, K.goldDark, progress), lean);
          heads.push([bx, by - 7, 1]);
          break;
        case "ripe":
          tuft(c, bx, by, 7, 2, K.gold, K.goldDark, 1);
          heads.push([bx + 1, by - 7, 2]);
          break;
        case "overripe":
          // lodged: the stems lie over
          tuft(c, bx, by, 5, 2, K.goldDark, K.crack, 4 + Math.round(progress * 2));
          heads.push([bx + 4, by - 4, 3]);
          break;
        default:
          break;
      }
    }
  }
  return heads;
}

/** The seedbed: a bright green corner patch that grows with age. */
function paintSeedbed(c: Ctx, look: PlotLook, w: number, h: number, R: () => number): void {
  const bw = Math.round(w * (0.25 + 0.2 * look.progress)), bh = Math.round(h * (0.3 + 0.2 * look.progress));
  rect(c, K.mudWet, 3, 3, bw, bh);
  for (let i = 0; i < bw * bh * (0.35 + 0.4 * look.progress); i++) {
    const x = 3 + Math.floor(R() * bw), y = 3 + Math.floor(R() * bh);
    px(c, R() < 0.5 ? K.seed1 : K.seed2, x, y);
    if (look.progress > 0.5 && R() < 0.4) px(c, K.seed2, x, y - 1);
  }
  rect(c, K.leafDark, 3, 3 + bh, bw, 1);
}

// --- raised beds (v15.2 §15): east–west ridges 8 px wide between 4 px furrows
const RIDGE = 8;
const PITCH = 12;

/** The ridges' top rows. */
function ridgeRows(h: number): number[] {
  const out: number[] = [];
  for (let y = 3; y + RIDGE <= h - 3; y += PITCH) out.push(y);
  return out;
}

/** Khô: light cracked soil; Ẩm: dark; Đẫm: water in the furrows; Ngập: water over all but the ridge tops. */
function paintBedSoil(c: Ctx, w: number, h: number, water: number, R: () => number): void {
  rect(c, water >= 2 ? K.deep : water === 1 ? K.mudWet : K.crack, 0, 0, w, h);
  for (const y of ridgeRows(h)) {
    const top = water === 0 ? K.mudDry : K.mud;
    if (water === 3) {
      rect(c, top, 2, y + 2, w - 4, RIDGE - 4);
    } else {
      rect(c, top, 1, y, w - 2, RIDGE);
      rect(c, water === 0 ? K.crack : K.mudWet, 1, y + RIDGE - 1, w - 2, 1);
    }
    for (let i = 0; i < w * 0.25; i++) {
      const x = 2 + Math.floor(R() * (w - 6)), yy = y + 2 + Math.floor(R() * (RIDGE - 4));
      if (water === 0) { px(c, K.crack, x, yy); px(c, K.crack, x + 1, yy + 1); } else px(c, K.mudWet, x, yy);
    }
  }
  if (water >= 2) {
    for (const y of ridgeRows(h)) {
      const fy = y + RIDGE + 1;
      for (let x = 3 + (y % 7); x < w - 6; x += 13) rect(c, K.sheen, x, fy, 3, 1);
    }
  }
}

/** The plants' base points: along each ridge, 8 px apart. */
function bedSpots(w: number, h: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const y of ridgeRows(h)) for (let x = 6; x < w - 5; x += 8) out.push([x, y + 5]);
  return out;
}

function paintKhoai(c: Ctx, l: PlotLook, x: number, y: number, R: () => number): void {
  const leaf = (lx: number, ly: number, col = R() < 0.5 ? K.young : K.youngDark) => { px(c, col, lx, ly); px(c, col, lx + 1, ly); };
  switch (l.stage) {
    case "g0":
      // a cutting with two leaves
      px(c, K.vine, x, y); px(c, K.vine, x, y - 1); leaf(x - 2, y - 2); leaf(x + 1, y - 3);
      break;
    case "g1": {
      // the vines creep along the ridge
      const len = 3 + Math.round(l.progress * 3);
      for (let k = 0; k < len; k++) px(c, K.vine, x + k - 1, y - (k % 2));
      for (let k = 0; k < len; k += 2) leaf(x + k - 1, y - 2);
      break;
    }
    case "g2":
    case "g3":
    case "ripe":
    case "overripe": {
      // a mat over the ridge: denser with age, yellowing when ripe, drooping when overripe
      const n = l.stage === "g2" ? 7 + Math.round(l.progress * 5) : 14;
      const col = l.stage === "ripe" ? mix(K.young, K.yellowLeaf, 0.5) : l.stage === "overripe" ? mix(K.youngDark, K.dry, 0.5) : K.young;
      for (let k = 0; k < n; k++) {
        const lx = x - 4 + Math.floor(R() * 8), ly = y - 4 + Math.floor(R() * 5);
        const yellow = (l.stage === "g3" && R() < 0.12) || (l.stage === "ripe" && R() < 0.35);
        px(c, yellow ? K.yellowLeaf : R() < 0.4 ? K.youngDark : col, lx, ly + (l.stage === "overripe" ? 1 : 0));
      }
      px(c, K.vine, x - 3, y); px(c, K.vine, x + 2, y - 1);
      if (l.stage === "ripe" || l.stage === "overripe") {
        // tubers peeking at the ridge's side; dark-spotted when overripe
        rect(c, K.tuber, x - 2, y + 2, 2, 1); px(c, K.tuberDark, x, y + 2);
        if (l.stage === "overripe") px(c, C.outline, x - 1, y + 2);
      }
      break;
    }
    default:
      break;
  }
}

function paintBap(c: Ctx, l: PlotLook, x: number, y: number, R: () => number): void {
  const stalk = (hgt: number, col: string, dark: string, lodged = false) => {
    for (let k = 0; k < hgt; k++) px(c, k % 3 === 0 ? dark : col, lodged ? x + k : x, lodged ? y - 1 : y - k);
  };
  const leaves = (at: number[], col: string, dark: string) => {
    for (const k of at) { px(c, col, x - 1, y - k); px(c, dark, x - 2, y - k + 1); px(c, col, x + 1, y - k - 1); px(c, dark, x + 2, y - k); }
  };
  switch (l.stage) {
    case "g0": px(c, K.young, x, y); px(c, K.young, x, y - 1); break;
    case "g1": stalk(3, K.young, K.leafDark); leaves([1, 2], K.young, K.leafDark); break;
    case "g2": stalk(6, K.young, K.leafDark); leaves([2, 4], K.young, K.leafDark); break;
    case "g3":
    case "g4":
      stalk(10, K.young, K.leafDark); leaves([2, 5, 7], K.young, K.leafDark);
      px(c, K.tassel, x, y - 10); px(c, K.tassel, x - 1, y - 11); px(c, K.tassel, x + 1, y - 11);
      if (l.stage === "g3") { px(c, K.silk, x + 1, y - 6); px(c, K.silk, x + 2, y - 5); }
      else { rect(c, K.husk, x + 1, y - 6, 2, 3); px(c, K.silk, x + 2, y - 7); }
      break;
    case "ripe":
      stalk(10, K.tan, K.dry); leaves([2, 5, 7], K.tan, K.dry); rect(c, K.tan, x + 1, y - 6, 2, 3); px(c, K.dry, x + 2, y - 7);
      break;
    case "overripe":
      if (R() < 0.35) { stalk(8, K.dry, K.crack, true); px(c, K.tan, x + 5, y - 2); }
      else { stalk(9, K.dry, K.crack); leaves([2, 5], K.dry, K.crack); rect(c, K.dry, x + 1, y - 5, 2, 3); }
      break;
    default:
      break;
  }
}

function paintOt(c: Ctx, l: PlotLook, x: number, y: number, R: () => number): void {
  const bush = (wd: number, hg: number) => {
    for (let k = 0; k < wd * hg; k++) {
      const bx = x - Math.floor(wd / 2) + (k % wd), by = y - Math.floor(k / wd);
      if ((k % wd === 0 || k % wd === wd - 1) && Math.floor(k / wd) === hg - 1) continue;
      px(c, (k + Math.floor(k / wd)) % 3 === 0 ? K.leafDark : K.leaf, bx, by);
    }
  };
  const fruit = (col: string, n: number) => {
    for (let k = 0; k < n; k++) { const fx = x - 2 + ((k * 3) % 5), fy = y - 1 - (k % 3); px(c, col, fx, fy); px(c, col, fx, fy + 1); }
  };
  switch (l.stage) {
    case "g0": bush(3, 2); break;
    case "g1": bush(5, 3 + Math.round(l.progress)); break;
    case "g2": bush(5, 4); px(c, K.flower, x - 1, y - 4); px(c, K.flower, x + 2, y - 2); px(c, K.flower, x - 2, y - 1); break;
    case "g3": bush(5, 4); fruit(K.chiliGreen, 3); break;
    case "ripe": {
      bush(5, 4);
      // thinner with each picking gone
      const n = Math.max(1, Math.round(4 * (1 - l.picked / Math.max(1, l.pickings))));
      fruit(K.chiliRed, n);
      break;
    }
    case "waiting": bush(5, 4); fruit(K.chiliGreen, 3); if (R() < 0.5) px(c, K.chiliRed, x + 1, y - 3); break;
    case "overripe": bush(5, 3); fruit(K.chiliOld, 2); px(c, K.chiliOld, x + 3, y + 2); px(c, K.chiliOld, x - 3, y + 2); break;
    default: break;
  }
}

/** A crop without its own drawing: green tufts that grow, turning gold when ripe. */
function paintGeneric(c: Ctx, l: PlotLook, x: number, y: number): void {
  const i = l.stage.startsWith("g") ? Number(l.stage.slice(1)) : 4;
  const col = l.stage === "ripe" || l.stage === "waiting" ? K.gold : l.stage === "overripe" ? K.dry : K.young;
  tuft(c, x, y, 2 + i, 1, col, K.leafDark, 0);
}

/** The ớt nursery: a patch in the beds' corner. */
function paintNursery(c: Ctx, look: PlotLook, R: () => number): void {
  const bw = 14 + Math.round(look.progress * 8), bh = 8;
  rect(c, K.mudWet, 3, 4, bw, bh);
  for (let i = 0; i < bw * bh * 0.5; i++) px(c, R() < 0.5 ? K.leaf : K.leafDark, 3 + Math.floor(R() * bw), 4 + Math.floor(R() * bh));
}

function paintBeds(c: Ctx, look: PlotLook, w: number, h: number, R: () => number): void {
  paintBedSoil(c, w, h, look.water, R);
  if (look.stage === "beds") return;
  if (look.stage === "nursery") {
    paintNursery(c, look, R);
    return;
  }
  const paint = look.crop === "khoai" ? paintKhoai : look.crop === "bap" ? paintBap : look.crop === "ot" ? paintOt : null;
  for (const [x, y] of bedSpots(w, h)) {
    if (paint) paint(c, look, x, y, R);
    else paintGeneric(c, look, x, y);
  }
}

function paintPests(c: Ctx, look: PlotLook, w: number, h: number, R: () => number): void {
  for (const pest of look.pests) {
    for (let i = 0; i < 9; i++) {
      const x = 4 + Math.floor(R() * (w - 10)), y = 6 + Math.floor(R() * (h - 12));
      switch (pest) {
        case "snail":
          // pink egg clusters on the stems, and now and then the snail
          rect(c, K.egg, x, y - 4, 2, 2); px(c, K.egg, x + 1, y - 5);
          if (i % 3 === 0) { rect(c, C.outline, x + 3, y, 4, 3); rect(c, K.shell, x + 4, y, 2, 2); px(c, "#e0b27a", x + 3, y + 2); }
          break;
        case "leaf_folder": px(c, K.roll, x, y - 3); px(c, K.roll, x, y - 4); px(c, "#d6cfc0", x + 1, y - 4); break;
        case "hopper": px(c, K.hopper, x, y); px(c, K.hopper, x + 2, y); px(c, K.hopper, x + 1, y - 1); break;
        case "leaf_blast": px(c, K.blast, x, y - 3); px(c, K.blast, x - 1, y - 2); px(c, K.blast, x + 1, y - 2); px(c, K.blast, x, y - 1); break;
        case "neck_blast": px(c, C.white, x, y - 6); px(c, C.white, x, y - 7); px(c, "#d6cfc0", x + 1, y - 7); break;
        // v15.2: tiny ants with an orange waist; caterpillars and their frass; silvery streaks; dark rings on the fruit
        case "weevil": px(c, K.weevil, x, y); px(c, K.waist, x + 1, y); px(c, K.weevil, x + 2, y); break;
        case "armyworm":
          rect(c, K.worm, x, y - 2, 3, 1); px(c, C.outline, x + 3, y - 2); px(c, K.frass, x - 1, y); px(c, K.frass, x + 2, y + 1);
          break;
        case "thrips": px(c, K.thrips, x, y - 3); px(c, K.thrips, x + 1, y - 3); px(c, K.thrips, x + 2, y - 4); break;
        case "anthracnose": px(c, K.ring, x, y - 2); px(c, K.ring, x + 2, y - 2); px(c, K.ring, x + 1, y - 3); px(c, K.ring, x + 1, y - 1); break;
      }
    }
  }
}

/** A plot of w × h px as it looks (browser only). */
export function paintPlot(look: PlotLook, w: number, h: number): HTMLCanvasElement {
  const cv = makeCanvas(w, h);
  const c = ctx2d(cv);
  const R = rng(look.seed);
  if (look.crop !== "rice") {
    paintBeds(c, look, w, h, R);
  } else {
    paintSoil(c, w, h, look.water, R);
    if (look.stage === "seedbed") paintSeedbed(c, look, w, h, R);
    const heads = paintHills(c, look, w, h, R);
    for (const [x, y, kind] of heads) {
      const col = kind === 0 ? K.panicle : kind === 1 ? mix(K.panicle, K.goldLight, look.progress) : kind === 2 ? K.goldLight : K.gold;
      px(c, col, x, y); px(c, col, x + 1, y + 1); px(c, col, x - 1, y + 1);
    }
  }
  paintPests(c, look, w, h, R);
  // the dike's inner edge
  rect(c, K.dike, 0, 0, w, 1); rect(c, K.dike, 0, h - 1, w, 1); rect(c, K.dike, 0, 0, 1, h); rect(c, K.dike, w - 1, 0, 1, h);
  return cv;
}

/** Glints on a flooded plot (level ≥ 2), blinking unless motion is reduced. Drawn every frame in view coordinates. */
export function drawPlotShimmer(b: Ctx, x: number, y: number, w: number, h: number, look: PlotLook, t: number, reduced: boolean): void {
  if (look.water < 2 || reduced) return;
  const R = rng(look.seed + 1);
  b.fillStyle = C.sparkle;
  for (let i = 0; i < 6 + look.water * 2; i++) {
    const sx = Math.floor(R() * (w - 4)) + 2, sy = Math.floor(R() * (h - 4)) + 2, phase = R() * Math.PI * 2;
    if (Math.sin(t / 420 + phase) > 0.7) b.fillRect(x + sx, y + sy, 2, 1);
  }
}

/** The farmer's urgent ring: a gold frame 2 px outside the plot, pulsing (steady when motion is reduced). */
export function drawUrgentRing(b: Ctx, x: number, y: number, w: number, h: number, t: number, reduced: boolean): void {
  b.globalAlpha = reduced ? 0.85 : 0.5 + 0.4 * Math.sin(t / 260);
  b.fillStyle = C.goldLight;
  b.fillRect(x - 3, y - 3, w + 6, 2);
  b.fillRect(x - 3, y + h + 1, w + 6, 2);
  b.fillRect(x - 3, y - 1, 2, h + 2);
  b.fillRect(x + w + 1, y - 1, 2, h + 2);
  b.globalAlpha = 1;
}

// --- the co-op's harvester (v15.2 §15): a 32 × 20 combine facing right, the reel in front
export const HARVESTER_W = 32;
export const HARVESTER_H = 20;
export const HARVESTER_ROWS: readonly string[] = [
  "................................",
  "...........oooooooo.............",
  "...........oggggGGo.............",
  "...........oggggGGo.............",
  "...........oggggggo.............",
  ".....ooooooobbbbbbooooooooo.....",
  ".....obbbbbbbbbbbbbbbbbbbbo.....",
  ".....obbbbbbbbbbbbbbbbbbbbo..oo.",
  ".....obbbbbbbbbbbbbbbbbbbbo.orro",
  ".....obbbbbbbbbbbbbbbbbbbboooRro",
  ".....oBBBBBBBBBBBBBBBBBBBBo.orRo",
  ".....oBBBBBBBBBBBBBBBBBBBBo.orro",
  ".....ooooooooooooooooooooooo.oo.",
  "....ottttttttttttttttttttttto...",
  "...otTttTttTttTttTttTttTttTtto..",
  "...ottttttttttttttttttttttttto..",
  "....ottttttttttttttttttttttto...",
  ".....ooooooooooooooooooooooo....",
  "................................",
  "................................",
];
export const HARVESTER_PAL: Record<string, string> = {
  o: C.outline, b: "#d9532b", B: "#a83a1c", g: "#9fc3cf", G: "#c9e3ea", t: "#2a2f3a", T: "#5a5f68", r: "#f6c945", R: "#c9a23a",
};

let harvesterSprite: HTMLCanvasElement | null = null;

/** The harvester's sprite, painted once (browser only). */
function harvesterCanvas(): HTMLCanvasElement {
  if (harvesterSprite) return harvesterSprite;
  const cv = makeCanvas(HARVESTER_W, HARVESTER_H);
  const c = ctx2d(cv);
  HARVESTER_ROWS.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== ".") px(c, HARVESTER_PAL[ch], x, y); }));
  harvesterSprite = cv;
  return cv;
}

/** Where the harvester stands on a plot at view (x, y, w, h) with `cut` of it cut: its reel on the cut line, crossing
 *  the plot's middle. */
export function harvesterSpot(x: number, y: number, w: number, h: number, cut: number): { x: number; y: number } {
  return { x: Math.round(x + cut * w - HARVESTER_W + 4), y: Math.round(y + h / 2 - HARVESTER_H / 2) };
}

/** The harvester at work, bobbing 1 px with straw puffs behind; static without puffs when motion is reduced. */
export function drawHarvester(b: Ctx, at: { x: number; y: number }, t: number, reduced: boolean): void {
  const bob = reduced ? 0 : Math.floor(t / 160) % 2;
  if (!reduced) {
    for (let k = 0; k < 4; k++) {
      const age = ((t / 90 + k * 7) % 28) / 28;
      b.fillStyle = k % 2 ? K.gold : K.goldLight;
      b.fillRect(Math.round(at.x + 4 - age * 10), Math.round(at.y + 7 - age * 6 + k), 2, 1);
    }
  }
  b.drawImage(harvesterCanvas(), at.x, at.y + bob);
}
