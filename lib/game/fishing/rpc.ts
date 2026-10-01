import { AnticheatError, lockSeconds, lockText, parseAnticheat, screenAnswer, type AnticheatInfo } from "@/lib/anticheat";
import { supabase } from "@/lib/supabase";
import { parseNpcQuota, type NpcQuota } from "@/lib/game/economy/npc";
import { positionErrorText } from "@/lib/game/position";
import { publishVitals, vitalsErrorMessage } from "@/lib/game/vitals-rpc";
import { STORM_TEXT } from "@/lib/game/weather/rpc";
import {
  FISHING_KINDS, isRarity, shopItemFromRow, speciesFromRow, type FishingCatalog, type Rarity, type ShopItemRow, type SpeciesRow,
} from "./catalog";
import { BAD_SPOT, DAILY_LIMIT_TEXT, NEEDS_PARTS } from "./messages";
import { extrasErrorText } from "./extras";
import {
  GROUNDBAIT_CAP_MINUTES, GROUNDBAIT_PLAYER_LIMIT, GROUNDBAIT_ROOM_LIMIT, parseGroundbaitSpots, type GroundbaitSpotView,
} from "./groundbait-spots";
import { parseFishPrices, type FishPrices } from "./prices";
import { parseFishingState, rodOf, type FishingState, type GearSlot, type Loadout, type PartSlot, type RodInstance } from "./state";

// Supabase calls for the fishing RPCs (spec §8.3). Every answer carries the account's full state.

let catalogPromise: Promise<FishingCatalog> | null = null;

/** Species + shop items, cached per page load (a failed fetch is retried on the next call). */
export function fetchFishingCatalog(): Promise<FishingCatalog> {
  if (!catalogPromise) {
    catalogPromise = (async () => {
      const [sp, it] = await Promise.all([
        supabase.from("fish_species").select("*").order("sort_order"),
        supabase.from("shop_items").select("*").in("kind", FISHING_KINDS).order("kind").order("sort_order"),
      ]);
      if (sp.error || it.error) {
        catalogPromise = null;
        throw sp.error ?? it.error;
      }
      return {
        species: ((sp.data ?? []) as SpeciesRow[]).map(speciesFromRow),
        items: ((it.data ?? []) as ShopItemRow[]).map(shopItemFromRow),
      };
    })().catch((e) => {
      catalogPromise = null;
      throw e;
    });
  }
  return catalogPromise;
}

/** An RPC's answer. A flagged answer (anti-cheat §9.1) throws an AnticheatError, except those of the replayed minigames
 *  (finish_cast, and from 0056 net_haul and finish_net): their envelope rides on the lost answer. */
const ENVELOPE_ON_ANSWER = new Set(["finish_cast", "net_haul", "finish_net", "hook_cast"]);
async function call(fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc(fn, args);
  const flagged = screenAnswer(data, error);
  if (error) throw error;
  if (flagged && !ENVELOPE_ON_ANSWER.has(fn)) throw new AnticheatError(flagged);
  return (data ?? {}) as Record<string, unknown>;
}

function stateOf(raw: unknown): FishingState {
  const s = parseFishingState(raw);
  if (!s) throw new Error("bad fishing state");
  return s;
}

export async function fetchFishingState(token: string): Promise<FishingState> {
  return stateOf(await call("fishing_state", { p_session_token: token }));
}

export async function claimDaily(token: string): Promise<{ claimed: boolean; amount: number; state: FishingState }> {
  const r = await call("claim_daily", { p_session_token: token });
  return { claimed: r.claimed === true, amount: Number(r.amount ?? 0), state: stateOf(r.state) };
}

export async function digWorms(token: string): Promise<{ gained: number; state: FishingState }> {
  const r = await call("dig_worms", { p_session_token: token });
  return { gained: Number(r.gained ?? 0), state: stateOf(r.state) };
}

export async function buyItem(token: string, itemId: string, qty: number): Promise<FishingState> {
  return stateOf((await call("buy_item", { p_session_token: token, p_item_id: itemId, p_qty: qty })).state);
}

/** v18.2 Sửa cần: the rod back to its max durability for 30% of its price. */
export async function repairRod(token: string, itemId: string): Promise<{ cost: number; state: FishingState }> {
  const r = await call("repair_rod", { p_session_token: token, p_item_id: itemId });
  return { cost: Number(r.cost ?? 0), state: stateOf(r.state) };
}

