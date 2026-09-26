import { uplandHours, type UplandCrop, type UplandStage } from "./catalog";
import { hrs, plusH, SAMPLE_MS, waterAt } from "./crop";
import { ratFactor, ratHours, type RatLogEntry } from "./rats";
import type { CropView, HarvestEntry, ItemEntry, PestKind, PestView, WaterEntry, WorkEntry } from "./state";

// The hoa-màu model (v15.2 §8) on the client: the same arithmetic, in the same order, as 0016 section C, so the plot
// panel agrees with the server (tests/fixtures/upland-cases.json pins both sides, R33). Times are ms since the epoch;
// hours count from P, the planting (or the transplant of a nursery crop). Pure.

/** What the model reads of a crop on beds. */
export interface UplandModel {
  sowAt: number | null;
  plantAt: number | null;
  water: readonly WaterEntry[];
  fert: readonly ItemEntry[];
  work: readonly WorkEntry[];
  spray: readonly ItemEntry[];
  harvests: readonly HarvestEntry[];
  /** v17: the rats that ate it (the field's rats.plots); none before 0019. */
  rats?: readonly RatLogEntry[];
}

/** A pest slot's hidden roll (the server keeps them; the fixtures replay them). */
export interface UplandRoll { slot: number; uTime: number; uHit: number }

/** The model of a crop on beds as field_state shows it (the logs are there for its farmer only), with its plot's rat
 *  log. */
export function uplandModel(c: CropView, rats: readonly RatLogEntry[] = []): UplandModel {
  return {
    sowAt: c.sowAt, plantAt: c.plantAt, water: c.log?.water ?? [], fert: c.log?.fert ?? [], work: c.log?.work ?? [],
    spray: c.log?.spray ?? [], harvests: c.log?.harvests ?? [], rats,
  };
}

/** R_k: picking k is ready. */
export function upReadyAt(c: UplandModel, u: UplandCrop, k: number): number | null {
  return c.plantAt === null ? null : plusH(c.plantAt, uplandHours(u, k));
}

/** O_k: picking k is overripe (−over_rate per hour) from here. */
export function upOverAt(c: UplandModel, u: UplandCrop, k: number): number | null {
  return c.plantAt === null ? null : plusH(c.plantAt, uplandHours(u, k) + u.ripeWindowH);
}

/** L_k: picking k is lost here. */
export function upLostAt(c: UplandModel, u: UplandCrop, k: number): number | null {
  return c.plantAt === null ? null : plusH(c.plantAt, uplandHours(u, k) + u.ripeWindowH + u.lostAfterH);
}

/** The next picking at t: the lowest one not picked and not lost yet; 0 when none is left, or before P (`_up_next`). */
export function upNext(c: UplandModel, u: UplandCrop, t: number): number {
  if (c.plantAt === null) return 0;
  for (let k = 1; k <= u.pickings.length; k++) {
    if (c.harvests.some((h) => h.k === k)) continue;
    if (t < plusH(c.plantAt, uplandHours(u, k) + u.ripeWindowH + u.lostAfterH)) return k;
  }
  return 0;
}

/** The phase at t (§8.3): prepared, nursery, a stage id, then waiting / ripe / overripe for the next picking, and done. */
export function upPhase(c: UplandModel, u: UplandCrop, t: number): string {
  const start = c.sowAt ?? c.plantAt;
  if (start === null || t < start) return "prepared";
  if (c.plantAt === null || t < c.plantAt) return "nursery";
  const h = hrs(c.plantAt, t);
  for (const st of u.stages) if (h < st.untilH) return st.id;
  const k = upNext(c, u, t);
  if (k === 0) return "done";
  if (t < plusH(c.plantAt, uplandHours(u, k))) return "waiting";
  if (t < plusH(c.plantAt, uplandHours(u, k) + u.ripeWindowH)) return "ripe";
  return "overripe";
}

/** The growth stage at t, or null before P and from ripe_h on. */
export function upStage(c: UplandModel, u: UplandCrop, t: number): UplandStage | null {
  if (c.plantAt === null || t < c.plantAt) return null;
  const h = hrs(c.plantAt, t);
  return u.stages.find((st) => h < st.untilH) ?? null;
}

