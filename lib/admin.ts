import { supabase } from "@/lib/supabase";

export interface FeedbackRow { id: string; account_id: string | null; username: string; category: string; message: string; status: "new" | "handled"; created_at: string; }
export interface AdminRoom { id: string; code: string; name: string; is_playing: boolean; created_at: string; creator: string | null; member_count: number; }
export interface AdminAccount { id: string; username: string; is_root: boolean; is_banned: boolean; created_at: string; }
export interface AdminStats { total_rooms: number; total_accounts: number; feedback_new: number; feedback_total: number; }

/** The anti-cheat tab (anti-cheat spec §10.5, §12.5). */
export type AnticheatMode = "log" | "enforce";
export interface AnticheatCase {
  account_id: string; username: string; is_root: boolean; is_banned: boolean;
  strikes: number; active_strikes: number; last_strike_at: string | null; last_strike_code: string | null;
  /** Only while the lock runs. */
  locked_until: string | null;
  ban_state: "pending_wipe" | "wiped" | null; banned_at: string | null; wiped_at: string | null; pardoned_at: string | null;
  hard_events: number; soft_events: number; last_event_at: string | null;
}
export interface AnticheatList { mode: AnticheatMode; mode_changed_at: string | null; server_now: string; cases: AnticheatCase[]; }
/** What a wipe would remove (the same JSON is a wipe's snapshot). */
export interface AnticheatHoldings {
  wallet: { coins: number } | null;
  inventory: Array<{ item_id: string; qty: number }>;
  fish: unknown[]; personal_bests: unknown[];
  rice: Array<{ variety: string; wet_kg: number; dry_kg: number }>;
  /** v15.2 (`0016`): the hoa màu and the sprayer's tank; older answers lack them. */
  produce?: Array<{ upland: string; kg: number }>;
  tank?: { item: string | null; charges: number } | null;
  /** v15.3 (`0018`): the critters held, per kind (count and what cô Út pays); older answers lack them. */
  critters?: Array<{ kind: string; n: number; xu: number }>;
  /** v17 (`0019`): the dog and the rats in the bag; older answers lack them. */
  dog?: { name: string } | null;
  rats?: { count: number; value: number };
  plots: unknown[]; leases: unknown[]; offers: unknown[]; crops: unknown[]; drying: unknown[];
  /** Catch and land lines about the account in the chat. */
  announcements: number;
  /** v16: the account's seats at the card tables, with their stacks and balances (absent before 0017). */
  cards?: Array<{ room_id: string; game: string; seat: number; chips: number; escrow: number }>;
}
export interface AnticheatEventRow {
  id: number; created_at: string; code: string; outcome: string; rpc: string; room_id: string | null; detail: unknown;
  client: string | null; user_agent: string | null;
}
export interface AnticheatWipe { id: number; wiped_at: string; wiped_by: string | null; snapshot: unknown; }
export interface AnticheatAccount { case: AnticheatCase | null; holdings: AnticheatHoldings; events: AnticheatEventRow[]; wipes: AnticheatWipe[]; }

const rows = <T>(d: unknown): T[] => (Array.isArray(d) ? (d as T[]) : []);
const one = <T>(d: unknown): T | undefined => (Array.isArray(d) ? (d as T[])[0] : (d as T));

