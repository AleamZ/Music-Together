import type { RealtimeChannel } from "@supabase/supabase-js";
import type { MapId } from "@/lib/game/maps/types";
import { supabase, type Room, type Member, type QueueItem } from "@/lib/supabase";
import {
  aggregatePresenceModes, presenceDelay, PRESENCE_BUDGET, type PresenceEntry, type PresenceMeta, type PresenceMode,
} from "@/lib/presence-modes";

export interface RoomState { room: Room | null; members: Member[]; queue: QueueItem[]; }

async function fetchRoomState(roomId: string): Promise<RoomState> {
  const [roomRes, membersRes, queueRes] = await Promise.all([
    supabase.from("rooms").select("*").eq("id", roomId).maybeSingle(),
    supabase.from("members").select("id, room_id, account_id, joined_at, accounts(username)").eq("room_id", roomId).order("joined_at"),
    supabase.from("queue_items").select("*").eq("room_id", roomId).order("position"),
  ]);
  type MemberWithAccount = { id: string; room_id: string; account_id: string; joined_at: string; accounts: { username: string } | null };
  const members = ((membersRes.data ?? []) as unknown as MemberWithAccount[])
    .map((m) => ({ id: m.id, room_id: m.room_id, account_id: m.account_id, joined_at: m.joined_at, username: m.accounts?.username }));
  return {
    room: (roomRes.data as Room) ?? null,
    members,
    queue: (queueRes.data as QueueItem[]) ?? [],
  };
}

/** Subscribe to room-scoped changes; re-fetch + push fresh state on any change.
 *  Refresh is trailing-debounced so a burst of postgres_changes (e.g. a 50-row
 *  batch insert) collapses into ~1 refetch instead of one per row. */
export function subscribeRoom(roomId: string, onState: (s: RoomState) => void): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const doRefresh = async () => {
    const state = await fetchRoomState(roomId);
    if (!cancelled) onState(state);
  };
  const refresh = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void doRefresh(); }, 150);
  };
  const channel: RealtimeChannel = supabase
    .channel(`room:${roomId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "queue_items", filter: `room_id=eq.${roomId}` }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "members", filter: `room_id=eq.${roomId}` }, refresh)
    .subscribe((status) => { if (status === "SUBSCRIBED") void doRefresh(); });
  return () => { cancelled = true; if (timer) clearTimeout(timer); void supabase.removeChannel(channel); };
}

export interface PresenceHandle {
  unsubscribe: () => void;
  setMode: (mode: PresenceMode) => void;
  /** The game map I walk on (v14). Published only while the mode is "game" (classic → map null). */
  setMap: (map: MapId) => void;
}

interface Published { mode: PresenceMode; map: MapId | null }

/** Realtime Presence keyed by account id. The payload also carries the member's view mode (v13) and game map (v14).
 *  track() calls are budgeted (Supabase allows 5 per 30 s): ≤ 4 calls per 30 s for mode and map changes together;
 *  a re-track after a reconnect may use the 5th. Changes within 1 s are merged, a state the server already
 *  acknowledged is never re-sent, and failed tracks are retried. */
export function trackPresence(
  roomId: string,
  me: { memberId: string; name: string; mode: PresenceMode; map?: MapId },
  onChange: (entries: PresenceEntry[]) => void,
): PresenceHandle {
  const channel = supabase.channel(`presence:${roomId}`, { config: { presence: { key: me.memberId } } });
  let mode: PresenceMode = me.mode;          // what other members should see…
  let map: MapId = me.map ?? "hall";
  let published: Published | null = null;    // …and the last state the server acknowledged with 'ok'
  const wanted = (): Published => ({ mode, map: mode === "game" ? map : null });
  const isPublished = () => published !== null && published.mode === wanted().mode && published.map === wanted().map;
  let subscribed = false;
  let closed = false;
  let sending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let sentAt: number[] = [];                 // times of recent track() calls (pruned to the budget window)
  const emit = () => onChange(aggregatePresenceModes(channel.presenceState<PresenceMeta>()));
  const schedule = (minDelay = 0, budget: { max: number; windowMs: number } = PRESENCE_BUDGET) => {
    if (closed || timer || sending) return;
    timer = setTimeout(() => { void flush(); }, Math.max(minDelay, presenceDelay(sentAt, Date.now(), budget)));
  };
  const flush = async () => {
    timer = null;
    if (closed || !subscribed || sending || isPublished()) return;
    sending = true;
    const next = wanted();
    const now = Date.now();
    sentAt = [...sentAt.filter((t) => now - t < PRESENCE_BUDGET.windowMs), now];
    // A rejected call counts as failed (retried below) instead of leaving `sending` stuck.
    const status = await channel.track({ name: me.name, online_at: new Date(now).toISOString(), mode: next.mode, map: next.map })
      .catch(() => "error" as const);
    sending = false;
    if (closed) return;
    if (status === "ok") published = next;
    // The state changed while the call was in flight, or the call failed/timed out → send again (budgeted).
    if (!isPublished()) schedule(status === "ok" ? 0 : 1000);
  };
  channel
    .on("presence", { event: "sync" }, emit)
    .on("presence", { event: "join" }, emit)
    .on("presence", { event: "leave" }, emit)
    .subscribe((status) => {
      // A (re)join starts with none of our presence on the server → publish the wanted state again;
      // this re-track may use the call kept in reserve (5th per 30 s) and never waits behind a pending
      // timer that was computed with the 4-call budget.
      if (status === "SUBSCRIBED") {
        subscribed = true; published = null;
        if (timer) { clearTimeout(timer); timer = null; }
        schedule(0, { max: PRESENCE_BUDGET.max + 1, windowMs: PRESENCE_BUDGET.windowMs });
      } else subscribed = false;
    });
  return {
    unsubscribe: () => {
      closed = true;
      if (timer) { clearTimeout(timer); timer = null; }
      void supabase.removeChannel(channel);
    },
    setMode: (next) => {
      if (closed || next === mode) return;
      mode = next;
      // The 1 s delay merges rapid toggles; A→B→A inside it sends nothing because the wanted state is published.
      schedule(1000);
    },
    setMap: (next) => {
      if (closed || next === map) return;
      map = next;
      schedule(1000);
    },
  };
}
