import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, type Room } from "@/lib/supabase";

export interface LobbyPresence { account_id: string; username: string; room_id: string | null; online_at: string; }
export interface RoomPresence { count: number; usernames: string[]; }
export interface LobbyMe { accountId: string; username: string; }
export interface LobbyHandle { unsubscribe: () => void; setRoomId: (roomId: string | null) => void; }

const LOBBY_CHANNEL = "lobby";

// A single shared "lobby" channel does BOTH jobs: it tracks this client's
// presence (room_id) AND drives active-room updates. supabase-js returns the
// SAME channel object per topic, so we must NOT open a second channel('lobby')
// or call .on() after .subscribe() — instead, observers register here in-memory.
let channel: RealtimeChannel | null = null;
let currentRoomId: string | null = null;
const subscribers = new Set<(rooms: Map<string, RoomPresence>) => void>();

function snapshot(): Map<string, RoomPresence> {
  if (!channel) return new Map();
  const state = channel.presenceState<LobbyPresence>() as Record<
    string,
    Array<LobbyPresence & { presence_ref: string }>
  >;
  return aggregateActiveRooms(state);
}

function notify(): void {
  const rooms = snapshot();
  subscribers.forEach((cb) => cb(rooms));
}

/**
 * Join the single shared global lobby channel and track this client's presence.
 * KEY is a per-tab random id (NOT account_id) so multiple tabs / rooms for one
 * account never collide. account_id lives in the payload (deduped when counting).
 * Call once per logged-in session (useAuth); re-calling tears down the prior channel.
 */
export function joinLobby(me: LobbyMe): LobbyHandle {
  if (channel) { void supabase.removeChannel(channel); channel = null; }
  // NOTE: do NOT reset currentRoomId here. A re-entrant joinLobby (e.g. React
  // StrictMode double-invoke, or a reconnect) must keep whatever room the user
  // is currently in, otherwise the freshly-created channel tracks room_id=null
  // and other clients aggregate this user out of their active-room list.

  const key =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  const ch = supabase.channel(LOBBY_CHANNEL, { config: { presence: { key } } });
  channel = ch;
  let subscribed = false;

  const buildPayload = (): LobbyPresence => ({
    account_id: me.accountId,
    username: me.username,
    room_id: currentRoomId,
    online_at: new Date().toISOString(),
  });

  ch.on("presence", { event: "sync" }, notify)
    .on("presence", { event: "join" }, notify)
    .on("presence", { event: "leave" }, notify)
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        subscribed = true;
        // Always re-assert the LATEST room_id on (re)subscribe — covers the
        // case where setRoomId ran before the channel finished joining and the
        // reconnect path where the server dropped our prior presence.
        await ch.track(buildPayload());
        notify();
      } else {
        // CHANNEL_ERROR / CLOSED / TIMED_OUT: we'll re-track on the next SUBSCRIBED.
        subscribed = false;
      }
    });

  return {
    unsubscribe: () => {
      if (channel === ch) {
        void supabase.removeChannel(ch);
        channel = null;
        currentRoomId = null;
      }
    },
    setRoomId: (roomId: string | null) => {
      currentRoomId = roomId;
      if (channel === ch && subscribed) void ch.track(buildPayload());
    },
  };
}

/** Flatten presence across tabs, drop lobby-browsers (room_id null), dedupe by account. */
export function aggregateActiveRooms(
  state: Record<string, Array<LobbyPresence & { presence_ref: string }>>,
): Map<string, RoomPresence> {
  const byRoom = new Map<string, Map<string, string>>();
  for (const entries of Object.values(state)) {
    for (const en of entries) {
      if (!en.room_id) continue;
      let accounts = byRoom.get(en.room_id);
      if (!accounts) { accounts = new Map(); byRoom.set(en.room_id, accounts); }
      accounts.set(en.account_id, en.username);
    }
  }
  const out = new Map<string, RoomPresence>();
  for (const [roomId, accounts] of byRoom) out.set(roomId, { count: accounts.size, usernames: [...accounts.values()] });
  return out;
}

/**
 * Observe active rooms. Registers an in-memory callback on the shared lobby
 * channel created by joinLobby — does NOT open a second channel. Emits the
 * current snapshot immediately, then on every presence sync/join/leave.
 */
export function subscribeActiveRooms(onChange: (rooms: Map<string, RoomPresence>) => void): () => void {
  subscribers.add(onChange);
  onChange(snapshot());
  return () => { subscribers.delete(onChange); };
}

export interface RoomCard { id: string; code: string; name: string; is_playing: boolean; current_title: string | null; dj_username: string | null; }

export async function fetchRoomCards(roomIds: string[]): Promise<Map<string, RoomCard>> {
  const out = new Map<string, RoomCard>();
  if (roomIds.length === 0) return out;
  const { data: rooms } = await supabase.from("rooms").select("id, code, name, is_playing, current_item_id, dj_member_id").in("id", roomIds);
  const roomRows = (rooms ?? []) as Pick<Room, "id" | "code" | "name" | "is_playing" | "current_item_id" | "dj_member_id">[];
  const itemIds = roomRows.map((r) => r.current_item_id).filter((v): v is string => !!v);
  const titleById = new Map<string, string>();
  if (itemIds.length) {
    const { data: items } = await supabase.from("queue_items").select("id, title").in("id", itemIds);
    for (const it of (items ?? []) as { id: string; title: string }[]) titleById.set(it.id, it.title);
  }
  const djMemberIds = roomRows.map((r) => r.dj_member_id).filter((v): v is string => !!v);
  const djByMemberId = new Map<string, string>();
  if (djMemberIds.length) {
    const { data: members } = await supabase.from("members").select("id, accounts ( username )").in("id", djMemberIds);
    type MemberRow = { id: string; accounts: { username: string } | null };
    for (const m of (members ?? []) as unknown as MemberRow[]) if (m.accounts?.username) djByMemberId.set(m.id, m.accounts.username);
  }
  for (const r of roomRows) {
    out.set(r.id, {
      id: r.id, code: r.code, name: r.name, is_playing: r.is_playing,
      current_title: r.current_item_id ? titleById.get(r.current_item_id) ?? null : null,
      dj_username: r.dj_member_id ? djByMemberId.get(r.dj_member_id) ?? null : null,
    });
  }
  return out;
}
