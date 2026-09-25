"use client";

import { useState } from "react";
import type { MapMember } from "@/lib/presence-modes";
import type { MapId } from "@/lib/game/maps/types";

const MAPS: Array<{ id: MapId; icon: string; name: string }> = [
  { id: "hall", icon: "🎵", name: "Sảnh" },
  { id: "pond", icon: "🎣", name: "Ao cá" },
];

/** Top-centre chip: how many members are on each map; tap for the names (classic-view members marked 🖥️). */
export default function MapCounts({ counts }: { counts: Record<MapId, MapMember[]> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pointer-events-auto flex flex-col items-center gap-1 font-vt text-lg leading-none">
      <button type="button" className="pch-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {MAPS.map((m) => `${m.icon} ${m.name} ${counts[m.id].length}`).join(" · ")}
      </button>
      {open && (
        <div className="pch flex max-w-[calc(100vw-1rem)] flex-col gap-1.5 p-2 text-base">
          {MAPS.map((m) => (
            <div key={m.id}>
              <p className="text-lg">{m.icon} {m.name}</p>
              {counts[m.id].length === 0 ? (
                <p className="opacity-70">Chưa có ai</p>
              ) : (
                <ul>
                  {counts[m.id].map((p) => (
                    <li key={p.accountId} className="truncate">{p.classic ? "🖥️ " : ""}{p.name || "Khách"}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
