import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, type Room, type Member, type QueueItem } from "@/lib/supabase";

export interface RoomState { room: Room | null; members: Member[]; queue: QueueItem[]; }

async function fetchRoomState(roomId: string): Promise<RoomState> {
  const [roomRes, membersRes, queueRes] = await Promise.all([
    supabase.from("rooms").select("*").eq("id", roomId).maybeSingle(),
    supabase.from("members").select("*").eq("room_id", roomId).order("joined_at"),
    supabase.from("queue_items").select("*").eq("room_id", roomId).order("position"),
  ]);
  return {
    room: (roomRes.data as Room) ?? null,
    members: (membersRes.data as Member[]) ?? [],
    queue: (queueRes.data as QueueItem[]) ?? [],
  };
}

/** Subscribe to room-scoped changes; re-fetch + push fresh state on any change. */
export function subscribeRoom(roomId: string, onState: (s: RoomState) => void): () => void {
  let cancelled = false;
  const refresh = async () => {
    const state = await fetchRoomState(roomId);
    if (!cancelled) onState(state);
  };
  const channel: RealtimeChannel = supabase
    .channel(`room:${roomId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "queue_items", filter: `room_id=eq.${roomId}` }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "members", filter: `room_id=eq.${roomId}` }, refresh)
    .subscribe((status) => { if (status === "SUBSCRIBED") void refresh(); });
  return () => { cancelled = true; void supabase.removeChannel(channel); };
}

/** Realtime Presence: online member ids, keyed by member id. */
export function trackPresence(
  roomId: string, me: { memberId: string; name: string }, onOnline: (ids: string[]) => void,
): () => void {
  const channel = supabase.channel(`presence:${roomId}`, { config: { presence: { key: me.memberId } } });
  const emit = () => onOnline(Object.keys(channel.presenceState()));
  channel
    .on("presence", { event: "sync" }, emit)
    .on("presence", { event: "join" }, emit)
    .on("presence", { event: "leave" }, emit)
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ name: me.name, online_at: new Date().toISOString() });
      }
    });
  return () => { void supabase.removeChannel(channel); };
}
