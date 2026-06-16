"use client";

import { useState } from "react";
import { assignDj, kickMember, renameRoom, transferAdmin, type Member, type Room } from "@/lib/supabase";

export default function SettingsDialog({ room, members, roomId, token, myMemberId, onClose }: {
  room: Room; members: Member[]; roomId: string; token: string; myMemberId: string | null; onClose: () => void;
}) {
  const [name, setName] = useState(room.name);
  const others = members.filter((m) => m.id !== myMemberId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-gold bg-parchment p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 font-playfair text-xl text-burgundy">Cài đặt phòng</h3>

        <label className="mb-1 block text-sm text-ink">Tên phòng</label>
        <div className="mb-4 flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="flex-1 rounded-lg border border-gold bg-cream px-3 py-1.5 text-ink" />
          <button onClick={() => renameRoom(roomId, token, name.trim())}
            className="rounded-lg bg-burgundy px-3 text-cream">Lưu</button>
        </div>

        <h4 className="mb-2 font-cormorant text-burgundy">Thành viên</h4>
        <ul className="max-h-60 overflow-auto">
          {others.map((m) => (
            <li key={m.id} className="flex items-center justify-between border-b border-dotted border-gold-200 py-1.5 text-sm">
              <span className="text-ink">{m.username ?? "?"}{room.dj_member_id === m.id ? " · 🎧" : ""}</span>
              <span className="flex gap-1">
                {room.dj_member_id === m.id
                  ? <button onClick={() => assignDj(roomId, token, null)} className="rounded border border-gold-200 px-2 text-xs text-burgundy">Thu DJ</button>
                  : <button onClick={() => assignDj(roomId, token, m.id)} className="rounded border border-gold-200 px-2 text-xs text-burgundy">Giao DJ</button>}
                <button onClick={() => { if (window.confirm(`Chuyển quyền Admin cho ${m.username ?? "?"}?`)) transferAdmin(roomId, token, m.id); }}
                  className="rounded border border-gold-200 px-2 text-xs text-burgundy">Trao Admin</button>
                <button onClick={() => { if (window.confirm(`Kick ${m.username ?? "?"}?`)) kickMember(roomId, token, m.id); }}
                  className="rounded border border-gold-200 px-2 text-xs text-burgundy-accent">Kick</button>
              </span>
            </li>
          ))}
        </ul>

        <button onClick={onClose} className="mt-4 w-full rounded-lg border border-gold py-2 text-burgundy">Đóng</button>
      </div>
    </div>
  );
}
