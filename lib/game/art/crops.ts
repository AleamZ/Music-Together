import type { Variety } from "@/lib/game/farm/catalog";
import { cropModel, cropPhase, hrs, waterAt } from "@/lib/game/farm/crop";
import type { CropView, PestKind, PlotView } from "@/lib/game/farm/state";
import { C, ctx2d, makeCanvas, px, rect, rng, type Ctx } from "@/lib/game/maps/scene-art";

// The rice on a plot (spec §13.4, §14): what to draw (pure) and its procedural painter (browser only: canvas) —
// the crop stage, the water by level and the pest overlays. Original art.

export type CropStage = "prepared" | "seedbed" | "transplanted" | "tillering" | "panicle" | "heading" | "ripening" | "ripe" | "overripe";

export interface PlotLook {
  stage: CropStage;
  /** How far through the stage, 0–1. */
  progress: number;
  /** 0 khô … 3 sâu. */
  water: number;
  /** The untreated pests. */
  pests: PestKind[];
  /** Crooked rows (a poor transplant, qT < 1). */
  wobble: boolean;
  seed: number;
}

/** What the engine draws on a plot: its look (null = the background's bare stubble), the name post's label and the
 *  farmer's urgent ring. */
export interface PlotDraw { no: number; look: PlotLook | null; label: string; urgent: boolean }

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** The look of a plot's crop at `now`; null while the plot is unprepared (no crop, or seed soaking before preparing). */
export function plotLook(no: number, crop: CropView | null, v: Variety | null, now: number): PlotLook | null {
  if (!crop || crop.preparedAt === null) return null;
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
    stage, progress: clamp01(progress),
    // the farmer has the log (exact at any time); the others get the level at the last fetch
    water: crop.log ? waterAt(crop.log.water, now) : crop.water,
    pests: crop.pests.filter((p) => p.treatedAt === null).map((p) => p.kind),
    wobble: (crop.log?.qTransplant ?? 1) < 1, seed: no * 7919,
  };
}

/** The cache key of a look: progress in fifths is enough to see the rice grow. */
export function lookKey(l: PlotLook): string {
  return `${l.stage}|${Math.floor(l.progress * 5)}|${l.water}|${l.pests.join(",")}|${l.wobble ? 1 : 0}`;
}

/** The name post: the plot number and its owner (private) or farmer (village), else what it is. */
export function plotLabel(p: PlotView): string {
  const who = p.kind === "private" ? p.owner : p.farmer;
  return `${p.no} · ${who ? who.name : p.kind === "private" ? "đất bán" : "đất trống"}`;
}

/** Everything the engine draws on the plots at `now`; `urgent` = the plots with an urgent task of mine. */
export function plotDraws(plots: readonly PlotView[], varieties: readonly Variety[], urgent: ReadonlySet<number>, now: number): PlotDraw[] {
  return plots.map((p) => ({
    no: p.no,
    look: plotLook(p.no, p.crop, varieties.find((v) => v.id === p.crop?.variety) ?? null, now),
    label: plotLabel(p),
    urgent: urgent.has(p.no),
  }));
}

const K = {
  mudWet: "#6e5230", mud: "#8a6a3f", mudDry: "#a8875a", crack: "#7a5c38", sheen: "#9fc3cf", deep: "#5d93ad",
  seed1: "#8fdc62", seed2: "#6fbf4a", young: "#6fbf4a", youngDark: "#4f9a38", leaf: "#5caa4a", leafDark: "#3f7f2e",
  deepLeaf: "#3d8a3a", panicle: "#c9d88a", gold: "#e0b33c", goldLight: "#f6c945", goldDark: "#b8902a",
  egg: "#f29bb5", shell: "#8a5a2b", roll: "#f4f1ea", hopper: "#7a4a2a", blast: "#8e5a2a", dike: "#5a7f30",
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

/** The transplanted hills in rows 8 px apart; returns where the panicles go ([x, y, kind]). */
function paintHills(c: Ctx, look: PlotLook, w: number, h: number, R: () => number): Array<[number, number, number]> {
  const heads: Array<[number, number, number]> = [];
  const { stage, progress } = look;
  for (let y = 7; y < h - 1; y += 8) {
    for (let x = 4; x < w - 3; x += 8) {
      const bx = x + (look.wobble ? Math.round((R() - 0.5) * 4) : 0);
      const by = y + (look.wobble ? Math.round((R() - 0.5) * 3) : 0);
      const lean = (R() - 0.5) * 2;
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
      }
    }
  }
}

/** A plot of w × h px as it looks (browser only). */
export function paintPlot(look: PlotLook, w: number, h: number): HTMLCanvasElement {
  const cv = makeCanvas(w, h);
  const c = ctx2d(cv);
  const R = rng(look.seed);
  paintSoil(c, w, h, look.water, R);
  if (look.stage === "seedbed") paintSeedbed(c, look, w, h, R);
  const heads = paintHills(c, look, w, h, R);
  for (const [x, y, kind] of heads) {
    const col = kind === 0 ? K.panicle : kind === 1 ? mix(K.panicle, K.goldLight, look.progress) : kind === 2 ? K.goldLight : K.gold;
    px(c, col, x, y); px(c, col, x + 1, y + 1); px(c, col, x - 1, y + 1);
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
