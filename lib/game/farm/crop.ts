import type { Variety } from "./catalog";
import type { CropView, ItemEntry, PestView, Phase, WaterEntry } from "./state";

// The crop model (spec §8) on the client: the same arithmetic, in the same order, as 0013 section D, so the plot
// panel's estimate agrees with the harvest (tests/fixtures/crop-cases.json pins both sides). Times are ms since the
// epoch. Pure.

export const HOUR_MS = 3_600_000;
/** Water is sampled every 15 minutes of crop time (§8.3). */
export const SAMPLE_MS = 15 * 60_000;
export const WATER_NAMES: readonly string[] = ["Khô", "Ẩm", "Nông", "Sâu"];

/** What the model reads of a crop. */
export interface CropModel {
  soakAt: number | null;
  sowAt: number | null;
  transplantAt: number | null;
  qTransplant: number;
  water: readonly WaterEntry[];
  fert: readonly ItemEntry[];
}

/** The model of a crop as field_state shows it (the logs are there for its farmer only). */
export function cropModel(c: CropView): CropModel {
  return {
    soakAt: c.soakAt, sowAt: c.sowAt, transplantAt: c.transplantAt, qTransplant: c.log?.qTransplant ?? 1,
    water: c.log?.water ?? [], fert: c.log?.fert ?? [],
  };
}

export function hrs(a: number, b: number): number {
  return (b - a) / HOUR_MS;
}

/** t plus h hours, cut to whole seconds (SQL _plus_h). */
export function plusH(t: number, h: number): number {
  return t + Math.floor(h * 3600) * 1000;
}

/** The last water entry at or before t (the later one wins a tie). */
function lastEntry(log: readonly WaterEntry[], t: number): WaterEntry | null {
  let best: WaterEntry | null = null;
  for (const e of log) if (e.t <= t && (best === null || e.t >= best.t)) best = e;
  return best;
}

/** The water level at t: the last level set, one level lower per full 12 h since, never below 0 (§8.3). */
export function waterAt(log: readonly WaterEntry[], t: number): number {
  const e = lastEntry(log, t);
  return e ? Math.max(0, e.l - Math.floor(hrs(e.t, t) / 12)) : 0;
}

/** When the water next drops a level on its own (null when it is dry). */
export function nextWaterDrop(log: readonly WaterEntry[], t: number): number | null {
  const e = lastEntry(log, t);
  if (!e || waterAt(log, t) === 0) return null;
  return e.t + (Math.floor(hrs(e.t, t) / 12) + 1) * 12 * HOUR_MS;
}

/** The phase at t (§8.2). */
export function cropPhase(c: CropModel, v: Variety | null, t: number): Phase {
  if (c.transplantAt === null || t < c.transplantAt) {
    if (c.sowAt !== null && t >= c.sowAt) return "seedling";
    if (c.soakAt !== null && t >= c.soakAt) return hrs(c.soakAt, t) < 2 ? "soaking" : "sprouted";
    return "prepared";
  }
  const s = v?.scale ?? 1;
  const h = hrs(c.transplantAt, t);
  if (h < 18 * s) return "tillering";
  if (h < 30 * s) return "panicle";
  if (h < 40 * s) return "heading";
  if (h < 48 * s) return "ripening";
  if (h < 48 * s + 12) return "ripe";
  return "overripe";
}

/** The levels the phase wants at t (§8.3): the panel's label and a short name for the task list; null before sowing. */
export function wantedWater(c: CropModel, v: Variety | null, t: number): { levels: readonly number[]; label: string; short: string } | null {
  switch (cropPhase(c, v, t)) {
    case "seedling": return { levels: [1], label: "Ẩm", short: "Ẩm" };
    case "tillering":
      return c.transplantAt !== null && hrs(c.transplantAt, t) < 14 * (v?.scale ?? 1)
        ? { levels: [2], label: "Nông", short: "Nông" }
        : { levels: [0, 1, 2], label: "Phơi ruộng (rút cạn tốt hơn)", short: "Khô–Nông" };
    case "panicle":
    case "heading": return { levels: [2, 3], label: "Nông–Sâu (tốt nhất Sâu)", short: "Nông–Sâu" };
    case "ripening":
    case "ripe":
    case "overripe": return { levels: [0, 1], label: "Rút nước", short: "Khô–Ẩm" };
    default: return null;
  }
}

/** Does the water at t suit the phase? Phases before sowing accept anything. */
export function waterOk(c: CropModel, v: Variety | null, t: number): boolean {
  const w = wantedWater(c, v, t);
  return w === null || w.levels.includes(waterAt(c.water, t));
}