/** v18.2: a net throw opened (0056: when the aim starts; nothing is spent yet) — the school's seed and the net's radius. */
export interface StartNet { throwId: string; seed: number; radiusPx: number; state: FishingState; abandoned?: Abandoned | null }

export async function startNet(roomId: string, token: string, cell: { col: number; row: number }, net: string): Promise<StartNet> {
  const r = await call("start_net", { p_room_id: roomId, p_session_token: token, p_col: cell.col, p_row: cell.row, p_net: net });
  publishVitals(r.vitals);                                                     // a server before 0056 spent the effort here
  return {
    throwId: String(r.throw_id), seed: Number(r.seed ?? 0) >>> 0, radiusPx: Number(r.radius_px ?? 24), state: stateOf(r.state),
    abandoned: parseAbandoned(r.abandoned),                                    // 0059
  };
}

const netFish = (v: unknown): CaughtFish[] => (Array.isArray(v) ? v : []).map((x) => {
  const f = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  return {
    id: String(f.id ?? ""), speciesId: String(f.species_id), weightG: Number(f.weight_g), price: Number(f.price),
    rarity: isRarity(f.rarity) ? f.rarity : 1,
  } satisfies CaughtFish;
});

/** Why a throw or a pull was lost (0056): late, too fast, an input the server's replay refused, or a page before 0056. */
export type NetLostWhy = "expired" | "too_early" | "net_invalid" | "outdated";
const NET_WHYS: readonly NetLostWhy[] = ["expired", "too_early", "net_invalid", "outdated"];
const netWhy = (v: unknown): NetLostWhy => ((NET_WHYS as readonly unknown[]).includes(v) ? (v as NetLostWhy) : "too_early");

/** The net sank: `haul` = the fish under it (not in the bag until kéo lưới ends; ids empty) and kéo lưới's seed;
 *  `empty` = none; `lost` = the throw is gone (`anticheat`: the envelope when the server flagged it). */
export type NetHaul =
  | { result: "haul"; fish: CaughtFish[]; arrowSeed: number; state: FishingState }
  | { result: "empty"; state: FishingState }
  | { result: "lost"; why: NetLostWhy; state: FishingState; anticheat: AnticheatInfo | null };

/** The throw's input (0056), replayed by the server: the press and release ticks since the start_net answer, the aim at
 *  the release (scene milli-px) and how many shadows the client saw under the net. */
export interface NetThrow { press: number; release: number; aimX: number; aimY: number; hits: number }

export async function netHaul(token: string, throwId: string, t: NetThrow): Promise<NetHaul> {
  const r = await call("net_haul", {
    p_session_token: token, p_throw_id: throwId, p_press: t.press, p_release: t.release, p_aim_x: t.aimX, p_aim_y: t.aimY,
    p_hits: t.hits,
  });
  publishVitals(r.vitals);                                                     // 0056: the throw's effort is spent here
  const state = stateOf(r.state);
  if (r.result === "haul") return { result: "haul", fish: netFish(r.fish), arrowSeed: Number(r.arrow_seed ?? 0) >>> 0, state };
  if (r.result === "empty") return { result: "empty", state };
  return { result: "lost", why: netWhy(r.why), state, anticheat: parseAnticheat(r) };
}

/** Kéo lưới ended: the fish left go into the bag (one escaped per mistake; `escaped`); the 4th mistake = pulled into the
 *  pond (`overboard`, like v18.1's). */
export type FinishNet =
  | { result: "caught"; count: number; escaped: number; fish: CaughtFish[]; state: FishingState }
  | { result: "lost"; why: NetLostWhy | "overboard"; state: FishingState; overboard?: Overboard; anticheat: AnticheatInfo | null };

/** Kéo lưới's input (0056), replayed by the server: each key as tick·4 + arrow code (ticks since the haul answer), the
 *  tick it ended on and the mistakes the client counted (0 … 4). */
export interface NetPull { keys: number[]; ticks: number; mistakes: number }

