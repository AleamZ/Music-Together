"use client";

import { useState } from "react";
import { assignDj, transferAdmin, kickMember, type Member, type Room } from "@/lib/supabase";

export default function MemberList({ members, room, onlineIds, isAdmin, token, myMemberId }: {
  members: Member[]; room: Room; onlineIds: string[];
  isAdmin: boolean; token: string; myMemberId: string | null;
}) {
  const online = new Set(onlineIds);
  const [openId, setOpenId] = useState<string | null>(null);
  const roomId = room.id;

  return (
    <div>
      <h3 className="mb-2 flex items-center justify-between font-cormorant text-lg text-burgundy">
        Thành viên <span className="text-xs text-ink/60">{online.size} online</span>
      </h3>
      <ul>
        {members.map((m) => {
          const isDj = room.dj_member_id === m.id;
          const canManage = isAdmin && m.id !== myMemberId;
          return (
            <li key={m.id} className="flex items-center gap-2 border-b border-dotted border-gold-200 py-1.5 text-sm">
              <span className={`h-2 w-2 rounded-full ${online.has(m.account_id) ? "bg-green-vintage" : "bg-gold-200"}`} />
              <span className="text-ink">{m.username ?? "?"}</span>
              {room.admin_member_id === m.id && <span className="rounded-full bg-burgundy px-2 text-[10px] text-cream">👑 Admin</span>}
              {isDj && <span className="rounded-full bg-green-vintage px-2 text-[10px] text-cream">🎧 DJ</span>}
              {canManage && (
                <span className="relative ml-auto">
                  <button type="button" aria-label="Quản lý thành viên"
                    onClick={() => setOpenId((id) => (id === m.id ? null : m.id))}
                    className="rounded px-1 leading-none text-burgundy hover:bg-gold-200/40">⋯</button>
                  {openId === m.id && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setOpenId(null)} />
                      <div className="absolute right-0 z-20 mt-1 w-32 overflow-hidden rounded-lg border border-gold bg-cream text-xs shadow-lg">
                        <button type="button"
                          onClick={() => { assignDj(roomId, token, isDj ? null : m.id).catch(() => {}); setOpenId(null); }}
                          className="block w-full px-3 py-1.5 text-left text-burgundy hover:bg-gold-200/40">{isDj ? "Thu DJ" : "Giao DJ"}</button>
                        <button type="button"
                          onClick={() => { if (window.confirm(`Trao Admin cho ${m.username ?? "?"}?`)) transferAdmin(roomId, token, m.id).catch(() => {}); setOpenId(null); }}
                          className="block w-full px-3 py-1.5 text-left text-burgundy hover:bg-gold-200/40">Trao Admin</button>
                        <button type="button"
                          onClick={() => { if (window.confirm(`Kick ${m.username ?? "?"}?`)) kickMember(roomId, token, m.id).catch(() => {}); setOpenId(null); }}
                          className="block w-full px-3 py-1.5 text-left text-burgundy-accent hover:bg-gold-200/40">Kick</button>
                      </div>
                    </>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