/** Off-target water hours from sowing until `until`: one sample every 15 minutes, 0.25 h per wrong sample. */
export function waterOffHours(c: CropModel, v: Variety | null, until: number): number {
  if (c.sowAt === null || until <= c.sowAt) return 0;
  let wrong = 0;
  for (let t = c.sowAt; t < until; t += SAMPLE_MS) if (!waterOk(c, v, t)) wrong++;
  return wrong * 0.25;
}

const isN = (item: string) => item === "fert_urea" || item === "fert_npk";

/** Excess nitrogen by t (§8.4): urea in panicle, a second N inside tillering or inside panicle, or any N from heading on. */
export function excessN(c: CropModel, v: Variety | null, t: number): boolean {
  let till = 0, pan = 0;
  for (const e of c.fert) {
    if (e.t > t || !isN(e.item)) continue;
    const ph = cropPhase(c, v, e.t);
    if (ph === "tillering") till++;
    else if (ph === "panicle") {
      if (e.item === "fert_urea") return true;
      pan++;
    } else if (ph === "heading" || ph === "ripening" || ph === "ripe" || ph === "overripe") return true;
  }
  return till >= 2 || pan >= 2;
}

/** Fertilizer and drainage scores (§8.4, §8.6). td1/td2: 0 on time, 0.1 half, 0.2 missing. */
export interface Care { manure: boolean; phosphate: boolean; td1: number; td2: number; phoi: boolean; excess: boolean }

export function cropCare(c: CropModel, v: Variety | null): Care {
  const s = v?.scale ?? 1;
  let manure = false, phosphate = false, td1 = 0.2, td2 = 0.2;
  for (const e of c.fert) {
    if (c.transplantAt === null || e.t < c.transplantAt) {
      if (e.item === "fert_manure") manure = true;
      if (e.item === "fert_phosphate") phosphate = true;
      continue;
    }
    const ph = cropPhase(c, v, e.t);
    const h = hrs(c.transplantAt, e.t);
    if (ph === "tillering") {
      if (isN(e.item) && h >= 2 * s && h <= 10 * s) td1 = 0;
      else if (isN(e.item) || e.item === "fert_potash") td1 = Math.min(td1, 0.1);
    } else if (ph === "panicle") {
      if ((e.item === "fert_potash" || e.item === "fert_npk") && h >= 18 * s && h <= 24 * s) td2 = 0;
      else if (e.item === "fert_potash" || isN(e.item)) td2 = Math.min(td2, 0.1);
    }
  }
  const phoi = c.transplantAt !== null && waterAt(c.water, plusH(c.transplantAt, 18 * s)) <= 1;
  return { manure, phosphate, td1, td2, phoi, excess: excessN(c, v, Infinity) };
}

/** 1 − the care penalties, summed in the SQL's order. */
export function mcareOf(care: Care): number {
  let pen = 0;
  if (!care.manure) pen += 0.05;
  if (!care.phosphate) pen += 0.05;
  pen += care.td1;
  pen += care.td2;
  if (!care.phoi) pen += 0.05;
  if (care.excess) pen += 0.1;
  return 1 - pen;
}

/** A pest's damaging hours until it was treated or `until` (§8.5). Snails only count samples with water ≥ 2. */
export function pestHours(c: CropModel, p: PestView, until: number): number {
  const end = p.treatedAt ?? until;
  if (end <= p.since) return 0;
  if (p.kind !== "snail") return hrs(p.since, end);
  let wet = 0;
  for (let t = p.since; t < end; t += SAMPLE_MS) if (waterAt(c.water, t) >= 2) wet++;
  return wet * 0.25;
}

export interface YieldFactors { kg: number; mcare: number; mseed: number; mwater: number; mpest: number; mlate: number }

/** Rice part i (1..6) of a plot yielding y kg (v15.2 R5): floor(i·y/6) − floor((i − 1)·y/6), so the six parts of a
 *  constant y sum to y, and after n parts the harvester's y − floor(n·y/6) is exactly the rest. */
export function partKg(i: number, y: number): number {
  return Math.floor((i * y) / 6) - Math.floor(((i - 1) * y) / 6);
}

function factors(
  v: Variety, land: number, qT: number, qH: number, care: Care, lateSow: number, oldSeedlings: number, offHours: number,
  pestH: readonly number[], lateHarvest: number,
): YieldFactors {
  const mcare = mcareOf(care);
  const mseed = 1 - Math.min(0.3, 0.03 * Math.max(0, lateSow)) - Math.min(0.3, 0.03 * Math.max(0, oldSeedlings));
  const mwater = 1 - Math.min(0.2, 0.01 * offHours);
  let mpest = 1;
  for (const h of pestH) mpest = mpest * (1 - Math.min(0.3, 0.015 * h));
  const mlate = 1 - Math.min(0.6, 0.02 * Math.max(0, lateHarvest));
  const x = v.baseKg * land * mcare * mseed * mwater * mpest * mlate * qT * qH;
  return { kg: Math.max(Math.ceil(v.baseKg / 10), Math.floor(x + 0.5)), mcare, mseed, mwater, mpest, mlate };
}