export async function finishNet(token: string, throwId: string, p: NetPull): Promise<FinishNet> {
  const r = await call("finish_net", {
    p_session_token: token, p_throw_id: throwId, p_keys: p.keys, p_ticks: p.ticks, p_mistakes: p.mistakes,
  });
  const state = stateOf(r.state);
  if (r.result === "caught") {
    const fish = netFish(r.fish);
    return { result: "caught", count: Number(r.count ?? fish.length), escaped: Number(r.escaped ?? 0), fish, state };
  }
  if (r.why === "overboard") {
    const o = (r.overboard && typeof r.overboard === "object" ? r.overboard : {}) as Record<string, unknown>;
    return { result: "lost", why: "overboard", state, overboard: { rod: "", rodLost: false, hunger: Number(o.hunger ?? 5) }, anticheat: null };   // econ v2: 5
  }
  return { result: "lost", why: netWhy(r.why), state, anticheat: parseAnticheat(r) };
}
export async function setLoadout(token: string, l: Loadout): Promise<FishingState> {
  return stateOf((await call("set_loadout", { p_session_token: token, p_rod: l.rod, p_bobber: l.bobber, p_bait: l.bait })).state);
}

/** 0110: mount (`item`) or unmount (null) one slot of the rig. */
export async function fishingEquip(token: string, slot: GearSlot, item: string | null): Promise<FishingState> {
  return stateOf((await call("fishing_equip", { p_session_token: token, p_slot: slot, p_item: item })).state);
}

/** 0115: an answer of the rod RPCs: the bag's rods, the state, and the part destroyed (replaced / taken off). */
export interface RodAnswer { rods: RodInstance[]; state: FishingState; destroyed: string | null; cost?: number }
function rodAnswer(r: Record<string, unknown>): RodAnswer {
  return {
    rods: (Array.isArray(r.rods) ? r.rods : []).map(rodOf).filter((x): x is RodInstance => x !== null),
    state: stateOf(r.state), destroyed: typeof r.destroyed === "string" ? r.destroyed : null,
    ...(typeof r.cost === "number" ? { cost: r.cost } : {}),
  };
}

/** 0115: the rods in my bag, each with its parts and rig. */
export async function rodList(token: string): Promise<RodInstance[]> {
  const r = await call("rod_list", { p_session_token: token });
  return (Array.isArray(r.rods) ? r.rods : []).map(rodOf).filter((x): x is RodInstance => x !== null);
}
/** 0115: mount one unit of `item` from the bag onto rod `rodId`'s slot — bound for good; a part already there is destroyed. */
export async function rodMount(token: string, rodId: number, slot: PartSlot, item: string): Promise<RodAnswer> {
  return rodAnswer(await call("rod_mount", { p_session_token: token, p_rod: rodId, p_slot: slot, p_item: item }));
}
/** 0115: take a part off a rod — it is destroyed. */
export async function rodUnmount(token: string, rodId: number, slot: PartSlot): Promise<RodAnswer> {
  return rodAnswer(await call("rod_unmount", { p_session_token: token, p_rod: rodId, p_slot: slot }));
}
/** 0115: fish with this rod (null: Cần gỗ). */
export async function rodEquip(token: string, rodId: number | null): Promise<RodAnswer> {
  return rodAnswer(await call("rod_equip", { p_session_token: token, p_rod: rodId }));
}
export async function rodRename(token: string, rodId: number, name: string): Promise<RodAnswer> {
  return rodAnswer(await call("rod_rename", { p_session_token: token, p_rod: rodId, p_name: name }));
}
/** 0115: throw a rod away with its parts (no refund). */
export async function rodScrap(token: string, rodId: number): Promise<RodAnswer> {
  return rodAnswer(await call("rod_scrap", { p_session_token: token, p_rod: rodId }));
}
/** 0115: Sửa cần for one rod instance (30% of its price). */
export async function rodRepair(token: string, rodId: number): Promise<RodAnswer> {
  return rodAnswer(await call("rod_repair", { p_session_token: token, p_rod: rodId }));
}

/** 0110: where a groundbait is thrown — the pond cell (as start_cast), or the river in world px (as the river casts). */
export type GroundbaitSpot = { map: "pond"; col: number; row: number } | { map: "song_cai" | "wild"; x: number; y: number };

/** 0110: one bag of groundbait on my spot (10 minutes, 48 px around it). 0117: the spot is the room's (anyone fishing
 *  within 48 px feels it); the same kind nearby is topped up instead (≤ 20 minutes, ×3). */
export async function throwGroundbait(roomId: string, token: string, item: string, spot: GroundbaitSpot): Promise<FishingState> {
  const [x, y] = spot.map === "pond" ? [spot.col, spot.row] : [spot.x, spot.y];
  return stateOf((await call("throw_groundbait", {
    p_room_id: roomId, p_session_token: token, p_item: item, p_map: spot.map, p_x: x, p_y: y,
  })).state);
}

