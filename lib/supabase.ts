import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

export const supabase: SupabaseClient = createClient(url, publishableKey, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 5 } },
});

export type PlayMode = "order" | "shuffle";
export interface Room {
  id: string; code: string; name: string; play_mode: PlayMode;
  admin_member_id: string | null; dj_member_id: string | null;
  current_item_id: string | null; is_playing: boolean;
  started_at: string | null; paused_elapsed_ms: number; created_at: string;
}
export interface Member { id: string; room_id: string; account_id: string; joined_at: string; username?: string; }
export interface QueueItem {
  id: string; room_id: string; youtube_video_id: string; title: string;
  thumbnail_url: string | null; duration_seconds: number | null;
  added_by_account_id: string | null; added_by_name: string;
  position: number; created_at: string;
}

export async function createRoom(roomName: string, password: string, token: string) {
  const { data, error } = await supabase.rpc("create_room", { p_room_name: roomName, p_password: password, p_session_token: token });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) as { code: string; room_id: string; member_id: string };
}
export async function joinRoom(code: string, password: string, token: string) {
  const { data, error } = await supabase.rpc("join_room", { p_code: code, p_password: password, p_session_token: token });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) as { room_id: string; member_id: string };
}
export async function addQueueItem(roomId: string, token: string, v: { videoId: string; title: string; thumb: string | null; duration: number | null }) {
  const { error } = await supabase.rpc("add_queue_item", { p_room_id: roomId, p_session_token: token, p_video_id: v.videoId, p_title: v.title, p_thumb: v.thumb, p_duration: v.duration });
  if (error) throw error;
}
export async function addQueueItems(
  roomId: string, token: string,
  items: Array<{ videoId: string; title: string; thumb: string | null }>,
): Promise<number> {
  const payload = items.map((it) => ({ video_id: it.videoId, title: it.title, thumb: it.thumb }));
  const { data, error } = await supabase.rpc("add_queue_items", { p_room_id: roomId, p_session_token: token, p_items: payload });
  if (error) throw error;
  return typeof data === "number" ? data : Number(data ?? 0);
}
export async function advanceQueue(roomId: string, token: string) {
  const { error } = await supabase.rpc("advance_queue", { p_room_id: roomId, p_session_token: token });
  if (error) throw error;
}
export async function setPlayback(roomId: string, token: string, p: { isPlaying: boolean; startedAt: string | null; pausedElapsedMs: number }) {
  const { error } = await supabase.rpc("set_playback", { p_room_id: roomId, p_session_token: token, p_is_playing: p.isPlaying, p_started_at: p.startedAt, p_paused_elapsed_ms: p.pausedElapsedMs });
  if (error) throw error;
}
export async function seekPlayback(roomId: string, token: string, positionMs: number) {
  const { error } = await supabase.rpc("seek_playback", { p_room_id: roomId, p_session_token: token, p_position_ms: positionMs });
  if (error) throw error;
}
export async function bumpToTop(roomId: string, token: string, itemId: string) {
  const { error } = await supabase.rpc("bump_to_top", { p_room_id: roomId, p_session_token: token, p_item_id: itemId });
  if (error) throw error;
}
export async function reorderItem(roomId: string, token: string, itemId: string, newPosition: number) {
  const { error } = await supabase.rpc("reorder_item", { p_room_id: roomId, p_session_token: token, p_item_id: itemId, p_new_position: newPosition });
  if (error) throw error;
}
export async function deleteItem(roomId: string, token: string, itemId: string) {
  const { error } = await supabase.rpc("delete_item", { p_room_id: roomId, p_session_token: token, p_item_id: itemId });
  if (error) throw error;
}
export async function setPlayMode(roomId: string, token: string, mode: PlayMode) {
  const { error } = await supabase.rpc("set_play_mode", { p_room_id: roomId, p_session_token: token, p_play_mode: mode });
  if (error) throw error;
}
export async function assignDj(roomId: string, token: string, targetMemberId: string | null) {
  const { error } = await supabase.rpc("assign_dj", { p_room_id: roomId, p_session_token: token, p_target_member: targetMemberId });
  if (error) throw error;
}
export async function transferAdmin(roomId: string, token: string, targetMemberId: string) {
  const { error } = await supabase.rpc("transfer_admin", { p_room_id: roomId, p_session_token: token, p_target_member: targetMemberId });
  if (error) throw error;
}
export async function kickMember(roomId: string, token: string, targetMemberId: string) {
  const { error } = await supabase.rpc("kick_member", { p_room_id: roomId, p_session_token: token, p_target_member: targetMemberId });
  if (error) throw error;
}
export async function renameRoom(roomId: string, token: string, newName: string) {
  const { error } = await supabase.rpc("rename_room", { p_room_id: roomId, p_session_token: token, p_new_name: newName });
  if (error) throw error;
}