export async function listFeedback(token: string): Promise<FeedbackRow[]> {
  const { data, error } = await supabase.rpc("list_feedback", { p_session_token: token });
  if (error) throw error;
  return rows<FeedbackRow>(data);
}
export async function setFeedbackStatus(token: string, id: string, status: "new" | "handled"): Promise<void> {
  const { error } = await supabase.rpc("set_feedback_status", { p_session_token: token, p_id: id, p_status: status });
  if (error) throw error;
}
export async function deleteFeedback(token: string, id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_feedback", { p_session_token: token, p_id: id });
  if (error) throw error;
}
export async function adminListRooms(token: string): Promise<AdminRoom[]> {
  const { data, error } = await supabase.rpc("admin_list_rooms", { p_session_token: token });
  if (error) throw error;
  return rows<AdminRoom>(data);
}
export async function adminDeleteRoom(token: string, roomId: string): Promise<void> {
  const { error } = await supabase.rpc("admin_delete_room", { p_session_token: token, p_room_id: roomId });
  if (error) throw error;
}
export async function adminListAccounts(token: string): Promise<AdminAccount[]> {
  const { data, error } = await supabase.rpc("admin_list_accounts", { p_session_token: token });
  if (error) throw error;
  return rows<AdminAccount>(data);
}
export async function adminSetBan(token: string, accountId: string, banned: boolean): Promise<void> {
  const { error } = await supabase.rpc("admin_set_ban", { p_session_token: token, p_account_id: accountId, p_banned: banned });
  if (error) throw error;
}
export async function adminDeleteAccount(token: string, accountId: string): Promise<void> {
  const { error } = await supabase.rpc("admin_delete_account", { p_session_token: token, p_account_id: accountId });
  if (error) throw error;
}
export async function adminStats(token: string): Promise<AdminStats> {
  const { data, error } = await supabase.rpc("admin_stats", { p_session_token: token });
  if (error) throw error;
  const s = one<AdminStats>(data);
  if (!s) throw new Error("admin_stats returned no data");
  return s;
}
export async function adminAnticheatList(token: string): Promise<AnticheatList> {
  const { data, error } = await supabase.rpc("admin_anticheat_list", { p_session_token: token });
  if (error) throw error;
  return data as AnticheatList;
}
export async function adminAnticheatAccount(token: string, accountId: string): Promise<AnticheatAccount> {
  const { data, error } = await supabase.rpc("admin_anticheat_account", { p_session_token: token, p_account_id: accountId });
  if (error) throw error;
  return data as AnticheatAccount;
}
export async function adminAnticheatResolve(token: string, accountId: string, action: "wipe" | "pardon"): Promise<AnticheatCase> {
  const { data, error } = await supabase.rpc("admin_anticheat_resolve", { p_session_token: token, p_account_id: accountId, p_action: action });
  if (error) throw error;
  return data as AnticheatCase;
}
export async function adminAnticheatSetMode(token: string, mode: AnticheatMode): Promise<{ mode: AnticheatMode; mode_changed_at: string }> {
  const { data, error } = await supabase.rpc("admin_anticheat_set_mode", { p_session_token: token, p_mode: mode });
  if (error) throw error;
  return data as { mode: AnticheatMode; mode_changed_at: string };
}

// Anti-cheat v2 part 3 (0064, 0065): the switches, the statistics flags and the blacklist.
export interface AnticheatConfig {
  mode: AnticheatMode;
  /** 0 = off; else a page whose build number is lower earns nothing ("Cập nhật trang"). */
  min_client_build: number;
  auto_blacklist: boolean;
  auto_blacklist_hard: number;
  stats_enabled: boolean;
  stats_every_min: number;
  /** The build number of the page that asked (the admin's own). */
  server_build: number;
  /** 0108: calls per minute per account — past the soft line a soft rate_high, at the block line refused (absent before 0108). */
  rate_soft_per_min?: number;
  rate_block_per_min?: number;
  /** 0109: the silent bot score — on/off, the two score lines and the share of the game's income kept at each. */
  bot_enabled?: boolean;
  bot_soft?: number;
  bot_hard?: number;
  bot_soft_pct?: number;
  bot_hard_pct?: number;
}
export interface StatFlag {
  kind: "stat_win_rate" | "stat_exact_rate" | "stat_earnings" | "stat_marathon" | string;
  key: string; value: number; baseline: number | null; n: number; detail: Record<string, unknown>;
  first_at: string; last_at: string; hits: number;
}
export interface StatAccount {
  account_id: string; username: string; is_root: boolean; is_banned: boolean;
  blacklisted: boolean; blacklist_note: string | null; blacklisted_at: string | null;
  flags: StatFlag[];
  games: Array<{ game: string; plays: number; wins: number; exact: number }>;
  income: Record<string, number>;
  hard_30d: number;
}
export interface AnticheatStats { config: AnticheatConfig; run_at: string | null; took_ms: number | null; server_now: string; accounts: StatAccount[]; }