/** The levels the beds should hold at t: {1} in the nursery, the stage's, ripe_water from ripe_h on; null before the
 *  first planting action (anything goes). */
export function upWantedWater(c: UplandModel, u: UplandCrop, t: number): readonly number[] | null {
  const start = c.sowAt ?? c.plantAt;
  if (start === null || t < start) return null;
  if (c.plantAt === null || t < c.plantAt) return [1];
  return upStage(c, u, t)?.water ?? u.ripeWater;
}

/** Does the water at t suit the crop (`_up_water_ok`)? */
export function upWaterOk(c: UplandModel, u: UplandCrop, t: number): boolean {
  const want = upWantedWater(c, u, t);
  return want === null || want.includes(waterAt(c.water, t));
}

/** Off-target water hours from the first planting action until `until`: one sample every 15 minutes, 0.25 h each. */
export function upOffHours(c: UplandModel, u: UplandCrop, until: number): number {
  const start = c.sowAt ?? c.plantAt;
  if (start === null || until <= start) return 0;
  let wrong = 0;
  for (let t = start; t < until; t += SAMPLE_MS) if (!upWaterOk(c, u, t)) wrong++;
  return wrong * 0.25;
}

/** Rot hours (§8.4): samples from P + rot_from_h until `until` with the beds at Đẫm or Ngập. */
export function upRotHours(c: UplandModel, u: UplandCrop, until: number): number {
  if (u.rotFromH === null || c.plantAt === null) return 0;
  const from = plusH(c.plantAt, u.rotFromH);
  if (until <= from) return 0;
  let wet = 0;
  for (let t = from; t < until; t += SAMPLE_MS) if (waterAt(c.water, t) >= 2) wet++;
  return wet * 0.25;
}

const isN = (item: string) => item === "fert_urea" || item === "fert_npk";

/** Excess nitrogen by t (§8.5, R23): walking the fertilizer log from P in time order, an N bag where no fertilizer care's
 *  half region [half_from_h, half_to_h) takes it, or a second N inside one care's half region. */
export function upExcessN(c: UplandModel, u: UplandCrop, t: number): boolean {
  const p = c.plantAt;
  if (p === null) return false;
  const seen: string[] = [];
  const log = c.fert.map((e, n) => ({ e, n })).filter(({ e }) => e.t >= p && e.t <= t).sort((a, b) => a.e.t - b.e.t || a.n - b.n);
  for (const { e } of log) {
    if (!isN(e.item)) continue;
    const h = hrs(p, e.t);
    const hit = u.cares.find((cr) => cr.kind === "fert" && h >= cr.halfFromH && h < cr.halfToH
      && (cr.items.includes(e.item) || cr.halfItems.includes(e.item)));
    if (!hit || seen.includes(hit.id)) return true;
    seen.push(hit.id);
  }
  return false;
}

/** The care scores (§8.5): the base fertilizers before P, then each care row in config order — 0 on time, pen_half in
 *  its half region, else pen_missing; only the best entry counts. */
export interface UplandCareScore { manure: boolean; phosphate: boolean; scores: number[]; excess: boolean }

export function upCare(c: UplandModel, u: UplandCrop): UplandCareScore {
  let manure = false, phosphate = false;
  for (const e of c.fert) {
    if (c.plantAt === null || e.t < c.plantAt) {
      if (e.item === "fert_manure") manure = true;
      if (e.item === "fert_phosphate") phosphate = true;
    }
  }
  const p = c.plantAt;
  const scores = u.cares.map((cr) => {
    let best = cr.penMissing;
    if (p === null) return best;
    if (cr.kind === "fert") {
      for (const e of c.fert) {
        const h = hrs(p, e.t);
        if (cr.items.includes(e.item) && h >= cr.fromH && h <= cr.toH) best = Math.min(best, 0);
        else if ((cr.items.includes(e.item) || cr.halfItems.includes(e.item)) && h >= cr.halfFromH && h < cr.halfToH) {
          best = Math.min(best, cr.penHalf);
        }
      }
    } else {
      for (const e of c.work) {
        if (e.act !== cr.id) continue;
        const h = hrs(p, e.t);
        if (h >= cr.fromH && h <= cr.toH) best = Math.min(best, 0);
        else if (h >= cr.halfFromH && h < cr.halfToH) best = Math.min(best, cr.penHalf);
      }
    }
    return best;
  });
  return { manure, phosphate, scores, excess: upExcessN(c, u, Infinity) };
}