/** 0117: the room's active ổ thính (all maps), for the 2D / 3D views, the minimap and the HUD. */
export async function fetchGroundbaitSpots(roomId: string, token: string): Promise<GroundbaitSpotView[]> {
  return parseGroundbaitSpots(await call("groundbait_spots", { p_room_id: roomId, p_session_token: token }), Date.now());
}

/** 0110: a species' habits in Sổ tay câu cá. */
export interface FishHabit {
  id: string;
  /** The hook class it needs; null = any hook. */
  hook: string | null;
  baits: string[];
  groundbaits: string[];
  /** The Vietnam clock hours it bites; null = always. */
  hours: number[] | null;
  note: string;
}
export interface Notebook { hour: number; species: FishHabit[] }

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** 0110: parse fishing_notebook's answer. */
export function parseNotebook(r: Record<string, unknown>): Notebook {
  const list = Array.isArray(r.species) ? r.species : [];
  return {
    hour: Number(r.hour ?? 0),
    species: list.map((x) => {
      const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      return {
        id: String(o.id ?? ""), hook: typeof o.hook === "string" ? o.hook : null, baits: strs(o.baits), groundbaits: strs(o.groundbaits),
        hours: Array.isArray(o.hours) ? o.hours.filter((h): h is number => typeof h === "number") : null,
        note: typeof o.note === "string" ? o.note : "",
      };
    }),
  };
}

/** 0110: Sổ tay câu cá (the notebook must be bought: 'no notebook'). */
export async function fetchNotebook(token: string): Promise<Notebook> {
  return parseNotebook(await call("fishing_notebook", { p_session_token: token }));
}

export interface StartCast {
  castId: string; biteMs: number; windowMs: number; difficulty: number; minReelMs: number; zonePct: number;
  /** Only when the bobber shows it. */
  rarity: Rarity | null;
  baitSwitched: boolean;
  /** v18.1: "shore" casts bite less often and later. */
  spot: "dock" | "shore";
  /** v18.1: false = nothing will bite this cast (a shore cast; absent from an older server = true). */
  bites: boolean;
  /** 0046: the server-chosen reel seed (u32) finish_cast replays the reel with; null from a server before 0046, and
   *  from 0059 on (the seed comes with the hook: hookCast). */
  reelSeed: number | null;
  /** 0059: the server times the hook (hook_cast answers the seed). */
  serverHook: boolean;
  /** 0059: a hooked cast this one replaced, given up: what it cost (null: none). */
  abandoned: Abandoned | null;
  /** 0110: the groundbait working on this spot (its item), or null. */
  groundbait?: string | null;
  state: FishingState;
}

/** 0059: a hooked cast given up by casting again — the hook's wear, or a big fish's overboard cost without the fall. */
export interface Abandoned { rod: string; big: boolean; rodLost: boolean; hunger: number; rodBroke: boolean }
function parseAbandoned(v: unknown): Abandoned | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  return {
    rod: String(o.rod ?? "rod_wood"), big: o.big === true, rodLost: o.rod_lost === true, hunger: Number(o.hunger ?? 0),
    rodBroke: o.rod_broke === true,
  };
}

/** 0059's server-timed hook: the reel's seed, or why not (the cast then ends as a miss). */
export type HookCast =
  | { result: "hooked"; seed: number; state: FishingState }
  | { result: "lost"; why: "too_early" | "missed" | "no_bite" | "outdated"; state: FishingState; anticheat: AnticheatInfo | null };
const HOOK_WHYS = ["too_early", "missed", "no_bite", "outdated"] as const;

export async function hookCast(token: string, castId: string): Promise<HookCast> {
  const r = await call("hook_cast", { p_session_token: token, p_cast_id: castId });
  const state = stateOf(r.state);
  if (r.result === "hooked" && r.reel_seed != null) return { result: "hooked", seed: Number(r.reel_seed) >>> 0, state };
  const why = (HOOK_WHYS as readonly unknown[]).includes(r.why) ? (r.why as (typeof HOOK_WHYS)[number]) : "missed";
  return { result: "lost", why, state, anticheat: parseAnticheat(r) };
}

