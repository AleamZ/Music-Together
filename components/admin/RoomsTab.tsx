"use client";

import { useCallback, useEffect, useState } from "react";
import { adminListRooms, adminDeleteRoom, type AdminRoom } from "@/lib/admin";

export default function RoomsTab({ token }: { token: string }) {
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const refresh = useCallback(() => { adminListRooms(token).then(setRooms).catch(() => {}); }, [token]);
  useEffect(() => { refresh(); }, [refresh]);
  return (
    <div className="flex flex-col gap-2">
      {rooms.length === 0 && <p className="text-ink/60">Chưa có phòng nào.</p>}
      {rooms.map((r) => (
        <div key={r.id} className="flex items-center justify-between rounded-xl border border-gold-200 bg-cream p-3 text-sm">
          <span className="text-ink">
            <b className="text-burgundy">{r.name}</b> · {r.code} · 👥 {r.member_count} · tạo bởi {r.creator ?? "?"} · {new Date(r.created_at).toLocaleDateString("vi-VN")}
          </span>
          <button onClick={async () => { if (confirm(`Xóa phòng ${r.name}?`)) { await adminDeleteRoom(token, r.id); refresh(); } }}
            className="rounded border border-gold-200 px-2 text-burgundy-accent">Xóa</button>
        </div>
      ))}
    </div>
  );
}
