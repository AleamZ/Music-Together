import { supabase } from "@/lib/supabase";
import { isRarity, shopItemFromRow, speciesFromRow, type FishingCatalog, type Rarity, type ShopItemRow, type SpeciesRow } from "./catalog";
import { parseFishingState, type FishingState, type Loadout } from "./state";

// Supabase calls for the fishing RPCs (spec §8.3). Every answer carries the account's full state.

let catalogPromise: Promise<FishingCatalog> | null = null;

/** Species + shop items, cached per page load (a failed fetch is retried on the next call). */
export function fetchFishingCatalog(): Promise<FishingCatalog> {
  if (!catalogPromise) {
    catalogPromise = (async () => {
      const [sp, it] = await Promise.all([
        supabase.from("fish_species").select("*").order("sort_order"),
        supabase.from("shop_items").select("*").order("kind").order("sort_order"),
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

async function call(fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
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

export async function setLoadout(token: string, l: Loadout): Promise<FishingState> {
  return stateOf((await call("set_loadout", { p_session_token: token, p_rod: l.rod, p_bobber: l.bobber, p_bait: l.bait })).state);
}

export interface StartCast {
  castId: string; biteMs: number; windowMs: number; difficulty: number; minReelMs: number; zonePct: number;
  /** Only when the bobber shows it. */
  rarity: Rarity | null;
  baitSwitched: boolean;
  state: FishingState;
}

export async function startCast(roomId: string, token: string): Promise<StartCast> {
  const r = await call("start_cast", { p_room_id: roomId, p_session_token: token });
  return {
    castId: String(r.cast_id), biteMs: Number(r.bite_ms), windowMs: Number(r.window_ms), difficulty: Number(r.difficulty),
    minReelMs: Number(r.min_reel_ms), zonePct: Number(r.zone_pct), rarity: isRarity(r.rarity) ? r.rarity : null,
    baitSwitched: r.bait_switched === true, state: stateOf(r.state),
  };
}

export interface CaughtFish { id: string; speciesId: string; weightG: number; price: number; rarity: Rarity }
export type LostWhy = "expired" | "gave_up" | "too_early" | "full";
export type FinishCast =
  | { result: "caught"; fish: CaughtFish; record: boolean; state: FishingState }
  | { result: "lost"; why: LostWhy; state: FishingState };

export async function finishCast(token: string, castId: string, success: boolean): Promise<FinishCast> {
  const r = await call("finish_cast", { p_session_token: token, p_cast_id: castId, p_success: success });
  const state = stateOf(r.state);
  if (r.result === "caught" && r.fish && typeof r.fish === "object") {
    const f = r.fish as Record<string, unknown>;
    return {
      result: "caught", record: r.record === true, state,
      fish: {
        id: String(f.id), speciesId: String(f.species_id), weightG: Number(f.weight_g), price: Number(f.price),
        rarity: isRarity(f.rarity) ? f.rarity : 1,
      },
    };
  }
  const why: LostWhy = r.why === "expired" || r.why === "too_early" || r.why === "full" ? r.why : "gave_up";
  return { result: "lost", why, state };
}

export async function sellFish(token: string, ids: string[]): Promise<{ sold: number; earned: number; state: FishingState }> {
  const r = await call("sell_fish", { p_session_token: token, p_fish_ids: ids });
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
  };
}

/** Vietnamese toast text for a fishing RPC error (spec §8.6). */
export function fishingErrorMessage(err: unknown): string {
  const e = (err && typeof err === "object" ? err : {}) as { message?: unknown; details?: unknown };
  const msg = typeof e.message === "string" ? e.message : "";
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
      return `Câu nhiều quá rồi, nghỉ tay chút nhé (còn ${Number.isFinite(secs) ? Math.max(1, Math.ceil(secs / 60)) : 60} phút).`;
    case "dig cooldown": return `Đất còn cứng, chờ ${Number.isFinite(secs) ? Math.max(1, secs) : 45} giây nữa nhé.`;
    case "cast not found": return "Cá đã thoát mất rồi.";
    case "fish not found": return "Con cá này không còn nữa.";
  }
  if (msg.includes("invalid session")) return "Phiên đăng nhập đã hết hạn — hãy đăng nhập lại.";
  if (msg.includes("account banned")) return "Tài khoản đã bị khoá.";
  if (msg.includes("not a member")) return "Bạn không còn ở trong phòng này.";
  return "Có lỗi, thử lại nhé.";
}
