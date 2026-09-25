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
  plots: unknown[]; leases: unknown[]; offers: unknown[]; crops: unknown[]; drying: unknown[];
  /** Catch and land lines about the account in the chat. */
  announcements: number;
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
