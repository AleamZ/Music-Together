// The field_state JSON (spec §11.5), camelCased, with times as ms since the epoch. Pure.

export type Phase = "prepared" | "soaking" | "sprouted" | "seedling" | "tillering" | "panicle" | "heading" | "ripening" | "ripe" | "overripe";
export type PestKind = "snail" | "leaf_folder" | "hopper" | "leaf_blast" | "neck_blast";

const PHASES: readonly string[] = ["prepared", "soaking", "sprouted", "seedling", "tillering", "panicle", "heading", "ripening", "ripe", "overripe"];
const PESTS: readonly string[] = ["snail", "leaf_folder", "hopper", "leaf_blast", "neck_blast"];

export interface Who { id: string; name: string }
export interface WaterEntry { t: number; l: number }
export interface ItemEntry { t: number; item: string }

/** The crop's logs — only its farmer gets them. */
export interface CropLog { water: WaterEntry[]; fert: ItemEntry[]; spray: ItemEntry[]; picks: number[]; qTransplant: number }

/** A pest whose hidden roll has fired (spec §8.5). */
export interface PestView { kind: PestKind; since: number; treatedAt: number | null }

export interface CropView {
  variety: string | null;
  phase: Phase;
  preparedAt: number | null;
  soakAt: number | null;
  sowAt: number | null;
  transplantAt: number | null;
  /** The level now, and when it was last set (it drops one level per 12 h after that). */
  water: number;
  waterSetAt: number | null;
  pests: PestView[];
  excessN: boolean;
  /** Ripe or overripe (the v16 rat hook). */
  ripe: boolean;
  /** The last soaked seed rotted unsown. */
  rottedAt: number | null;
  log: CropLog | null;
}

export interface LeaseView { source: "village" | "owner"; until: number; price: number }

export interface PlotView {
  no: number;
  kind: "private" | "village";
  owner: Who | null;
  salePrice: number | null;
  subleasePrice: number | null;
  farmer: Who | null;
  lease: LeaseView | null;
  /** Pending purchase offers (details only for the owner, in mine.incomingOffers). */
  offers: number;
  crop: CropView | null;
}

export interface DryingView { slot: number; owner: Who | null; variety: string; kg: number; readyAt: number }

export interface OfferView { id: string; plot: number; price: number; expiresAt: number; buyer: Who | null }

/** The account part of the answer — sell_rice, buy_farm_item and claim_farm_gift return only this. */
export interface FarmMine {
  items: Record<string, number>;
  rice: Record<string, { wet: number; dry: number }>;
  coins: number;
  giftClaimed: boolean;
}

export interface FieldMine extends FarmMine {
  ownedPlot: number | null;
  farming: number[];
  myOffers: OfferView[];
  incomingOffers: OfferView[];
}

export interface FieldState { serverNow: number; plots: PlotView[]; drying: DryingView[]; mine: FieldMine }

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
/** An ISO timestamp → ms; anything else → null. */
const time = (v: unknown): number | null => {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};
const who = (v: unknown): Who | null => {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  return typeof o.id === "string" ? { id: o.id, name: str(o.name) } : null;
};

function parseLog(v: unknown): CropLog | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const items = (a: unknown): ItemEntry[] => arr(a).map(obj)
    .map((e) => ({ t: time(e.t), item: str(e.item) }))
    .filter((e): e is ItemEntry => e.t !== null && e.item !== "");
  return {
    water: arr(o.water).map(obj).map((e) => ({ t: time(e.t), l: num(e.l) })).filter((e): e is WaterEntry => e.t !== null),
    fert: items(o.fert),
    spray: items(o.spray),
    picks: arr(o.picks).map(obj).map((e) => time(e.t)).filter((t): t is number => t !== null),
    qTransplant: num(o.q_transplant, 1),
  };
}

