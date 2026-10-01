import type { Vec } from "@/lib/game/types";
import { SONG_CAI_ROUTE } from "./routes";

// The roads of the wild (spec §1): polylines in world px that join the two ends of an old portal pair, plus the trails
// (lib/game/world/terrain.ts) that lead to the river's bridges. Data only; wild.ts re-exports the roads.

/** A road: a polyline in world px, `w` px wide, joining two openings' ends (`a`, `b`: "zone:portal"; "wild:mine" is the
 *  mine mouth on the eastern hills, lib/game/world/mine.ts). */
export interface Road { id: string; a: string; b: string; pts: readonly Vec[]; w: number; /** The b end's height (units) when not its zone's plateau (0116: Bến đò sits on the bank above Sông Cái). */ hb?: number }

// The openings' ends on the zone edges (world px), worked out from the portals' use points (see wild.ts OPENINGS):
//   hall dock (1476, 880)    hall west (960, 716)     hall east (1600, 680)
//   pond exit (1312, 1440)   pond bridge (1150, 1440)
//   field north (60, 560)    field east (800, 804)
//   market west (1760, 724)  market east (3040, 676)  market south (2940, 880)
//   khu_nha west (3200, 676) bai_dat north (2800, 1040) bai_dat east (3200, 1308)      the mine mouth (3624, 1232)
export const ROADS: readonly Road[] = [
  { id: "hall_pond", a: "hall:dock_sign", b: "pond:pond_exit", w: 32,
    pts: [{ x: 1476, y: 880 }, { x: 1476, y: 960 }, { x: 1680, y: 960 }, { x: 1680, y: 1500 }, { x: 1312, y: 1500 }, { x: 1312, y: 1440 }] },
  { id: "hall_field", a: "hall:field_sign", b: "field:field_to_hall", w: 32,
    pts: [{ x: 960, y: 716 }, { x: 880, y: 716 }, { x: 880, y: 440 }, { x: 60, y: 440 }, { x: 60, y: 560 }] },
  { id: "field_pond", a: "field:field_to_pond", b: "pond:field_bridge", w: 32,
    pts: [{ x: 800, y: 804 }, { x: 880, y: 804 }, { x: 880, y: 1500 }, { x: 1150, y: 1500 }, { x: 1150, y: 1440 }] },
  { id: "hall_market", a: "hall:market_sign", b: "market:market_exit", w: 40,
    pts: [{ x: 1600, y: 680 }, { x: 1680, y: 680 }, { x: 1680, y: 724 }, { x: 1760, y: 724 }] },
  { id: "market_khu_nha", a: "market:market_to_khu_nha", b: "khu_nha:khu_nha_exit", w: 40,
    pts: [{ x: 3040, y: 676 }, { x: 3200, y: 676 }] },
  { id: "market_bai_dat", a: "market:market_to_bai_dat", b: "bai_dat:bai_dat_exit", w: 32,
    pts: [{ x: 2940, y: 880 }, { x: 2940, y: 960 }, { x: 2800, y: 960 }, { x: 2800, y: 1040 }] },
  { id: "bai_dat_mine", a: "bai_dat:mo_da_gate", b: "wild:mine", w: 32,
    pts: [{ x: 3200, y: 1308 }, { x: 3280, y: 1308 }, { x: 3400, y: 1232 }, { x: 3624, y: 1232 }] },
  // 0116: the road out to Sông Cái — off the hall–pond road at its corner below the pond, down to Bến đò (routes.ts)
  { id: SONG_CAI_ROUTE.id, a: "pond:pond_exit", b: "song_cai:landing", w: SONG_CAI_ROUTE.w, pts: SONG_CAI_ROUTE.pts, hb: SONG_CAI_ROUTE.landingElev },
];

/** A trail: a footpath off a road (`from`: the road's id) to a bridge over the river and the south bank. */
export interface Trail { id: string; from: string; pts: readonly Vec[]; w: number }

export const TRAILS: readonly Trail[] = [
  { id: "trail_b1", from: "field_pond", w: 24,
    pts: [{ x: 880, y: 1360 }, { x: 720, y: 1420 }, { x: 540, y: 1540 }, { x: 424, y: 1690 }, { x: 424, y: 2180 }] },
  { id: "trail_b2", from: "bai_dat_mine", w: 24,
    pts: [{ x: 3280, y: 1308 }, { x: 3280, y: 1480 }, { x: 3050, y: 1570 }, { x: 2800, y: 1650 }, { x: 2624, y: 1780 }, { x: 2624, y: 2180 }] },
];

// ---------------------------------------------------------------- polyline helpers (pure)

export interface Nearest { d: number; s: number; x: number; y: number }

/** The polyline's cumulative lengths (px) at each point. */
export function cumulative(pts: readonly Vec[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return out;
}

/** The nearest point of a polyline to (x, y): its distance, arc length along the line, and position. */
export function nearestOn(pts: readonly Vec[], cum: readonly number[], x: number, y: number): Nearest {
  let best: Nearest = { d: Infinity, s: 0, x: pts[0].x, y: pts[0].y };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
    const px = a.x + dx * t, py = a.y + dy * t;
    const d = Math.hypot(x - px, y - py);
    if (d < best.d) best = { d, s: cum[i - 1] + (cum[i] - cum[i - 1]) * t, x: px, y: py };
  }
  return best;
}

/** The point at arc length s along a polyline, and its unit direction. */
export function pointAt(pts: readonly Vec[], cum: readonly number[], s: number): { x: number; y: number; dx: number; dy: number } {
  const L = cum[cum.length - 1];
  const t = Math.max(0, Math.min(L, s));
  let i = 1;
  while (i < pts.length - 1 && cum[i] < t) i++;
  const a = pts[i - 1], b = pts[i], seg = cum[i] - cum[i - 1] || 1, k = (t - cum[i - 1]) / seg;
  const dx = (b.x - a.x) / seg, dy = (b.y - a.y) / seg;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, dx, dy };
}
