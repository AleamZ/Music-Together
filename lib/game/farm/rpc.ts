import { AnticheatError, screenAnswer } from "@/lib/anticheat";
import { supabase } from "@/lib/supabase";
import {
  critterFromRow, FARM_KINDS, farmItemFromRow, uplandFromRow, varietyFromRow, type CritterKindRow, type FarmCatalog, type FarmItemRow,
  type UplandCropRow, type VarietyRow,
} from "./catalog";
import { parseFarmMine, parseFieldState, type FarmMine, type FieldState } from "./state";

// Supabase calls for the field (spec §11.3; v15.2 §11.4; v15.3 §11.4). Every farm answer in a room is the whole
// field_state; the account-only ones (sell_rice, buy_farm_item, claim_farm_gift, load_sprayer, sell_produce,
// sell_critters) and the gathering ones (crab_start, crab_finish, pick_snail_bed) answer with the account part.

/** The RPCs 0016 adds: before it runs, PostgREST cannot find them (v15.2 R28). */
export const RPCS_152: ReadonlySet<string> = new Set([
  "prepare_beds", "plant_crop", "tend_crop", "harvest_part", "rent_harvester", "load_sprayer", "sell_produce",
]);

/** The RPCs 0018 adds: before it runs, PostgREST cannot find them (v15.3 R23). */
export const RPCS_153: ReadonlySet<string> = new Set(["crab_start", "crab_finish", "pick_snail_bed", "sell_critters"]);

/** No such table: upland_crops before 0016, critter_kinds before 0018 (PostgREST's PGRST205, Postgres' 42P01). */
const isMissingTable = (e: { code?: unknown } | null): boolean => e?.code === "PGRST205" || e?.code === "42P01";

let catalogPromise: Promise<FarmCatalog> | null = null;

/** Varieties, hoa-màu crops, farm items and critters, cached per page load (a failed fetch is retried on the next
 *  call). Before 0016 there are no hoa-màu crops, and before 0018 no critters. */
export function fetchFarmCatalog(): Promise<FarmCatalog> {
  if (!catalogPromise) {
    catalogPromise = (async () => {
      const [va, up, it, cr] = await Promise.all([
        supabase.from("rice_varieties").select("*").order("sort_order"),
        supabase.from("upland_crops").select("*").order("sort_order"),
        supabase.from("shop_items").select("*").in("kind", FARM_KINDS).order("kind").order("sort_order"),
        supabase.from("critter_kinds").select("*").order("sort_order"),
      ]);
      const upErr = isMissingTable(up.error) ? null : up.error;
      const crErr = isMissingTable(cr.error) ? null : cr.error;
      if (va.error || upErr || it.error || crErr) throw va.error ?? upErr ?? it.error ?? crErr;
      return {
        varieties: ((va.data ?? []) as VarietyRow[]).map(varietyFromRow),
        uplands: (up.error ? [] : ((up.data ?? []) as UplandCropRow[])).map(uplandFromRow),
        items: ((it.data ?? []) as FarmItemRow[]).map(farmItemFromRow),
        critters: (cr.error ? [] : ((cr.data ?? []) as CritterKindRow[])).map(critterFromRow),
      };
    })().catch((e) => {
      catalogPromise = null;
      throw e;
    });
  }
  return catalogPromise;
}

/** An RPC's answer; a flagged answer (anti-cheat §9.1) throws an AnticheatError. */
async function call(fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc(fn, args);
  const flagged = screenAnswer(data, error);
  if (error) throw error;
  if (flagged) throw new AnticheatError(flagged);
  return (data ?? {}) as Record<string, unknown>;
}

function fieldOf(raw: unknown): FieldState {
  const s = parseFieldState(raw);
  if (!s) throw new Error("bad field state");
  return s;
}

function mineOf(raw: unknown): FarmMine {
  const m = parseFarmMine(raw);
  if (!m) throw new Error("bad farm state");
  return m;
}

