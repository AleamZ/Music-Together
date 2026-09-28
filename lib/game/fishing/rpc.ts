import { AnticheatError, lockSeconds, lockText, parseAnticheat, screenAnswer, type AnticheatInfo } from "@/lib/anticheat";
import { supabase } from "@/lib/supabase";
import { publishVitals, vitalsErrorMessage } from "@/lib/game/vitals-rpc";
import { STORM_TEXT } from "@/lib/game/weather/rpc";
import {
  FISHING_KINDS, isRarity, shopItemFromRow, speciesFromRow, type FishingCatalog, type Rarity, type ShopItemRow, type SpeciesRow,
} from "./catalog";
import { BAD_SPOT, DAILY_LIMIT_TEXT } from "./messages";
import { parseFishPrices, type FishPrices } from "./prices";
import { parseFishingState, type FishingState, type Loadout } from "./state";

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
const ENVELOPE_ON_ANSWER = new Set(["finish_cast", "net_haul", "finish_net"]);
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
export interface StartNet { throwId: string; seed: number; radiusPx: number; state: FishingState }

export async function startNet(roomId: string, token: string, cell: { col: number; row: number }, net: string): Promise<StartNet> {
  const r = await call("start_net", { p_room_id: roomId, p_session_token: token, p_col: cell.col, p_row: cell.row, p_net: net });
  publishVitals(r.vitals);                                                     // a server before 0056 spent the effort here
  return { throwId: String(r.throw_id), seed: Number(r.seed ?? 0) >>> 0, radiusPx: Number(r.radius_px ?? 24), state: stateOf(r.state) };
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
    return { result: "lost", why: "overboard", state, overboard: { rod: "", rodLost: false, hunger: Number(o.hunger ?? 10) }, anticheat: null };
  }
  return { result: "lost", why: netWhy(r.why), state, anticheat: parseAnticheat(r) };
}
export async function setLoadout(token: string, l: Loadout): Promise<FishingState> {
  return stateOf((await call("set_loadout", { p_session_token: token, p_rod: l.rod, p_bobber: l.bobber, p_bait: l.bait })).state);
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
  /** 0046: the server-chosen reel seed (u32) finish_cast replays the reel with; null from a server before 0046. */
  reelSeed: number | null;
  state: FishingState;
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
    reelSeed: r.reel_seed == null ? null : Number(r.reel_seed) >>> 0, state: stateOf(r.state),
  };
}

export interface CaughtFish { id: string; speciesId: string; weightG: number; price: number; rarity: Rarity }
export type LostWhy = "expired" | "gave_up" | "too_early" | "full" | "no_bite" | "overboard" | "reel_invalid" | "outdated";
/** v18.1: what falling into the pond cost: the rod (lost or not) and the hunger taken. */
export interface Overboard { rod: string; rodLost: boolean; hunger: number }
/** `rodBroke` (v18.2): the cast wore the rod down to 0 (it is unequipped; absent from an older server = false). */
export type FinishCast =
  | { result: "caught"; fish: CaughtFish; record: boolean; state: FishingState; rodBroke?: boolean }
  /** `anticheat`: the envelope of a reel reported too fast (finishCast always sets it; null when there is none).
   *  `overboard` (v18.1): set when why is "overboard". */
  | { result: "lost"; why: LostWhy; state: FishingState; anticheat?: AnticheatInfo | null; overboard?: Overboard; rodBroke?: boolean };

const LOST_WHYS: readonly LostWhy[] = ["expired", "too_early", "full", "no_bite", "overboard", "reel_invalid", "outdated"];

/** The reel's input for the server's replay (0046): the ticks where the hold flipped, and the tick it ended on. */
export interface ReelInput { toggles: number[]; ticks: number }

/** `hooked` (v18.1): the fish was hooked and the reel lost — a big fish may pull me in. Sent only when true.
 *  `reel` (0046): the reel's input; the server replays it and decides the catch itself. */
export async function finishCast(token: string, castId: string, success: boolean, hooked = false, reel?: ReelInput): Promise<FinishCast> {
  const args: Record<string, unknown> = { p_session_token: token, p_cast_id: castId, p_success: success };
  if (hooked) args.p_hooked = true;
  if (reel) {
    args.p_inputs = reel.toggles;
    args.p_ticks = reel.ticks;
  }
  const r = await call("finish_cast", args);
  const state = stateOf(r.state);
  const rodBroke = r.rod_broke === true;
  if (r.result === "caught" && r.fish && typeof r.fish === "object") {
    const f = r.fish as Record<string, unknown>;
    return {
      result: "caught", record: r.record === true, state, ...(rodBroke ? { rodBroke } : {}),
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
    lost.overboard = { rod: String(o.rod ?? "rod_wood"), rodLost: o.rod_lost === true, hunger: Number(o.hunger ?? 10) };
  }
  return lost;
}

/** Sells fish to cô Ba at the pond, or (`market`, v18.5) to Vựa cá Chợ Lớn, which pays +20%. */
export async function sellFish(token: string, ids: string[], market = false): Promise<{ sold: number; earned: number; state: FishingState }> {
  const r = await call(market ? "sell_fish_market" : "sell_fish", { p_session_token: token, p_fish_ids: ids });
  return { sold: Number(r.sold ?? 0), earned: Number(r.earned ?? 0), state: stateOf(r.state) };
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
  };
}

/** Vietnamese toast text for a fishing RPC error (spec §8.6). */
export function fishingErrorMessage(err: unknown): string {
  const e = (err && typeof err === "object" ? err : {}) as { message?: unknown; details?: unknown };
  const msg = typeof e.message === "string" ? e.message : "";
  const v = vitalsErrorMessage(msg);
  if (v) return v;
  if (msg === "storm") return STORM_TEXT;
  if (msg === "bad spot") return BAD_SPOT;
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
    case "daily cast limit": return DAILY_LIMIT_TEXT;
    case "rod broken": return "Cần này gãy rồi — mang tới tiệm chú Tư sửa nhé.";
    case "not worn": return "Cần còn tốt, chưa cần sửa.";
    case "no net": return "Bạn chưa có lưới — tiệm chú Tư có bán.";
    case "throw not found": return "Lưới đã trôi mất rồi.";
  }
  if (msg.includes("invalid session")) return "Phiên đăng nhập đã hết hạn — hãy đăng nhập lại.";
  if (msg.includes("account banned")) return "Tài khoản đã bị khoá.";
  if (msg.includes("not a member")) return "Bạn không còn ở trong phòng này.";
  return "Có lỗi, thử lại nhé.";
}
