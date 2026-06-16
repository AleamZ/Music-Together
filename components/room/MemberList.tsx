"use client";

import type { Member, Room } from "@/lib/supabase";

export default function MemberList({ members, room, onlineIds }: {
  members: Member[]; room: Room; onlineIds: string[];
}) {
  const online = new Set(onlineIds);
  return (
    <div>
      <h3 className="mb-2 flex items-center justify-between font-cormorant text-lg text-burgundy">
        Thành viên <span className="text-xs text-ink/60">{online.size} online</span>
      </h3>
      <ul>
        {members.map((m) => (
          <li key={m.id} className="flex items-center gap-2 border-b border-dotted border-gold-200 py-1.5 text-sm">
            <span className={`h-2 w-2 rounded-full ${online.has(m.account_id) ? "bg-green-vintage" : "bg-gold-200"}`} />
            <span className="text-ink">{m.username ?? "?"}</span>
            {room.admin_member_id === m.id && <span className="rounded-full bg-burgundy px-2 text-[10px] text-cream">👑 Admin</span>}
            {room.dj_member_id === m.id && <span className="rounded-full bg-green-vintage px-2 text-[10px] text-cream">🎧 DJ</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
