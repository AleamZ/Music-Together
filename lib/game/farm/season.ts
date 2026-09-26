import type { FarmCatalog } from "./catalog";
import { cropModel, cropPhase } from "./crop";
import type { FieldState, PlotView } from "./state";
import { uplandModel, upPhase } from "./upland";

// v17 rat season (§11): rats are out, or some plot is rat food at the next spawn candidate. Only then do clients on the
// field refetch field_state at rats.next_at (D10); spawns send no message. Pure.

/** Is the plot's crop rat food at t, by the client's phase models (0019 _rat_food): rice ripe or overripe with no
 *  harvester job started; khoai or bắp (upland_crops.rat_food) ripe or overripe; never ớt. */
export function ratFoodAt(p: PlotView, catalog: FarmCatalog, t: number): boolean {
  const c = p.crop;
  if (!c) return false;
  if (c.kind === "rice") {
    const v = catalog.varieties.find((x) => x.id === c.variety);
    if (!v) return false;
    const ph = cropPhase(cropModel(c), v, t);
    return (ph === "ripe" || ph === "overripe") && !(c.harvester !== null && t >= c.harvester.startedAt);
  }
  const u = catalog.uplands.find((x) => x.id === c.upland);
  if (!u || !u.ratFood) return false;
  const ph = upPhase(uplandModel(c), u, t);
  return ph === "ripe" || ph === "overripe";
}

/** Rat season: live rats, or a plot that is rat food at next_at. Before 0019 (no rats) it never is. */
export function ratSeason(state: FieldState, catalog: FarmCatalog, nextAt: number): boolean {
  if (!state.rats) return false;
  return state.rats.live.length > 0 || state.plots.some((p) => ratFoodAt(p, catalog, nextAt));
}