export async function fetchFieldState(roomId: string, token: string): Promise<FieldState> {
  return fieldOf(await call("field_state", { p_room_id: roomId, p_session_token: token }));
}

/** Every room-scoped land and farm action (§11.3). */
export type FieldAction =
  | { kind: "rent"; plot: number }
  | { kind: "buy_plot"; plot: number }
  | { kind: "sell_back"; plot: number }
  | { kind: "list"; plot: number; price: number | null }
  | { kind: "buy_listed"; plot: number; expected: number }
  | { kind: "offer"; plot: number; price: number }
  | { kind: "withdraw_offer"; offer: string }
  | { kind: "decline_offer"; offer: string }
  | { kind: "accept_offer"; offer: string }
  | { kind: "set_sublease"; plot: number; price: number | null }
  | { kind: "rent_sublease"; plot: number; expected: number }
  | { kind: "abandon"; plot: number }
  | { kind: "prepare"; plot: number }
  | { kind: "prepare_beds"; plot: number }
  | { kind: "plant"; plot: number; item: string }
  | { kind: "tend"; plot: number; act: string }
  | { kind: "harvest_part"; plot: number; success: boolean }
  | { kind: "rent_harvester"; plot: number }
  | { kind: "fertilize"; plot: number; item: string }
  | { kind: "soak"; plot: number; item: string }
  | { kind: "sow"; plot: number }
  | { kind: "begin_work"; plot: number; work: "transplant" | "harvest" }
  | { kind: "transplant"; plot: number; quality: number }
  | { kind: "water"; plot: number; delta: 1 | -1 }
  | { kind: "spray"; plot: number; item: string }
  | { kind: "pick_snails"; plot: number }
  | { kind: "harvest"; plot: number; quality: number }
  | { kind: "dry_start"; variety: string; kg: number }
  | { kind: "dry_collect"; slot: number };

/** The RPC name and its own arguments for an action. */
export function actionCall(a: FieldAction): [string, Record<string, unknown>] {
  switch (a.kind) {
    case "rent": return ["rent_plot", { p_plot: a.plot }];
    case "buy_plot": return ["buy_plot", { p_plot: a.plot }];
    case "sell_back": return ["sell_plot_to_village", { p_plot: a.plot }];
    case "list": return ["list_plot", { p_plot: a.plot, p_price: a.price }];
    case "buy_listed": return ["buy_listed_plot", { p_plot: a.plot, p_expected_price: a.expected }];
    case "offer": return ["offer_plot", { p_plot: a.plot, p_price: a.price }];
    case "withdraw_offer": return ["withdraw_offer", { p_offer_id: a.offer }];
    case "decline_offer": return ["decline_offer", { p_offer_id: a.offer }];
    case "accept_offer": return ["accept_offer", { p_offer_id: a.offer }];
    case "set_sublease": return ["set_sublease", { p_plot: a.plot, p_price: a.price }];
    case "rent_sublease": return ["rent_sublease", { p_plot: a.plot, p_expected_price: a.expected }];
    case "abandon": return ["abandon_crop", { p_plot: a.plot }];
    case "prepare": return ["prepare_plot", { p_plot: a.plot }];
    case "prepare_beds": return ["prepare_beds", { p_plot: a.plot }];
    case "plant": return ["plant_crop", { p_plot: a.plot, p_item_id: a.item }];
    case "tend": return ["tend_crop", { p_plot: a.plot, p_act: a.act }];
    case "harvest_part": return ["harvest_part", { p_plot: a.plot, p_success: a.success }];
    case "rent_harvester": return ["rent_harvester", { p_plot: a.plot }];
    case "fertilize": return ["apply_fertilizer", { p_plot: a.plot, p_item_id: a.item }];
    case "soak": return ["soak_seed", { p_plot: a.plot, p_item_id: a.item }];
    case "sow": return ["sow_seed", { p_plot: a.plot }];
    case "begin_work": return ["begin_work", { p_plot: a.plot, p_work: a.work }];
    case "transplant": return ["transplant", { p_plot: a.plot, p_quality: a.quality }];
    case "water": return ["water", { p_plot: a.plot, p_delta: a.delta }];
    case "spray": return ["spray", { p_plot: a.plot, p_item_id: a.item }];
    case "pick_snails": return ["pick_snails", { p_plot: a.plot }];
    case "harvest": return ["harvest", { p_plot: a.plot, p_quality: a.quality }];
    case "dry_start": return ["dry_start", { p_variety: a.variety, p_kg: a.kg }];
    case "dry_collect": return ["dry_collect", { p_slot: a.slot }];
  }
}

