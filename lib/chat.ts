import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export interface ChatMessage {
  id: string; room_id: string; account_id: string | null;
  username: string; body: string; created_at: string;
  /** Posted by the server (a catch or a land sale; anti-cheat spec §6.1). Members cannot set it. */
  system: boolean;
}

export async function sendChatMessage(token: string, roomId: string, body: string): Promise<void> {
  const { error } = await supabase.rpc("send_chat_message", { p_session_token: token, p_room_id: roomId, p_body: body });
  if (error) throw error;
}

export async function deleteChatMessage(token: string, roomId: string, id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_chat_message", { p_session_token: token, p_room_id: roomId, p_message_id: id });
  if (error) throw error;
}

const COLUMNS = "id, room_id, account_id, username, body, created_at";

/** Last `limit` messages for a room, returned oldest→newest for display. Before migration 0015 there is no `system`
 *  column (the Postgres error 42703, which PostgREST passes on): the messages are read again without it, and none is a
 *  system line, so the chat keeps working if this client goes live first. */
export async function fetchRecentMessages(roomId: string, limit = 50): Promise<ChatMessage[]> {
  const read = (columns: string) => supabase
    .from("chat_messages")
    .select(columns)
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(limit);
  const first = await read(`${COLUMNS}, system`);
  const { data, error } = first.error?.code === "42703" ? await read(COLUMNS) : first;
  if (error) throw error;
  return ((data ?? []) as unknown as ChatMessage[]).map((m) => ({ ...m, system: m.system === true })).reverse();
}

/** Dedicated postgres_changes channel for this room's chat (append on INSERT, remove on DELETE). */
export function subscribeChat(
  roomId: string,
  handlers: { onInsert: (m: ChatMessage) => void; onDelete: (id: string) => void },
): () => void {
  const subId = Math.random().toString(36).slice(2, 9);
  const channel: RealtimeChannel = supabase
    .channel(`chat:${roomId}:${subId}`)
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "chat_messages", filter: `room_id=eq.${roomId}` },
      (payload) => handlers.onInsert(payload.new as ChatMessage))
    .on("postgres_changes",
      { event: "DELETE", schema: "public", table: "chat_messages", filter: `room_id=eq.${roomId}` },
      (payload) => { const id = (payload.old as { id?: string }).id; if (id) handlers.onDelete(id); })
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
}
