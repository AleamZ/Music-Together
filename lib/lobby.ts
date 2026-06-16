import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, type Room } from "@/lib/supabase";

export interface LobbyPresence { account_id: string; username: string; room_id: string | null; online_at: string; }
export interface RoomPresence { count: number; usernames: string[]; }
export interface LobbyMe { accountId: string; username: string; }
export interface LobbyHandle { unsubscribe: () => void; setRoomId: (roomId: string | null) => void; }

const LOBBY_CHANNEL = "lobby";

export function joinLobby(me: LobbyMe, getInitialRoomId: () => string | null = () => null): LobbyHandle {
  const key = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  let currentRoomId: string | null = getInitialRoomId();
  const channel: RealtimeChannel = supabase.channel(LOBBY_CHANNEL, { config: { presence: { key } } });
  const buildPayload = (): LobbyPresence => ({ account_id: me.accountId, username: me.username, room_id: currentRoomId, online_at: new Date().toISOString() });
  channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") { currentRoomId = getInitialRoomId(); await channel.track(buildPayload()); }
  });
  return {
    unsubscribe: () => { void supabase.removeChannel(channel); },
    setRoomId: (roomId: string | null) => { currentRoomId = roomId; void channel.track(buildPayload()); },
  };
}

export function aggregateActiveRooms(state: Record<string, Array<LobbyPresence & { presence_ref: string }>>): Map<string, RoomPresence> {
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

export function subscribeActiveRooms(onChange: (rooms: Map<string, RoomPresence>) => void): () => void {
  const channel: RealtimeChannel = supabase.channel(LOBBY_CHANNEL);
  const emit = () => {
    const state = channel.presenceState<LobbyPresence>() as Record<string, Array<LobbyPresence & { presence_ref: string }>>;
    onChange(aggregateActiveRooms(state));
  };
  channel.on("presence", { event: "sync" }, emit).on("presence", { event: "join" }, emit).on("presence", { event: "leave" }, emit)
    .subscribe((status) => { if (status === "SUBSCRIBED") emit(); });
  return () => { void supabase.removeChannel(channel); };
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