/** A rice part cut by hand (§6.2): its kg, the parts cut now, the plot's kg so far, and whether it was the sixth. */
export interface PartAnswer { variety: string; kg: number; parts: number; total: number; done: boolean }
/** A hoa-màu picking (§8.9): picking k of n gave kg; `done` = it was the last. */
export interface PickingAnswer { upland: string; kg: number; k: number; pickings: number; done: boolean }

/** Critters caught (v15.3 §7.2–§7.4): each kept one at its price, and how many got away for want of room (R5). */
export interface CatchAnswer { caught: { kind: string; price: number }[]; escaped: number }

export interface FieldAnswer {
  state: FieldState;
  /** A whole rice harvest (a database without 0016). */
  harvest: { variety: string; kg: number } | null;
  harvestPart: PartAnswer | null;
  picking: PickingAnswer | null;
  /** pick_snails' ốc bươu vàng for the picker (null before 0018). */
  snails: CatchAnswer | null;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A catch (v15.3 §7.2–§7.4): each critter kept, at its price, and how many escaped. Anything malformed, down to a single
 *  entry of `caught`, throws `bad`: an entry is never dropped. */
function catchOf(v: unknown, bad: string): CatchAnswer {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  if (!o || !Array.isArray(o.caught) || !isNum(o.escaped)) throw new Error(bad);
  const caught = o.caught.map((c): CatchAnswer["caught"][number] => {
    const x = c && typeof c === "object" ? (c as Record<string, unknown>) : {};
    if (typeof x.kind !== "string" || !isNum(x.price)) throw new Error(bad);
    return { kind: x.kind, price: x.price };
  });
  return { caught, escaped: o.escaped };
}

export async function fieldAction(roomId: string, token: string, a: FieldAction): Promise<FieldAnswer> {
  const [fn, args] = actionCall(a);
  const r = await call(fn, { p_room_id: roomId, p_session_token: token, ...args });
  const h = r.harvest && typeof r.harvest === "object" ? (r.harvest as Record<string, unknown>) : null;
  const p = r.harvest_part && typeof r.harvest_part === "object" ? (r.harvest_part as Record<string, unknown>) : null;
  return {
    state: fieldOf(r),
    harvest: h && typeof h.variety === "string" && isNum(h.kg) ? { variety: h.variety, kg: h.kg } : null,
    harvestPart: p && typeof p.variety === "string" && isNum(p.kg) && isNum(p.parts) && isNum(p.total)
      ? { variety: p.variety, kg: p.kg, parts: p.parts, total: p.total, done: p.done === true } : null,
    picking: h && typeof h.upland === "string" && isNum(h.kg) && isNum(h.k) && isNum(h.pickings)
      ? { upland: h.upland, kg: h.kg, k: h.k, pickings: h.pickings, done: h.done === true } : null,
    // pick_snails' answer has no snails before 0018; one that has them must hold them whole
    snails: r.snails === undefined ? null : catchOf(r.snails, "bad snail answer"),
  };
}

export interface MineAnswer { serverNow: string | null; mine: FarmMine }

function mineAnswer(r: Record<string, unknown>): MineAnswer {
  return { serverNow: typeof r.server_now === "string" ? r.server_now : null, mine: mineOf(r.mine) };
}

export async function sellRice(token: string, variety: string, dry: boolean, kg: number): Promise<MineAnswer> {
  return mineAnswer(await call("sell_rice", { p_session_token: token, p_variety: variety, p_dry: dry, p_kg: kg }));
}

export async function buyFarmItem(token: string, itemId: string, qty: number): Promise<MineAnswer> {
  return mineAnswer(await call("buy_farm_item", { p_session_token: token, p_item_id: itemId, p_qty: qty }));
}

export async function claimFarmGift(token: string): Promise<MineAnswer & { gifted: boolean }> {
  const r = await call("claim_farm_gift", { p_session_token: token });
  return { ...mineAnswer(r), gifted: r.gifted === true };
}

/** Nạp thuốc (§7): one bottle of the pesticide into the sprayer's tank, 3 sprays. */
export async function loadSprayer(token: string, itemId: string): Promise<MineAnswer> {
  return mineAnswer(await call("load_sprayer", { p_session_token: token, p_item_id: itemId }));
}

/** Sells kg of a hoa-màu crop to cô Út (§9). */
export async function sellProduce(token: string, upland: string, kg: number): Promise<MineAnswer> {
  return mineAnswer(await call("sell_produce", { p_session_token: token, p_upland: upland, p_kg: kg }));
}

/** A crab visit (v15.3 §7.2): its id, the hole, and when the server started it. */
export interface CrabVisit { id: string; hole: number; startedAt: number }

/** Bắt cua (R6): the visit starts the hole's cooldown. */
export async function crabStart(roomId: string, token: string, hole: number): Promise<MineAnswer & { visit: CrabVisit }> {
  const r = await call("crab_start", { p_room_id: roomId, p_session_token: token, p_hole: hole });
  const v = r.visit && typeof r.visit === "object" ? (r.visit as Record<string, unknown>) : {};
  const startedAt = typeof v.started_at === "string" ? Date.parse(v.started_at) : NaN;
  if (typeof v.id !== "string" || !isNum(v.hole) || !Number.isFinite(startedAt)) throw new Error("bad crab visit");
  return { ...mineAnswer(r), visit: { id: v.id, hole: v.hole, startedAt } };
}

/** The end of a crab visit (R7): hits 0–3; what was kept and what escaped. The hits are the server's (§7.2): an answer
 *  without them is malformed. */
export async function crabFinish(roomId: string, token: string, visitId: string, hits: number)
  : Promise<MineAnswer & { crab: CatchAnswer & { hits: number } }> {
  const r = await call("crab_finish", { p_room_id: roomId, p_session_token: token, p_visit_id: visitId, p_hits: hits });
  const c = catchOf(r.crab, "bad crab answer");
  const o = r.crab as Record<string, unknown>;
  if (!isNum(o.hits)) throw new Error("bad crab answer");
  return { ...mineAnswer(r), crab: { ...c, hits: o.hits } };
}

/** Mò ốc (§7.3): 1–3 snails from a bed. */
export async function pickSnailBed(roomId: string, token: string, bed: number): Promise<MineAnswer & { snails: CatchAnswer }> {
  const r = await call("pick_snail_bed", { p_room_id: roomId, p_session_token: token, p_bed: bed });
  return { ...mineAnswer(r), snails: catchOf(r.snails, "bad snail answer") };
}

/** cô Út buys every critter of a kind (null: all of them) at the prices stored at the catch (R15); `sold` is what she
 *  paid, so an answer without it whole is malformed. */
export async function sellCritters(token: string, kind: string | null): Promise<MineAnswer & { sold: { n: number; xu: number } }> {
  const r = await call("sell_critters", { p_session_token: token, p_kind: kind });
  const s = r.sold && typeof r.sold === "object" ? (r.sold as Record<string, unknown>) : {};
  if (!isNum(s.n) || !isNum(s.xu)) throw new Error("bad sale answer");
  return { ...mineAnswer(r), sold: { n: s.n, xu: s.xu } };
}
