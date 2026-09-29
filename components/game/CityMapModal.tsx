"use client";

import { ParchmentModal } from "@/components/game/Parchment";
import { CITY_PLACES, VISIBLE_MAP_IDS, cityRoads } from "@/lib/game/maps/city";
import type { MapId } from "@/lib/game/maps/types";
import type { Vec } from "@/lib/game/types";
import { TELEPORT_FEE } from "@/lib/game/progression/model";
import type { WaypointMark } from "@/lib/game/world/waypoints";
import { WorldMapCanvas } from "./WorldMiniMap";

const ROADS = cityRoads();

/** A slightly wobbly road between two points of the paper (percent units), bowed to one side so it looks hand-drawn. */
function roadPath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const bow = 4;
  return `M ${a.x} ${a.y} Q ${mx - (dy / len) * bow} ${my + (dx / len) * bow} ${b.x} ${b.y}`;
}

/** Little pixel-ish trees scattered over the paper (fixed, so the map looks the same every time). */
const TREES: ReadonlyArray<readonly [number, number]> = [
  [6, 18], [11, 30], [30, 22], [34, 36], [66, 24], [70, 64], [92, 70], [88, 16], [28, 88], [74, 90], [8, 88], [95, 50],
];

/** "Bản đồ thành phố" (view only): the whole town on old paper, the roads between the maps as the portals link them, where
 *  I am, how many are on each map and what is there. */
/** P2 world mode (`getWorldPos`): the paper is the true world map — the zones where they are, the roads, the river,
 *  the mine mouth and me — with the same list of places below. */
