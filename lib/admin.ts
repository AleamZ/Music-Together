import { supabase } from "@/lib/supabase";

export interface FeedbackRow { id: string; account_id: string | null; username: string; category: string; message: string; status: "new" | "handled"; created_at: string; }
export interface AdminRoom { id: string; code: string; name: string; is_playing: boolean; created_at: string; creator: string | null; member_count: number; }
export interface AdminAccount { id: string; username: string; is_root: boolean; is_banned: boolean; created_at: string; }
export interface AdminStats { total_rooms: number; total_accounts: number; feedback_new: number; feedback_total: number; }

const rows = <T>(d: unknown): T[] => (Array.isArray(d) ? (d as T[]) : []);
const one = <T>(d: unknown): T => (Array.isArray(d) ? (d as T[])[0] : (d as T));

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
  return one<AdminStats>(data);
}