/** `cell` (v18.1): the 8-px cell of the pond map the cast starts from; the server checks it is a dock or shore cell. */
export async function startCast(roomId: string, token: string, cell?: { col: number; row: number }): Promise<StartCast> {
  const args: Record<string, unknown> = { p_room_id: roomId, p_session_token: token };
  if (cell) {
    args.p_col = cell.col;
    args.p_row = cell.row;
  }
  const r = await call("start_cast", args);
  publishVitals(r.vitals);                                                     // 0047: the cast's hunger/thirst cost
  return {
    castId: String(r.cast_id), biteMs: Number(r.bite_ms), windowMs: Number(r.window_ms), difficulty: Number(r.difficulty),
    minReelMs: Number(r.min_reel_ms), zonePct: Number(r.zone_pct), rarity: isRarity(r.rarity) ? r.rarity : null,
    baitSwitched: r.bait_switched === true, spot: r.spot === "shore" ? "shore" : "dock", bites: r.bites !== false,
    reelSeed: r.reel_seed == null ? null : Number(r.reel_seed) >>> 0, serverHook: "abandoned" in r,
    abandoned: parseAbandoned(r.abandoned), groundbait: typeof r.groundbait === "string" ? r.groundbait : null, state: stateOf(r.state),
  };
}

export interface CaughtFish { id: string; speciesId: string; weightG: number; price: number; rarity: Rarity }
export type LostWhy = "expired" | "gave_up" | "too_early" | "full" | "no_bite" | "overboard" | "reel_invalid" | "outdated"
  /** 0110: a won reel's fish heavier than the rig's weakest part. */
  | "line_snap" | "rod_snap";
/** 0110: what broke: the fish, its weight, the limit, and whether the line is gone (its last snap). */
export interface Snap { speciesId: string; weightG: number; limitG: number; lineGone: boolean }
/** v18.1: what falling into the pond cost: the rod (lost or not) and the hunger taken. */
export interface Overboard { rod: string; rodLost: boolean; hunger: number }
/** `rodBroke` (v18.2): the cast wore the rod down to 0 (it is unequipped; absent from an older server = false). */
export type FinishCast =
  /** `extra` (0110): the multi-hook's other fish landed with it. */
  | { result: "caught"; fish: CaughtFish; record: boolean; state: FishingState; rodBroke?: boolean; extra?: CaughtFish[] }
  /** `anticheat`: the envelope of a reel reported too fast (finishCast always sets it; null when there is none).
   *  `overboard` (v18.1): set when why is "overboard". */
  | { result: "lost"; why: LostWhy; state: FishingState; anticheat?: AnticheatInfo | null; overboard?: Overboard; rodBroke?: boolean;
      /** 0110: set when why is line_snap / rod_snap. */
      snap?: Snap };

const LOST_WHYS: readonly LostWhy[] = ["expired", "too_early", "full", "no_bite", "overboard", "reel_invalid", "outdated",
  "line_snap", "rod_snap"];

/** The reel's input for the server's replay (0046): the ticks where the hold flipped, and the tick it ended on. */
export interface ReelInput { toggles: number[]; ticks: number; used?: { zonePct: number; difficulty: number; minReelMs: number } }

/** `hooked` (v18.1): the fish was hooked and the reel lost — a big fish may pull me in. Sent only when true.
 *  `reel` (0046): the reel's input; the server replays it and decides the catch itself. */
