"use client";

import { useState } from "react";
import type { MapMember, PresenceMap } from "@/lib/presence-modes";
import { VISIBLE_MAP_IDS } from "@/lib/game/maps/city";
import type { MapId } from "@/lib/game/maps/types";

const LABEL: Record<PresenceMap, { icon: string; name: string }> = {
  hall: { icon: "🎵", name: "Sảnh" },
  pond: { icon: "🎣", name: "Ao cá" },
  field: { icon: "🌾", name: "Đồng" },
  market: { icon: "🏮", name: "Chợ Lớn" },
  khu_nha: { icon: "🏘️", name: "Khu nhà" },
  bai_dat: { icon: "🥊", name: "Bãi đất" },
  ham_ngam: { icon: "🕳️", name: "Hầm" },
  mo_da: { icon: "⛏️", name: "Mỏ đá" },
  song_cai: { icon: "🛶", name: "Sông Cái" },
  wild: { icon: "🌲", name: "Ngoài đồng" },                              // P2: the world between the zones
};
// v20.4: the hầm is a secret: nobody is counted there
const BASE: ReadonlyArray<{ id: PresenceMap; icon: string; name: string }> = VISIBLE_MAP_IDS.map((id: MapId) => ({ id, ...LABEL[id] }));
/** P2: "Ngoài đồng" (the wild) is listed in world mode, or once someone is out there. */
const WITH_WILD = [...BASE, { id: "wild" as const, ...LABEL.wild }];
// two rows so the chip stays narrow as maps are added
const rowsOf = (maps: typeof BASE) => {
  const half = Math.ceil(maps.length / 2);
  return [maps.slice(0, half), maps.slice(half)].filter((r) => r.length > 0);
};
const ROWS = rowsOf(BASE), ROWS_WILD = rowsOf(WITH_WILD);

/** Top-centre chip: how many members are on each map; tap for the names (classic-view members marked 🖥️). */
export default function MapCounts({ counts, world = false }: { counts: Partial<Record<PresenceMap, MapMember[]>> & Record<MapId, MapMember[]>; world?: boolean }) {
  const [open, setOpen] = useState(false);
  const wild = world || (counts.wild?.length ?? 0) > 0;
  const MAPS = wild ? WITH_WILD : BASE, rows = wild ? ROWS_WILD : ROWS;
  return (
    <div className="pointer-events-auto flex flex-col items-center gap-1 font-vt text-lg leading-none">
      <button type="button" className="pch-btn flex flex-col items-center gap-1" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {rows.map((row, i) => (
          <span key={i} className="whitespace-nowrap">{row.map((m) => `${m.icon} ${m.name} ${counts[m.id]?.length ?? 0}`).join(" · ")}</span>
        ))}
      </button>
      {open && (
        <div className="pch flex max-w-[calc(100vw-1rem)] flex-col gap-1.5 p-2 text-base">
          {MAPS.map((m) => (
            <div key={m.id}>
              <p className="text-lg">{m.icon} {m.name}</p>
              {(counts[m.id]?.length ?? 0) === 0 ? (
                <p className="opacity-70">Chưa có ai</p>
              ) : (
                <ul>
                  {(counts[m.id] ?? []).map((p) => (
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