/** The pests revealed by `now` from the hidden rolls (§8.6), as `_up_pests` works them out: a slot is due at
 *  P + from_h + u_time·(to_h − from_h); its chance is ×1.5 with excess N by then, × dry_mult on a Khô bed, × wet_mult at
 *  Đẫm or more, capped at 0.9; the first spray of its remedy at or after due treats it. */
export function upPests(c: UplandModel, u: UplandCrop, rolls: readonly UplandRoll[], now: number): PestView[] {
  const p = c.plantAt;
  if (p === null) return [];
  const out: PestView[] = [];
  for (const r of [...rolls].sort((a, b) => a.slot - b.slot)) {
    const pe = u.pests.find((x) => x.slot === r.slot);
    if (!pe) continue;
    const due = plusH(p, pe.fromH + r.uTime * (pe.toH - pe.fromH));
    if (due > now) continue;
    let chance = pe.chance;
    if (upExcessN(c, u, due)) chance = chance * 1.5;
    const lvl = waterAt(c.water, due);
    if (lvl === 0) chance = chance * pe.dryMult;
    if (lvl >= 2) chance = chance * pe.wetMult;
    chance = Math.min(0.9, chance);
    if (r.uHit >= chance) continue;
    let treatedAt: number | null = null;
    for (const s of c.spray) if (s.item === pe.remedy && s.t >= due && s.t <= now && (treatedAt === null || s.t < treatedAt)) treatedAt = s.t;
    out.push({ kind: pe.kind as PestKind, since: due, treatedAt });
  }
  return out;
}

export interface UplandYield { kg: number; mcare: number; mplant: number; mwater: number; mrot: number; mpest: number; mlate: number; mrat: number }

/** 1 − the care penalties, summed in the SQL's order. */
export function upMcare(care: UplandCareScore): number {
  let pen = 0;
  if (!care.manure) pen += 0.05;
  if (!care.phosphate) pen += 0.05;
  for (const s of care.scores) pen += s;
  if (care.excess) pen += 0.1;
  return 1 - pen;
}

/** Old seedlings (R30): −3 % per hour past nursery_old_h at the transplant, at most 30 %. */
function mplantOf(u: UplandCrop, sowAt: number | null, plantAt: number | null): number {
  if (u.method !== "nursery" || u.nurseryOldH === null || sowAt === null || plantAt === null) return 1;
  return 1 - Math.min(0.3, 0.03 * Math.max(0, hrs(sowAt, plantAt) - u.nurseryOldH));
}

function yieldOf(u: UplandCrop, land: number, k: number, mcare: number, mplant: number, offHours: number, rotHours: number,
  pests: readonly PestView[], late: number, ratH: number, now: number): UplandYield {
  const mwater = 1 - Math.min(0.2, 0.01 * offHours);
  const mrot = u.rotFromH === null ? 1 : 1 - Math.min(u.rotCap ?? 1, (u.rotRate ?? 0) * rotHours);
  let mpest = 1;
  for (const pe of pests) {
    const end = pe.treatedAt ?? now;
    mpest = mpest * (1 - Math.min(0.3, 0.015 * (end <= pe.since ? 0 : hrs(pe.since, end))));
  }
  const mlate = 1 - Math.min(0.6, u.overRate * Math.max(0, late));
  const mrat = ratFactor(ratH);
  const pct = u.pickings[k - 1] ?? 0;
  const x = (((((((((u.baseKg * land) * mcare) * mplant) * mwater) * mrot) * mpest) * mlate) * mrat) * pct) / 100;
  return { kg: Math.max(Math.ceil((u.baseKg * pct) / 1000), Math.floor(x + 0.5)), mcare, mplant, mwater, mrot, mpest, mlate, mrat };
}