export async function finishCast(token: string, castId: string, success: boolean, hooked = false, reel?: ReelInput): Promise<FinishCast> {
  const args: Record<string, unknown> = { p_session_token: token, p_cast_id: castId, p_success: success };
  if (hooked) args.p_hooked = true;
  if (reel) {
    args.p_inputs = reel.toggles;
    args.p_ticks = reel.ticks;
    // 0108: what the reel simulated with; the server compares it with the cast's params
    // the 7-arg form has no defaults: p_hooked must ride along (PostgREST matches overloads by argument names)
    if (reel.used) {
      args.p_hooked = hooked;
      args.p_client = { zone_pct: reel.used.zonePct, difficulty: reel.used.difficulty, min_reel_ms: reel.used.minReelMs };
    }
  }
  const r = await call("finish_cast", args);
  const state = stateOf(r.state);
  const rodBroke = r.rod_broke === true;
  if (r.result === "caught" && r.fish && typeof r.fish === "object") {
    const f = r.fish as Record<string, unknown>;
    const extra = netFish(r.extra);                                            // 0110: the multi-hook's other fish
    return {
      result: "caught", record: r.record === true, state, ...(rodBroke ? { rodBroke } : {}), ...(extra.length ? { extra } : {}),
      fish: {
        id: String(f.id), speciesId: String(f.species_id), weightG: Number(f.weight_g), price: Number(f.price),
        rarity: isRarity(f.rarity) ? f.rarity : 1,
      },
    };
  }
  const why: LostWhy = (LOST_WHYS as readonly unknown[]).includes(r.why) ? (r.why as LostWhy) : "gave_up";
  const lost: FinishCast = { result: "lost", why, state, anticheat: parseAnticheat(r), ...(rodBroke ? { rodBroke } : {}) };
  if (why === "overboard") {
    const o = (r.overboard && typeof r.overboard === "object" ? r.overboard : {}) as Record<string, unknown>;
    lost.overboard = { rod: String(o.rod ?? "rod_wood"), rodLost: o.rod_lost === true, hunger: Number(o.hunger ?? 5) };   // econ v2: 5
  }
  if ((why === "line_snap" || why === "rod_snap") && r.snap && typeof r.snap === "object") {   // 0110
    const o = r.snap as Record<string, unknown>;
    lost.snap = { speciesId: String(o.species_id ?? ""), weightG: Number(o.weight_g ?? 0), limitG: Number(o.limit_g ?? 0), lineGone: o.line_gone === true };
  }
  return lost;
}

/** What a sale answered: the fish sold, the xu paid, and (econ v2, 0101) the xu the thương lái kept back and its day after
 *  the sale (null from a server before econ v2). */
export interface FishSale { sold: number; earned: number; npcCut: number; npc: NpcQuota | null; state: FishingState }

/** Sells fish to cô Ba at the pond, or (`market`, v18.5) to Vựa cá Chợ Lớn, which pays +10% (econ v2). Both pay through the
 *  thương lái (0101): the day's first npc_full xu of fish at full price, then less. */
export async function sellFish(token: string, ids: string[], market = false): Promise<FishSale> {
  const r = await call(market ? "sell_fish_market" : "sell_fish", { p_session_token: token, p_fish_ids: ids });
  return {
    sold: Number(r.sold ?? 0), earned: Number(r.earned ?? 0), npcCut: Math.max(0, Number(r.npc_cut ?? 0) || 0), npc: parseNpcQuota(r.npc),
    state: stateOf(r.state),
  };
}

export async function releaseFish(token: string, id: string): Promise<FishingState> {
  return stateOf((await call("release_fish", { p_session_token: token, p_fish_id: id })).state);
}

export interface FishingBoard {
  records: Array<{ speciesId: string; username: string; weightG: number }>;
  mine: Array<{ speciesId: string; weightG: number }>;
  richest: Array<{ username: string; coins: number }>;
  myRank: number;
  myCoins: number;
  /** The room's fish price index (economy spec §5); null from a server without it. */
  prices: FishPrices | null;
  /** econ v2 (0101): my thương lái day (the "Giá cá" tab's line); null from a server before it. */
  npc: NpcQuota | null;
}

export async function fetchFishingBoard(roomId: string, token: string): Promise<FishingBoard> {
  const r = await call("fishing_board", { p_room_id: roomId, p_session_token: token });
  const list = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []);
  return {
    records: list(r.records).map((x) => ({ speciesId: String(x.species_id), username: String(x.username), weightG: Number(x.weight_g) })),
    mine: list(r.mine).map((x) => ({ speciesId: String(x.species_id), weightG: Number(x.weight_g) })),
    richest: list(r.richest).map((x) => ({ username: String(x.username), coins: Number(x.coins) })),
    myRank: Number(r.my_rank ?? 1),
    myCoins: Number(r.my_coins ?? 0),
    prices: parseFishPrices(r.prices),
    npc: parseNpcQuota(r.npc),
  };
}

