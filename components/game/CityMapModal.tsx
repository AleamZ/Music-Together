"use client";

import { ParchmentModal } from "@/components/game/Parchment";
import { CITY_PLACES, VISIBLE_MAP_IDS } from "@/lib/game/maps/city";
import type { MapId } from "@/lib/game/maps/types";
import type { Vec } from "@/lib/game/types";
import { TELEPORT_FEE } from "@/lib/game/progression/model";
import type { WaypointMark } from "@/lib/game/world/waypoints";
import { WorldMapView, type MapFeed } from "./WorldMiniMap";

/** "Bản đồ" (hotkey M, the minimap, the signposts): P4 — the one world's true map for everyone, drawn from the world's
 *  data (the delta's land, the river and canals, Núi Mây Xanh, the roads and bridges, the zones and landmarks named),
 *  pannable and zoomable; me on it (`getWorldPos`: world px — a 2D player's map position mapped onto the world, Rừng
 *  tràm included), the others and my party, the waypoints (a click on a discovered one travels: `onWaypoint`). Below:
 *  the places with how many are on each. */
export default function CityMapModal({ current, counts, onClose, getWorldPos, getMarks, waypoints, onWaypoint }: {
  current: MapId;
  counts: Readonly<Record<MapId, number>>;
  onClose: () => void;
  getWorldPos?: () => Vec | null;
  getMarks?: MapFeed["getMarks"];
  waypoints?: readonly WaypointMark[];
  onWaypoint?: (m: WaypointMark) => void;
}) {
  const feed: MapFeed = { getMe: getWorldPos ?? (() => null), getMarks };
  return (
    <ParchmentModal title="🗺️ Bản đồ thế giới" onClose={onClose} className="sm:max-w-4xl">
      <div className="flex flex-col gap-3 font-vt leading-tight">
        <WorldMapView feed={feed} waypoints={waypoints} onWaypoint={onWaypoint} />

        {waypoints && waypoints.length > 0 && (
          <div data-testid="world-waypoints">
            <p className="text-lg">🌀 Trạm dịch chuyển · {TELEPORT_FEE} xu/lượt, đi từ trạm bạn đang đứng</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {waypoints.map((m) => (
                <button key={m.id} type="button" data-testid={`waypoint-${m.id}`} disabled={!m.found || m.here || !onWaypoint}
                  className={`pch-btn px-2 py-1 text-base ${m.found ? "" : "opacity-60"}`} onClick={() => onWaypoint?.(m)}
                  title={m.here ? "Bạn đang ở trạm này" : m.found ? `Dịch chuyển tới ${m.name}` : "Chưa khám phá"}>
                  {m.here ? "📍" : m.found ? "🌀" : "🔒"} {m.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <ul className="grid grid-cols-1 gap-2 text-base sm:grid-cols-2">
          {VISIBLE_MAP_IDS.map((id) => {
            const p = CITY_PLACES[id];
            return (
              <li key={id} data-testid={`city-map-${id}`} className={`rounded-sm border p-2 ${id === current ? "border-burgundy bg-[#fff4d6]" : "border-ink/30"}`}>
                <p className="flex items-center justify-between gap-2 text-lg">
                  <span>{p.icon} {p.name}{id === current ? " · 📍 Bạn đang ở đây" : ""}</span>
                  <span className="text-base opacity-80">👥 {counts[id]} người</span>
                </p>
                <p className="opacity-90">{p.places.join(" · ")}</p>
              </li>
            );
          })}
        </ul>
        <p className="text-sm opacity-70">Kéo để di chuyển bản đồ, lăn chuột / chụm hai ngón để phóng to; bấm một trạm 🌀 đã khám phá để dịch chuyển.</p>
      </div>
    </ParchmentModal>
  );
}