/** P3 world mode: the waypoints on the paper and listed; clicking a discovered one travels there (`onWaypoint`). */
export default function CityMapModal({ current, counts, onClose, getWorldPos, waypoints, onWaypoint }: {
  current: MapId;
  counts: Readonly<Record<MapId, number>>;
  onClose: () => void;
  getWorldPos?: () => Vec | null;
  waypoints?: readonly WaypointMark[];
  onWaypoint?: (m: WaypointMark) => void;
}) {
  return (
    <ParchmentModal title="🗺️ Bản đồ thành phố" onClose={onClose} className="sm:max-w-3xl">
      <div className="flex flex-col gap-3 font-vt leading-tight">
        {getWorldPos ? <WorldMapCanvas getWorldPos={getWorldPos} waypoints={waypoints} onWaypoint={onWaypoint} /> : (<div
          className="relative aspect-[16/11] w-full overflow-hidden rounded-sm border-2 border-ink/60 bg-[#efe0bb] shadow-inner"
          data-testid="city-map-paper"
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
            {/* aged paper: darker edges and a few stains */}
            <defs>
              <radialGradient id="city-paper" cx="50%" cy="50%" r="70%">
                <stop offset="60%" stopColor="#efe0bb" stopOpacity="0" />
                <stop offset="100%" stopColor="#a8834f" stopOpacity="0.45" />
              </radialGradient>
            </defs>
            <rect x="0" y="0" width="100" height="100" fill="url(#city-paper)" />
            <ellipse cx="78" cy="78" rx="6" ry="3" fill="#b8955e" opacity="0.18" />
            <ellipse cx="22" cy="12" rx="4" ry="2" fill="#b8955e" opacity="0.15" />
            {/* the river along the south and the pond */}
            <path d="M 0 74 C 20 70 30 80 50 76 S 80 70 100 78 L 100 83 C 80 76 60 82 50 81 S 20 76 0 80 Z" fill="#7fb3c9" opacity="0.8" />
            <ellipse cx={CITY_PLACES.pond.at.x} cy={CITY_PLACES.pond.at.y + 2} rx="11" ry="6" fill="#5f9fbf" opacity="0.85" />
            {/* the rice paddies west, the market's street east */}
            {[0, 1, 2].map((i) => (
              <rect key={i} x={6 + i * 7} y="50" width="6" height="7" fill="#c9c46a" stroke="#8a7a3a" strokeWidth="0.3" opacity="0.8" />
            ))}
            <rect x="74" y="34" width="20" height="4" fill="#c98a6a" opacity="0.6" />
            {/* v19.2: the residential quarter: the apartment block and a few roofs */}
            <rect x="46" y="4" width="8" height="6" fill="#d9c6a8" stroke="#6e4424" strokeWidth="0.3" opacity="0.85" />
            {[38, 58, 62].map((x) => (
              <path key={x} d={`M ${x} 22 L ${x + 2} 20 L ${x + 4} 22 Z`} fill="#b0503a" opacity="0.8" />
            ))}
            {TREES.map(([x, y]) => (
              <g key={`${x}-${y}`}>
                <rect x={x - 0.3} y={y} width="0.6" height="1.6" fill="#6e4424" />
                <circle cx={x} cy={y} r="1.6" fill="#5caa4a" opacity="0.85" />
              </g>
            ))}
            {/* the roads: one per portal pair */}
            {ROADS.map(([a, b]) => (
              <path key={`${a}-${b}`} data-road={`${a}-${b}`} d={roadPath(CITY_PLACES[a].at, CITY_PLACES[b].at)}
                fill="none" stroke="#8b5a33" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="3 1.5" />
            ))}
            {/* the compass rose */}
            <g transform="translate(92 10)" opacity="0.7">
              <path d="M 0 -5 L 1.2 0 L 0 5 L -1.2 0 Z" fill="#8e2a1f" />
              <path d="M -5 0 L 0 1.2 L 5 0 L 0 -1.2 Z" fill="#3a2418" />
            </g>
          </svg>
          <span className="absolute right-[4%] top-[1%] text-sm text-ink/70" aria-hidden="true">B</span>

          {VISIBLE_MAP_IDS.map((id) => {
            const p = CITY_PLACES[id];
            const here = id === current;
            return (
              <div
                key={id}
                data-testid={`city-map-${id}`}
                className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                style={{ left: `${p.at.x}%`, top: `${p.at.y}%` }}
              >
                {here && (
                  <span className="mb-0.5 whitespace-nowrap rounded-sm bg-burgundy px-1 text-xs text-parchment shadow motion-safe:animate-bounce sm:text-sm">
                    📍 Bạn đang ở đây
                  </span>
                )}
                <span
                  className={`flex items-center gap-1 whitespace-nowrap rounded-sm border-2 px-1.5 py-0.5 text-sm shadow sm:text-lg ${here ? "border-burgundy bg-[#fff4d6]" : "border-ink/60 bg-parchment"}`}
                >
                  <span aria-hidden="true">{p.icon}</span>
                  <span>{p.name}</span>
                  <span className="rounded-sm bg-ink/10 px-1 text-xs tabular-nums sm:text-sm" title={`${counts[id]} người đang ở ${p.name}`}>
                    👥 {counts[id]}
                  </span>
                </span>
              </div>
            );
          })}
        </div>)}

        {getWorldPos && waypoints && waypoints.length > 0 && (
          <div data-testid="world-waypoints">
            <p className="text-lg">🌀 Trạm dịch chuyển · {TELEPORT_FEE} xu/lượt, đi từ trạm bạn đang đứng</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {waypoints.map((m) => (
                <button key={m.id} type="button" data-testid={`waypoint-${m.id}`} disabled={!m.found || m.here}
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
              <li key={id} className={`rounded-sm border p-2 ${id === current ? "border-burgundy bg-[#fff4d6]" : "border-ink/30"}`}>
                <p className="flex items-center justify-between gap-2 text-lg">
                  <span>{p.icon} {p.name}{id === current ? " · 📍 bạn ở đây" : ""}</span>
                  <span className="text-base opacity-80">👥 {counts[id]} người</span>
                </p>
                <p className="opacity-90">{p.places.join(" · ")}</p>
              </li>
            );
          })}
        </ul>
        <p className="text-sm opacity-70">{getWorldPos
          ? "Đi bộ hoặc chạy xe theo đường; bấm một trạm 🌀 đã khám phá để dịch chuyển."
          : "Bản đồ chỉ để xem — đi theo biển chỉ đường ở mỗi khu để di chuyển."}</p>
      </div>
    </ParchmentModal>
  );
}
