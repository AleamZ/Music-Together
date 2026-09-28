import type { FarmCatalog } from "./catalog";
import { cropModel, waterAt, wantedWater } from "./crop";
import type { FieldState } from "./state";
import { upWantedWater, uplandModel } from "./upland";

// v21 (0076) Máy tưới: what each of my plots wants and where the sprinkler would set it. Pure; the server only checks
// the level is 0–3 and the watering caps (the level asked is a choice a player could make by hand anyway).

export interface WaterPlan {
  plot: number;
  kind: "rice" | "upland";
  /** The level now (0 Khô … 3 Sâu / Ngập). */
  level: number;
  /** The accepted levels now, or null when the crop wants nothing in particular. */
  want: readonly number[] | null;
  /** The level the sprinkler sets (the accepted level nearest the current one), or null when it is fine as it is. */
  target: number | null;
}

/** The nearest level of `want` to `level` (ties go down: less water is the safer mistake). */
export function nearestLevel(level: number, want: readonly number[]): number {
  return [...want].sort((a, b) => Math.abs(a - level) - Math.abs(b - level) || a - b)[0] ?? level;
}

/** My prepared, uncut plots with their water plan, by plot number. */
export function waterPlans(state: FieldState, catalog: FarmCatalog, me: string, now: number): WaterPlan[] {
  const out: WaterPlan[] = [];
  for (const p of state.plots) {
    const crop = p.crop;
    if (!crop || p.farmer?.id !== me || crop.preparedAt === null || crop.parts > 0 || crop.harvester) continue;
    let level: number, want: readonly number[] | null;
    if (crop.kind === "upland") {
      const u = catalog.uplands.find((x) => x.id === crop.upland) ?? null;
      const c = uplandModel(crop);
      level = crop.log ? waterAt(c.water, now) : crop.water;
      want = u ? upWantedWater(c, u, now) : null;
    } else {
      const v = catalog.varieties.find((x) => x.id === crop.variety) ?? null;
      const c = cropModel(crop);
      level = crop.log ? waterAt(c.water, now) : crop.water;
      want = crop.log ? wantedWater(c, v, now)?.levels ?? null : null;
    }
    const target = want && want.length > 0 && !want.includes(level) ? nearestLevel(level, want) : null;
    out.push({ plot: p.no, kind: crop.kind, level, want, target });
  }
  return out.sort((a, b) => a.plot - b.plot);
}

/** My plots of ripe rice the harvester could take (the server checks again: ripe, drained, no lease ending). */
export function harvestablePlots(state: FieldState, me: string): number[] {
  return state.plots
    .filter((p) => p.crop && p.farmer?.id === me && p.crop.kind === "rice" && !p.crop.harvester && p.crop.parts < 6
      && (p.crop.phase === "ripe" || p.crop.phase === "overripe"))
    .map((p) => p.no);
}
