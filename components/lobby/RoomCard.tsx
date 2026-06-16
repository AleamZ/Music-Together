"use client";

import { useRouter } from "next/navigation";
import type { ActiveRoom } from "@/hooks/useActiveRooms";

export default function RoomCard({ room }: { room: ActiveRoom }) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-gold-200 bg-cream p-3 shadow">
      <div className="font-cormorant text-lg font-bold text-burgundy">{room.name} 🔒</div>
      <div className="text-sm text-ink">{room.is_playing && room.current_title ? `🎵 ${room.current_title}` : "⏸ Tạm dừng"}</div>
      <div className="mt-1 flex items-center justify-between">
        <span className="text-xs text-gold">👥 {room.online} online{room.dj_username ? ` · 🎧 ${room.dj_username}` : ""}</span>
        <button onClick={() => router.push(`/room/${room.code}`)} className="rounded-lg bg-burgundy px-3 py-1 font-cormorant font-bold text-cream">Vào ▸</button>
      </div>
    </div>
  );
}