function parseCrop(v: unknown): CropView | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  const phase = PHASES.includes(str(c.phase)) ? (c.phase as Phase) : "prepared";
  return {
    variety: typeof c.variety === "string" ? c.variety : null,
    phase,
    preparedAt: time(c.prepared_at),
    soakAt: time(c.soak_at),
    sowAt: time(c.sow_at),
    transplantAt: time(c.transplant_at),
    water: num(c.water),
    waterSetAt: time(c.water_set_at),
    pests: arr(c.pests).map(obj).flatMap((p): PestView[] => {
      const since = time(p.since);
      return PESTS.includes(str(p.kind)) && since !== null ? [{ kind: p.kind as PestKind, since, treatedAt: time(p.treated_at) }] : [];
    }),
    excessN: c.excess_n === true,
    ripe: c.ripe === true,
    rottedAt: time(c.rotted_at),
    log: parseLog(c.log),
  };
}

function parsePlot(v: unknown): PlotView | null {
  const p = obj(v);
  const no = num(p.no);
  if (no < 1 || no > 10) return null;
  const l = obj(p.lease);
  const until = time(l.until);
  return {
    no,
    kind: p.kind === "private" ? "private" : "village",
    owner: who(p.owner),
    salePrice: numOrNull(p.sale_price),
    subleasePrice: numOrNull(p.sublease_price),
    farmer: who(p.farmer),
    lease: until === null ? null : { source: l.source === "owner" ? "owner" : "village", until, price: num(l.price) },
    offers: num(p.offers),
    crop: parseCrop(p.crop),
  };
}

function parseOffer(v: unknown): OfferView | null {
  const o = obj(v);
  const expiresAt = time(o.expires_at);
  if (typeof o.id !== "string" || expiresAt === null) return null;
  return { id: o.id, plot: num(o.plot), price: num(o.price), expiresAt, buyer: who(o.buyer) };
}

/** The account part of any farm answer; null when it is not an object. */
export function parseFarmMine(json: unknown): FarmMine | null {
  if (!json || typeof json !== "object") return null;
  const m = json as Record<string, unknown>;
  const items: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(m.items))) if (num(v) > 0) items[k] = num(v);
  const rice: Record<string, { wet: number; dry: number }> = {};
  for (const [k, v] of Object.entries(obj(m.rice))) rice[k] = { wet: num(obj(v).wet), dry: num(obj(v).dry) };
  return { items, rice, coins: num(m.coins), giftClaimed: m.gift_claimed === true };
}

/** A field_state answer; null when it is not one. */
export function parseFieldState(json: unknown): FieldState | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;
  const serverNow = time(j.server_now);
  const base = parseFarmMine(j.mine);
  if (serverNow === null || !base || !Array.isArray(j.plots)) return null;
  const m = obj(j.mine);
  const offers = (v: unknown) => arr(v).map(parseOffer).filter((o): o is OfferView => o !== null);
  return {
    serverNow,
    plots: j.plots.map(parsePlot).filter((p): p is PlotView => p !== null).sort((a, b) => a.no - b.no),
    drying: arr(j.drying).map(obj).flatMap((d): DryingView[] => {
      const readyAt = time(d.ready_at);
      return readyAt === null ? [] : [{ slot: num(d.slot), owner: who(d.owner), variety: str(d.variety), kg: num(d.kg), readyAt }];
    }),
    mine: {
      ...base,
      ownedPlot: numOrNull(m.owned_plot),
      farming: arr(m.farming).filter((x): x is number => typeof x === "number"),
      myOffers: offers(m.my_offers),
      incomingOffers: offers(m.incoming_offers),
    },
  };
}

/** A field state with a newer account part (the answer of sell_rice, buy_farm_item or claim_farm_gift). */
export function withMine(s: FieldState, mine: FarmMine): FieldState {
  return { ...s, mine: { ...s.mine, ...mine } };
}

/** How many of a farm item the account holds. */
export function itemCount(m: FarmMine, id: string): number {
  return m.items[id] ?? 0;
}
