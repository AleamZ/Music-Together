import { WAYPOINTS } from "@/lib/game/progression/model";
import type { Vec } from "@/lib/game/types";
import type { MapView } from "./minimap";
import { toWorld } from "./zones";

// P3: the fast-travel waypoints (0070's, on the maps' arrival spots; 0088 world_waypoints mirrors them in world px) on
// the world map and the minimap. Click one to travel there — waypoint_travel, paid, from the waypoint I stand at (the
// server's rule, P2). Pure.

export interface WaypointMark {
  id: string;
  name: string;
  /** World px. */
  x: number;
  y: number;
  /** I discovered it (it can be travelled to). */
  found: boolean;
  /** I stand at it now (the trip starts here). */
  here: boolean;
}

/** Every waypoint in world px with my progress on it (`found`: the discovered ids; `at`: the one I stand at). */
export function waypointMarks(found: ReadonlySet<string>, at: string | null): WaypointMark[] {
  const out: WaypointMark[] = [];
  for (const w of WAYPOINTS) {
    const p = toWorld(w.map, { x: w.x, y: w.y });
    if (p) out.push({ id: w.id, name: w.name, x: p.x, y: p.y, found: found.has(w.id), here: w.id === at });
  }
  return out;
}

/** Canvas px of a world point in a view. */
export const onCanvas = (v: MapView, p: Vec): Vec => ({ x: (p.x - v.x0) * v.scale, y: (p.y - v.y0) * v.scale });

/** The waypoint drawn within `r` canvas px of the click `c` (canvas px), nearest first; null for none. */
export function waypointAt(marks: readonly WaypointMark[], v: MapView, c: Vec, r = 14): WaypointMark | null {
  let best: WaypointMark | null = null, bestD = r;
  for (const m of marks) {
    const q = onCanvas(v, m);
    const d = Math.hypot(q.x - c.x, q.y - c.y);
    if (d <= bestD) { best = m; bestD = d; }
  }
  return best;
}

/** What clicking a waypoint does: travel (a found one that is not where I stand), or why not. */
export function waypointClick(m: WaypointMark): { travel: true } | { travel: false; why: string } {
  if (m.here) return { travel: false, why: "Bạn đang ở trạm này rồi." };
  if (!m.found) return { travel: false, why: "Bạn chưa khám phá trạm đó — hãy tự đi tới một lần." };
  return { travel: true };
}