/** The harvest at `now` (§8.6) — what the server pays out. `pests` are the revealed ones, in slot order. */
export function cropYield(c: CropModel, v: Variety, land: number, qH: number, pests: readonly PestView[], now: number): YieldFactors {
  const s = v.scale;
  const sow = c.sowAt ?? now, transplant = c.transplantAt ?? now;
  return factors(
    v, land, c.qTransplant, qH, cropCare(c, v), hrs(c.soakAt ?? sow, sow) - 8, hrs(sow, transplant) - 14 * s,
    waterOffHours(c, v, now), pests.map((p) => pestHours(c, p, now)), hrs(transplant, now) - (48 * s + 12),
  );
}

/** The plot panel's estimate ("ước tính"): the harvest if everything still open is done on time — the base
 *  fertilizers before transplanting, the top-dresses until their windows close, phơi ruộng until T = 18·s — with
 *  the care, water, pests and delays so far. Hidden pests cannot be counted. */
export function yieldEstimate(c: CropModel, v: Variety, land: number, pests: readonly PestView[], now: number): YieldFactors {
  const s = v.scale;
  const care = cropCare(c, v);
  const T = c.transplantAt === null ? null : hrs(c.transplantAt, now);
  const hopeful: Care = {
    manure: care.manure || T === null,
    phosphate: care.phosphate || T === null,
    td1: T === null || T <= 10 * s ? 0 : care.td1,
    td2: T === null || T <= 24 * s ? 0 : care.td2,
    phoi: T === null || T < 18 * s ? true : care.phoi,
    excess: care.excess,
  };
  const lateSow = c.soakAt === null ? 0 : hrs(c.soakAt, c.sowAt ?? now) - 8;
  const old = c.sowAt === null ? 0 : hrs(c.sowAt, c.transplantAt ?? now) - 14 * s;
  const lateHarvest = c.transplantAt === null ? 0 : hrs(c.transplantAt, now) - (48 * s + 12);
  return factors(v, land, c.qTransplant, 1, hopeful, lateSow, old, waterOffHours(c, v, now),
    pests.map((p) => pestHours(c, p, now)), lateHarvest);
}

// The crop's timetable (§8.2).
/** Sprouted: soak + 2 h. */
export const sproutAt = (c: CropModel): number | null => (c.soakAt === null ? null : c.soakAt + 2 * HOUR_MS);
/** Sowing is late (−3 %/h) after soak + 8 h. */
export const sowLateAt = (c: CropModel): number | null => (c.soakAt === null ? null : c.soakAt + 8 * HOUR_MS);
/** Unsown seed rots at soak + 26 h. */
export const rotAt = (c: CropModel): number | null => (c.soakAt === null ? null : c.soakAt + 26 * HOUR_MS);
/** Seedlings may be transplanted from sow + 8·s h … */
export const transplantReadyAt = (c: CropModel, v: Variety): number | null => (c.sowAt === null ? null : c.sowAt + 8 * v.scale * HOUR_MS);
/** … and are old (−3 %/h) after sow + 14·s h. */
export const seedlingsOldAt = (c: CropModel, v: Variety): number | null => (c.sowAt === null ? null : c.sowAt + 14 * v.scale * HOUR_MS);
/** Ripe at transplant + 48·s h. */
export const ripeAt = (c: CropModel, v: Variety): number | null => (c.transplantAt === null ? null : c.transplantAt + 48 * v.scale * HOUR_MS);
/** Overripe (−2 %/h) 12 h after ripe. */
export const overripeAt = (c: CropModel, v: Variety): number | null =>
  c.transplantAt === null ? null : c.transplantAt + (48 * v.scale + 12) * HOUR_MS;
/** Lost 48 h after the ripe window (the sweep's rule). */
export const lostAt = (c: CropModel, v: Variety): number | null => (c.transplantAt === null ? null : plusH(c.transplantAt, 48 * v.scale + 60));

/** When the crop enters its next phase, or null when it waits for the farmer (sowing, transplanting) or nothing is next. */
export function nextPhaseAt(c: CropModel, v: Variety | null, now: number): number | null {
  const ph = cropPhase(c, v, now);
  if (ph === "soaking") return sproutAt(c);
  if (c.transplantAt === null || !v) return null;
  const s = v.scale, at = (h: number) => c.transplantAt! + h * HOUR_MS;
  switch (ph) {
    case "tillering": return at(18 * s);
    case "panicle": return at(30 * s);
    case "heading": return at(40 * s);
    case "ripening": return at(48 * s);
    case "ripe": return at(48 * s + 12);
    case "overripe": return lostAt(c, v);
    default: return null;
  }
}