/** The statistics answer, or an error when it is not one (an older database, a wrong answer). */
function statsOf(data: unknown): AnticheatStats {
  const s = data as Partial<AnticheatStats> | null;
  if (!s || typeof s !== "object" || !s.config || typeof s.config !== "object" || !Array.isArray(s.accounts)) {
    throw new Error("bad stats answer");
  }
  return s as AnticheatStats;
}
export async function adminAnticheatStats(token: string): Promise<AnticheatStats> {
  const { data, error } = await supabase.rpc("admin_anticheat_stats", { p_session_token: token });
  if (error) throw error;
  return statsOf(data);
}
export async function adminAnticheatStatsRun(token: string): Promise<AnticheatStats> {
  const { data, error } = await supabase.rpc("admin_anticheat_stats_run", { p_session_token: token });
  if (error) throw error;
  return statsOf(data);
}
export async function adminAnticheatConfig(token: string, patch: Partial<Omit<AnticheatConfig, "mode" | "server_build">>): Promise<AnticheatConfig> {
  const { data, error } = await supabase.rpc("admin_anticheat_config", { p_session_token: token, p_patch: patch });
  if (error) throw error;
  return data as AnticheatConfig;
}
export async function adminBlacklistSet(token: string, accountId: string, on: boolean, note?: string): Promise<{ account_id: string; blacklisted: boolean }> {
  const { data, error } = await supabase.rpc("admin_blacklist_set", { p_session_token: token, p_account_id: accountId, p_on: on, p_note: note ?? null });
  if (error) throw error;
  return data as { account_id: string; blacklisted: boolean };
}
export async function adminStatReview(token: string, accountId: string): Promise<{ account_id: string; reviewed: number }> {
  const { data, error } = await supabase.rpc("admin_stat_review", { p_session_token: token, p_account_id: accountId });
  if (error) throw error;
  return data as { account_id: string; reviewed: number };
}

// v19.4: the real-estate sales between two accounts that had traded within 30 days before (the last 90 days).
export interface EstateFlag { id: number; kind: "apt" | "lot"; no: number; price: number; appraisal: number; seller_name: string | null; buyer_name: string | null; sold_at: string }
export async function adminEstateFlags(token: string): Promise<EstateFlag[]> {
  const { data, error } = await supabase.rpc("admin_estate_flags", { p_session_token: token });
  if (error) throw error;
  const sales = (data as { sales?: unknown } | null)?.sales;
  return Array.isArray(sales) ? (sales as EstateFlag[]) : [];
}

// The silent bot score (0109): accounts scored in the last 3 days, highest first; keep_pct < 100 = their game income is
// scaled down (nothing is shown to them).
export interface BotSignals { session_h: number; hours_24: number; timing: number; rate: number; silent?: boolean }
export interface BotRow {
  account_id: string; username: string; score: number; signals: BotSignals; keep_pct: number;
  scored_at: string; exempt_until: string | null;
}
export async function adminBotList(token: string): Promise<BotRow[]> {
  const { data, error } = await supabase.rpc("admin_bot_list", { p_session_token: token });
  if (error) throw error;
  return (data ?? []) as BotRow[];
}
/** Exempts the account for 7 days (its income is never scaled until then). */
export async function adminBotClear(token: string, accountId: string): Promise<BotRow[]> {
  const { data, error } = await supabase.rpc("admin_bot_clear", { p_session_token: token, p_account_id: accountId });
  if (error) throw error;
  return (data ?? []) as BotRow[];
}

/** The signals in words (the order of the score's lines in 0109). */
export function botSignalsText(s: BotSignals): string {
  const parts = [`chơi liền ${s.session_h} giờ`, `có mặt ${s.hours_24}/24 giờ`];
  if (s.timing > 0) parts.push(`${s.timing} lần nhịp bấm như máy`);
  if (s.rate > 0) parts.push(`${s.rate} lần gọi máy chủ dồn dập`);
  if (s.silent) parts.push("không chat 7 ngày");
  return parts.join(" · ");
}
