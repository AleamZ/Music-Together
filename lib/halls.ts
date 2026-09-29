import { supabase, type Room } from "@/lib/supabase";

/** The three public halls (0093_public_rooms.sql). The home page lists what the server marks public; this list is the
 *  fallback for the "room closed" screen and the order/names the migration seeds. */
export const PUBLIC_HALLS = [
  { code: "salon-592539", name: "Sảnh Chính" },
  { code: "salon-cho-dem", name: "Sảnh Chợ Đêm" },
  { code: "salon-song-que", name: "Sảnh Sông Quê" },
] as const;

export const DEFAULT_HALL_CODE = PUBLIC_HALLS[0].code;

export interface PublicHall { id: string; code: string; name: string; is_playing: boolean; pinned_order: number | null; }

export async function fetchPublicHalls(): Promise<PublicHall[]> {
  const { data, error } = await supabase.from("rooms")
    .select("id, code, name, is_playing, pinned_order").eq("kind", "public").order("pinned_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PublicHall[];
}

/** Is this room closed to this viewer? Old (non-public) rooms are open only to their admin and root. */
export function isRoomClosedFor(room: Pick<Room, "kind">, v: { isRoot: boolean; isAdmin: boolean }): boolean {
  return room.kind !== "public" && !v.isRoot && !v.isAdmin;
}
