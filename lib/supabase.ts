import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Identity } from "@/lib/identity";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

/** Single shared client => one Realtime socket for the whole app.
 *  Uses @supabase/supabase-js (NOT @supabase/ssr): anon access + Realtime, no auth cookies. */
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
export interface Member { id: string; room_id: string; name: string; joined_at: string; }
export interface QueueItem {
  id: string; room_id: string; youtube_video_id: string; title: string;
  thumbnail_url: string | null; duration_seconds: number | null;
  added_by_member_id: string | null; added_by_name: string;
  position: number; created_at: string;
}

export async function createRoom(roomName: string, password: string, userName: string) {
  const { data, error } = await supabase.rpc("create_room", {
    p_room_name: roomName, p_password: password, p_user_name: userName,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) as
    { code: string; room_id: string; member_id: string; token: string };
}

export async function joinRoom(code: string, userName: string, password: string) {
  const { data, error } = await supabase.rpc("join_room", {
    p_code: code, p_user_name: userName, p_password: password,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) as
    { room_id: string; member_id: string; token: string };
}

export async function addQueueItem(
  id: Identity,
  v: { videoId: string; title: string; thumb: string | null; duration: number | null },
) {
  const { error } = await supabase.rpc("add_queue_item", {
    p_room_id: id.roomId, p_member_id: id.memberId, p_token: id.token,
    p_video_id: v.videoId, p_title: v.title, p_thumb: v.thumb, p_duration: v.duration,
  });
  if (error) throw error;
}

export async function advanceQueue(id: Identity) {
  const { error } = await supabase.rpc("advance_queue", {
    p_room_id: id.roomId, p_member_id: id.memberId, p_token: id.token,
  });
  if (error) throw error;
}

export async function setPlayback(
  id: Identity, p: { isPlaying: boolean; startedAt: string | null; pausedElapsedMs: number },
) {
  const { error } = await supabase.rpc("set_playback", {
    p_room_id: id.roomId, p_member_id: id.memberId, p_token: id.token,
    p_is_playing: p.isPlaying, p_started_at: p.startedAt, p_paused_elapsed_ms: p.pausedElapsedMs,
  });
  if (error) throw error;
}

export async function seekPlayback(id: Identity, positionMs: number) {
  const { error } = await supabase.rpc("seek_playback", {
    p_room_id: id.roomId, p_member_id: id.memberId, p_token: id.token, p_position_ms: positionMs,
  });
  if (error) throw error;
}

export async function bumpToTop(id: Identity, itemId: string) {
  const { error } = await supabase.rpc("bump_to_top", {
    p_room_id: id.roomId, p_member_id: id.memberId, p_token: id.token, p_item_id: itemId,
  });
  if (error) throw error;
}

export async function reorderItem(id: Identity, itemId: string, newPosition: number) {
  const { error } = await supabase.rpc("reorder_item", {
    p_room_id: id.roomId, p_member_id: id.memberId, p_token: id.token,
    p_item_id: itemId, p_new_position: newPosition,
  });
  if (error) throw error;
}

export async function deleteItem(id: Identity, itemId: string) {
  const { error } = await supabase.rpc("delete_item", {
    p_room_id: id.roomId, p_member_id: id.memberId, p_token: id.token, p_item_id: itemId,
  });
  if (error) throw error;
}

export async function setPlayMode(id: Identity, mode: PlayMode) {
  const { error } = await supabase.rpc("set_play_mode", {
    p_room_id: id.roomId, p_member_id: id.memberId, p_token: id.token, p_play_mode: mode,
  });
  if (error) throw error;
}

export async function assignDj(id: Identity, targetMemberId: string | null) {
  const { error } = await supabase.rpc("assign_dj", {
    p_room_id: id.roomId, p_member_id: id.memberId, p_token: id.token, p_target_member: targetMemberId,
  });
  if (error) throw error;
}

export async function transferAdmin(id: Identity, targetMemberId: string) {
  const { error } = await supabase.rpc("transfer_admin", {
    p_room_id: id.roomId, p_member_id: id.memberId, p_token: id.token, p_target_member: targetMemberId,
  });
  if (error) throw error;
}

export async function kickMember(id: Identity, targetMemberId: string) {
  const { error } = await supabase.rpc("kick_member", {
    p_room_id: id.roomId, p_member_id: id.memberId, p_token: id.token, p_target_member: targetMemberId,
  });
  if (error) throw error;
}

export async function renameRoom(id: Identity, newName: string) {
  const { error } = await supabase.rpc("rename_room", {
    p_room_id: id.roomId, p_member_id: id.memberId, p_token: id.token, p_new_name: newName,
  });
  if (error) throw error;
}