/** Vietnamese toast text for a fishing RPC error (spec §8.6). */
export function fishingErrorMessage(err: unknown): string {
  const e = (err && typeof err === "object" ? err : {}) as { message?: unknown; details?: unknown };
  const msg = typeof e.message === "string" ? e.message : "";
  const v = vitalsErrorMessage(msg);
  if (v) return v;
  if (msg === "storm") return STORM_TEXT;
  const pos = positionErrorText(msg);                                          // 0057: a refused position claim
  if (pos) return pos;
  if (msg === "bad spot") return BAD_SPOT;
  const extra = extrasErrorText(msg);                                          // v21 (0076)
  if (extra) return extra;
  // PostgREST's "function not found" (a migration not yet run on the server): say so instead of blaming the network
  if ((e as { code?: unknown }).code === "PGRST202" || msg.includes("Could not find the function")) {
    return "Máy chủ chưa cập nhật tính năng này (thiếu migration).";
  }
  const secs = Number(e.details);
  switch (msg) {
    case "not enough coins": return "Không đủ xu.";
    case "already owned": return "Bạn có món này rồi.";
    case "item not available":
    case "invalid quantity": return "Món này không mua được.";
    case "bait full": return "Hộp mồi đầy rồi.";
    case "no bait": return "Hết mồi — đào trùn hoặc mua mồi ở tiệm nhé.";
    case "hands full": return "Tay đang cầm cá — ra vựa bán hoặc sắm xô nhé!";
    case "bucket full": return "Xô đầy rồi — ra vựa bán bớt nhé!";
    case "cast limit":
      // an old server's hourly cap (0047 removed it)
      return `Câu mệt rồi — nghỉ chút nhé (còn ${Number.isFinite(secs) ? Math.max(1, Math.ceil(secs / 60)) : 60} phút).`;
    case "dig cooldown": return `Đất còn cứng, chờ ${Number.isFinite(secs) ? Math.max(1, secs) : 45} giây nữa nhé.`;
    case "cast not found": return "Cá đã thoát mất rồi.";
    case "fish not found": return "Con cá này không còn nữa.";
    case "account locked": return lockText(lockSeconds(err) ?? 300);
    case "rate limited": return "Thao tác quá nhanh — chờ một chút rồi thử lại nhé.";                                    // 0108
    case "daily cast limit": return DAILY_LIMIT_TEXT;
    case "rod broken": return "Cần này gãy rồi — mang tới tiệm chú Tư sửa nhé.";
    case "rod needs parts": return NEEDS_PARTS;                                                                  // 0110
    case "bad slot": return "Không lắp được món này vào đây.";                                                   // 0110
    case "no groundbait": return "Hết thính loại này — tiệm chú Tư có bán.";                                    // 0110
    case "groundbait full": return "Mỗi loại thính chỉ giữ được 99 bao.";                                       // 0110
    case "spot full": return `Ổ thính này đã đậm rồi (tối đa ${GROUNDBAIT_CAP_MINUTES} phút) — để dành bao thính nhé.`;      // 0117
    case "too many spots": return `Chỗ này đã có ${GROUNDBAIT_ROOM_LIMIT} ổ thính — rải vào một ổ có sẵn hoặc chờ ổ cũ tan.`; // 0117
    case "spot limit": return `Mỗi người chỉ mở được ${GROUNDBAIT_PLAYER_LIMIT} ổ thính một lúc — chờ ổ cũ tan, hoặc rải thêm vào ổ cũ.`; // 0117
    case "no notebook": return "Bạn chưa có Sổ tay câu cá — tiệm chú Tư có bán.";                              // 0110
    case "not worn": return "Cần còn tốt, chưa cần sửa.";
    case "rod build": return "Đồ câu giờ lắp theo từng cây cần — mở Giỏ đồ › Cần câu.";                       // 0115
    case "rod not found": return "Không thấy cây cần này trong giỏ.";                                           // 0115
    case "rod fixed": return "Cần gỗ có sẵn lưỡi và dây — chỉ thay được phao.";                                // 0115
    case "rod equipped": return "Đang dùng cây cần này — đổi sang cần khác trước đã.";                          // 0115
    case "slot empty": return "Chỗ này chưa lắp gì.";                                                           // 0115
    case "bag full": return "Giỏ đầy rồi (tối đa 20 cần, 99 món mỗi loại).";                                    // 0115
    case "name too long": return "Tên cần tối đa 24 chữ.";                                                       // 0115
    case "no net": return "Bạn chưa có lưới — tiệm chú Tư có bán.";
    case "throw not found": return "Lưới đã trôi mất rồi.";
  }
  if (msg.includes("invalid session")) return "Phiên đăng nhập đã hết hạn — hãy đăng nhập lại.";
  if (msg.includes("account banned")) return "Tài khoản đã bị khoá.";
  if (msg.includes("not a member")) return "Bạn không còn ở trong phòng này.";
  return "Có lỗi, thử lại nhé.";
}
