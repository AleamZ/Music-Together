// v21 progression (0070_progression.sql): the level curve, the map unlocks, the waypoints and the leaderboards' labels.
// Pure; tests/unit/v21-progression.test.ts pins every constant here to the SQL seed.
import type { MapId } from "@/lib/game/maps/types";

export const MAX_LEVEL = 99;

/** Total XP at level `l` (0070 _pg_xp_at): 100(l−1) + 25(l−1)(l−2). */
export const xpAt = (l: number): number => 100 * (l - 1) + 25 * (l - 1) * (l - 2);

/** The level of a total XP (0070 _pg_level_for). */
export function levelFor(xp: number): number {
  let l = 1;
  while (l < MAX_LEVEL && xpAt(l + 1) <= xp) l++;
  return l;
}

/** Coins paid on reaching level `l` (0070 _pg_level_reward). */
export const levelReward = (l: number): number => (l % 5 === 0 ? 150 * l : 50 * l);

/** Progress inside the current level: XP into it, XP the level spans, 0–1. */
export function levelProgress(xp: number): { level: number; into: number; span: number; frac: number } {
  const level = levelFor(xp);
  if (level >= MAX_LEVEL) return { level, into: 0, span: 0, frac: 1 };
  const into = xp - xpAt(level);
  const span = xpAt(level + 1) - xpAt(level);
  return { level, into, span, frac: span > 0 ? Math.min(1, Math.max(0, into / span)) : 1 };
}

/** The daily XP caps per bucket (0070 _pg_cap). */
export const XP_CAPS = { fish: 1500, earn: 400, fight: 400, grant: 3000 } as const;
export type XpBucket = keyof typeof XP_CAPS;

/** #92: the level a map opens at (0070 map_levels). Every existing map is open at level 1; a map missing here is open.
 *  A NEW MAP: add it here AND in your migration's `insert into public.map_levels`. */
export const MAP_MIN_LEVEL: Readonly<Record<string, number>> = {
  hall: 1, pond: 1, field: 1, market: 1, khu_nha: 1, bai_dat: 1, ham_ngam: 1, mo_da: 5,   // mo_da: v21 #19 (0072)
};

/** The level `map` needs: the server's table when known, else the mirror. */
export function mapMinLevel(map: string, server?: Readonly<Record<string, number>> | null): number {
  return server?.[map] ?? MAP_MIN_LEVEL[map] ?? 1;
}

export const mapUnlocked = (map: string, level: number, server?: Readonly<Record<string, number>> | null): boolean =>
  level >= mapMinLevel(map, server);

export interface WaypointDef { id: string; name: string; map: MapId; x: number; y: number; dir: "up" | "down" | "left" | "right"; minLevel: number }

/** #93: the waypoints (0070 waypoints), each on its map's arrival spot. */
export const WAYPOINTS: readonly WaypointDef[] = [
  { id: "wp_hall", name: "Sảnh chính", map: "hall", x: 612, y: 300, dir: "down", minLevel: 1 },
  { id: "wp_pond", name: "Ao cá", map: "pond", x: 300, y: 356, dir: "up", minLevel: 1 },
  { id: "wp_field", name: "Đồng ruộng", map: "field", x: 60, y: 106, dir: "right", minLevel: 1 },
  { id: "wp_market", name: "Chợ Lớn", map: "market", x: 72, y: 252, dir: "right", minLevel: 2 },
  { id: "wp_khu_nha", name: "Khu nhà", map: "khu_nha", x: 68, y: 208, dir: "right", minLevel: 4 },
  { id: "wp_bai_dat", name: "Bãi đất trống", map: "bai_dat", x: 400, y: 48, dir: "down", minLevel: 6 },
];
export const WAYPOINT_RADIUS = 160;
export const TELEPORT_FEE = 20;

export type BoardId = "level" | "rich" | "fish" | "biggest" | "farmer" | "fights";
export const BOARDS: ReadonlyArray<{ id: BoardId; label: string; unit: string }> = [
  { id: "level", label: "⭐ Cấp độ", unit: "XP" },
  { id: "rich", label: "💰 Giàu nhất", unit: "xu" },
  { id: "fish", label: "🎣 Nhiều cá nhất", unit: "con" },
  { id: "biggest", label: "🐋 Cá to nhất", unit: "g" },
  { id: "farmer", label: "🌾 Nhà nông", unit: "xu" },
  { id: "fights", label: "🥊 Thắng đấu", unit: "trận" },
];

/** The Vietnamese text of a progression refusal (null: not ours). */
export function progressionErrorText(msg: string): string | null {
  switch (msg) {
    case "title locked": return "Danh hiệu này chưa mở khoá.";
    case "not at waypoint": return "Phải đứng cạnh một trạm dịch chuyển đã khám phá mới đi được.";
    case "same waypoint": return "Bạn đang ở trạm này rồi.";
    case "bad waypoint": return "Trạm dịch chuyển không tồn tại.";
    case "waypoint unknown": return "Bạn chưa khám phá trạm đó — hãy tự đi tới một lần.";
    case "level too low": return "Chưa đủ cấp để tới đó.";
    case "too soon": return "Vừa dịch chuyển xong — chờ vài giây nhé.";
    case "insufficient funds": return "Không đủ xu.";
    case "bad board": return "Bảng xếp hạng không tồn tại.";
    case "map locked": return "Khu vực này chưa mở khoá cho cấp của bạn.";
    default: return null;
  }
}

/** A short level badge for name tags and the HUD ("Lv 12"). */
export const levelBadge = (level: number): string => `Lv${level}`;