/** Picking k at `now` (§8.7) — what the server pays out. `pests` are the revealed ones, in slot order; the rats'
 *  share (v17 Mrat) comes right after Mlate. */
export function upYield(c: UplandModel, u: UplandCrop, land: number, k: number, pests: readonly PestView[], now: number): UplandYield {
  const over = upOverAt(c, u, k);
  return yieldOf(u, land, k, upMcare(upCare(c, u)), mplantOf(u, c.sowAt, c.plantAt), upOffHours(c, u, now), upRotHours(c, u, now),
    pests, over === null ? 0 : hrs(over, now), ratHours(c.rats ?? [], now), now);
}

/** The plot panel's estimate for picking k (§13.1): as if everything still open is done on time — the base fertilizers
 *  until P, each care until its on-time window closes, the ớt transplant now — with the water, rot, pests and delays so
 *  far. Hidden pests and future rats cannot be counted. */
export function upEstimate(c: UplandModel, u: UplandCrop, land: number, k: number, pests: readonly PestView[], now: number): UplandYield {
  const care = upCare(c, u);
  const T = c.plantAt === null ? null : hrs(c.plantAt, now);
  const hopeful: UplandCareScore = {
    manure: care.manure || T === null,
    phosphate: care.phosphate || T === null,
    scores: care.scores.map((s, i) => (T === null || T <= u.cares[i].toH ? 0 : s)),
    excess: care.excess,
  };
  const over = upOverAt(c, u, k);
  return yieldOf(u, land, k, upMcare(hopeful), mplantOf(u, c.sowAt, c.plantAt ?? now), upOffHours(c, u, now), upRotHours(c, u, now),
    pests, over === null ? 0 : hrs(over, now), ratHours(c.rats ?? [], now), now);
}

/** The whole season's estimate: the kg picked so far plus each picking still to come, estimated as above. */
export function upSeasonEstimate(c: UplandModel, u: UplandCrop, land: number, pests: readonly PestView[], now: number): number {
  let kg = c.harvests.reduce((a, h) => a + h.kg, 0);
  const next = c.plantAt === null ? 1 : upNext(c, u, now);
  if (next === 0) return kg;
  for (let k = next; k <= u.pickings.length; k++) kg += upEstimate(c, u, land, k, pests, now).kg;
  return kg;
}

/** When the crop enters its next phase, or null when it waits for the farmer (planting, the transplant) or nothing is
 *  next. */
export function upNextPhaseAt(c: UplandModel, u: UplandCrop, now: number): number | null {
  if (c.plantAt === null || now < c.plantAt) return null;
  const h = hrs(c.plantAt, now);
  const st = u.stages.find((s) => h < s.untilH);
  if (st) return plusH(c.plantAt, st.untilH);
  const k = upNext(c, u, now);
  if (k === 0) return null;
  const ready = upReadyAt(c, u, k)!, over = upOverAt(c, u, k)!;
  return now < ready ? ready : now < over ? over : upLostAt(c, u, k);
}

/** The ớt nursery: its seedlings may go out from sow + nursery_ready_h, and are old (−3 %/h) from sow + nursery_old_h. */
export const nurseryReadyAt = (c: UplandModel, u: UplandCrop): number | null =>
  c.sowAt === null || u.nurseryReadyH === null ? null : plusH(c.sowAt, u.nurseryReadyH);
export const nurseryOldAt = (c: UplandModel, u: UplandCrop): number | null =>
  c.sowAt === null || u.nurseryOldH === null ? null : plusH(c.sowAt, u.nurseryOldH);

/** Rot starts here (khoai: P + 22 h), or null for a crop that does not rot. */
export const rotFromAt = (c: UplandModel, u: UplandCrop): number | null =>
  c.plantAt === null || u.rotFromH === null ? null : plusH(c.plantAt, u.rotFromH);
