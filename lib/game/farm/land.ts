import {
  FARM_LIMIT, HARVEST_PARTS, HARVESTER_MS, harvesterPrice, PLOT_PRICE, RENT_PRICE, SALE_MAX, SALE_MIN, SUBLEASE_MAX, type Variety,
} from "./catalog";
import { cropModel, cropPhase, waterAt } from "./crop";
import { farmErrorMessage } from "./messages";
import type { FieldMine, OfferView, PlotView } from "./state";

// Land rules on the client (spec §7): who farms what, and why a land action would be refused right now. Each check
// returns the error code the server would raise (the same order of checks), or null — farmErrorMessage turns a code
// into the Vietnamese reason a disabled button shows. Pure. Econ v2 (0102): the limits count every room (the field
// state's mine.farmTotal / mine.ownsLand), and player deals are in a band and pay the seller less the burned fee.

/** `feePct` (econ v2): the field state's p2p_fee_pct, the % a plot sale or a sublease burns (0 before 0102). */
export interface LandCtx { me: string; plots: readonly PlotView[]; mine: FieldMine; feePct?: number }

export const isFarmer = (p: PlotView, me: string): boolean => p.farmer?.id === me;
export const isOwner = (p: PlotView, me: string): boolean => p.owner?.id === me;

/** The plots I farm here: leased ones and my own unleased plot. */
export function farmingCount(ctx: LandCtx): number {
  return ctx.plots.filter((p) => isFarmer(p, ctx.me)).length;
}

/** The plots I farm in every room (the limit is 2): the server's total, or this room's before 0102. */
export function farmingTotal(ctx: LandCtx): number {
  return Math.max(farmingCount(ctx), ctx.mine.farmTotal ?? 0);
}

/** Whether I own a private plot in any room (one each): the server's answer, or this room's before 0102. */
export function ownsLand(ctx: LandCtx): boolean {
  return ctx.mine.ownsLand === true || ctx.plots.some((p) => isOwner(p, ctx.me));
}

const atLimit = (ctx: LandCtx) => farmingTotal(ctx) >= FARM_LIMIT;
const plotOf = (ctx: LandCtx, no: number) => ctx.plots.find((p) => p.no === no) ?? null;

/** The reason text for a refusal code. */
export function reasonText(code: string): string {
  return farmErrorMessage({ message: code });
}

export function rentRefusal(p: PlotView, ctx: LandCtx): string | null {
  if (p.kind !== "village") return "invalid plot";
  if (p.lease) return "plot taken";
  if (atLimit(ctx)) return "farm limit";
  if (ctx.mine.coins < RENT_PRICE) return "not enough coins";
  return null;
}

/** Buying an ownerless private plot from the village. */
export function buyPlotRefusal(p: PlotView, ctx: LandCtx): string | null {
  if (p.kind !== "private" || p.owner) return "not for sale";
  if (p.lease) return "leased";
  if (ownsLand(ctx)) return "already own land";
  if (atLimit(ctx)) return "farm limit";
  if (ctx.mine.coins < PLOT_PRICE) return "not enough coins";
  return null;
}

export function buyListedRefusal(p: PlotView, ctx: LandCtx): string | null {
  if (!p.owner || p.salePrice === null) return "not for sale";
  if (p.owner.id === ctx.me) return "invalid plot";
  if (p.crop) return "crop exists";
  if (p.lease) return "leased";
  if (ownsLand(ctx)) return "already own land";
  if (atLimit(ctx)) return "farm limit";
  if (ctx.mine.coins < p.salePrice) return "not enough coins";
  return null;
}

export function rentSubleaseRefusal(p: PlotView, ctx: LandCtx): string | null {
  if (!p.owner || p.subleasePrice === null) return "not for sale";
  if (p.owner.id === ctx.me) return "invalid plot";
  if (p.lease) return "plot taken";
  if (p.crop) return "crop exists";
  if (atLimit(ctx)) return "farm limit";
  if (ctx.mine.coins < p.subleasePrice) return "not enough coins";
  return null;
}

const priceOk = (price: number, min: number, max: number) => Number.isInteger(price) && price >= min && price <= max;

export function offerRefusal(p: PlotView, ctx: LandCtx, price: number): string | null {
  if (!p.owner) return "not for sale";
  if (p.owner.id === ctx.me) return "invalid plot";
  if (!priceOk(price, SALE_MIN, SALE_MAX)) return "invalid price";
  if (ownsLand(ctx)) return "already own land";
  return null;
}

/** Listing at `price`, or withdrawing the listing (null). */
export function listRefusal(p: PlotView, ctx: LandCtx, price: number | null): string | null {
  if (!isOwner(p, ctx.me)) return "not your plot";
  if (price === null) return null;
  if (!priceOk(price, SALE_MIN, SALE_MAX)) return "invalid price";
  if (p.crop) return "crop exists";
  if (p.lease) return "leased";
  return null;
}

/** Offering the plot for one season at `price`, or withdrawing that (null). */
export function subleaseRefusal(p: PlotView, ctx: LandCtx, price: number | null): string | null {
  if (!isOwner(p, ctx.me)) return "not your plot";
  if (price === null) return null;
  if (!priceOk(price, 1, SUBLEASE_MAX)) return "invalid price";
  if (p.crop) return "crop exists";
  if (p.lease) return "leased";
  return null;
}

/** Selling back to the village: refused while I farm a crop on it (a renter's crop does not matter). */
export function sellBackRefusal(p: PlotView, ctx: LandCtx): string | null {
  if (!isOwner(p, ctx.me)) return "not your plot";
  if (p.crop && isFarmer(p, ctx.me)) return "crop exists";
  return null;
}

/** Renting the co-op's harvester for a rice plot I farm (v15.2 §6.3): the server's checks in their order — the farmer,
 *  a crop, no running job, rice, ripe or overripe with parts left, drained, 30 s left on a lease, and 500 xu per part
 *  left. */
export function harvesterRefusal(p: PlotView, ctx: LandCtx, v: Variety | null, now: number): string | null {
  if (!isFarmer(p, ctx.me)) return "not your plot";
  const crop = p.crop;
  if (!crop) return "not prepared";
  if (crop.harvester) return "harvester busy";
  if (crop.kind !== "rice") return "wrong crop";
  const c = cropModel(crop);
  const ph = cropPhase(c, v, now);
  if (crop.parts >= HARVEST_PARTS || (ph !== "ripe" && ph !== "overripe")) return "wrong phase";
  if ((crop.log ? waterAt(c.water, now) : crop.water) > 1) return "need water";
  if (p.lease && p.lease.until < now + HARVESTER_MS) return "lease ends";
  if (ctx.mine.coins < harvesterPrice(crop.parts)) return "not enough coins";
  return null;
}

/** Accepting an offer: the buyer is checked by the server. */
export function acceptRefusal(o: OfferView, ctx: LandCtx): string | null {
  const p = plotOf(ctx, o.plot);
  if (!p || !isOwner(p, ctx.me)) return "not your plot";
  if (p.crop) return "crop exists";
  if (p.lease) return "leased";
  return null;
}
