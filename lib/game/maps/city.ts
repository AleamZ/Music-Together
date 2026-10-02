import { getMap } from "./registry";
import { MAP_IDS, type MapId } from "./types";

// The town overview behind the city-map signposts (view only): where each map sits on the paper, what is there, and the
// roads between them, read from the real portals.

export interface CityPlace {
  id: MapId;
  icon: string;
  name: string;
  /** The key places a visitor looks for. */
  places: readonly string[];
  /** The map's centre on the overview, in percent of its width and height. */
  at: { x: number; y: number };
  /** v20.4: a secret place — not on the overview, no road to it, not in the map counts. */
  hidden?: boolean;
}

export const CITY_PLACES: Readonly<Record<MapId, CityPlace>> = {
  hall: {
    id: "hall", icon: "🎵", name: "Sảnh chính", at: { x: 50, y: 50 },
    places: ["Sân khấu & quầy DJ", "Bảng tin", "Quầy nước", "Góc đánh bài", "Bến câu cá"],
  },
  pond: {
    id: "pond", icon: "🎣", name: "Ao cá", at: { x: 50, y: 85 },
    places: ["Cầu ao câu cá", "Vựa cá · cô Ba", "Tiệm đồ câu · chú Tư", "Bảng kỷ lục", "Bãi trùn"],
  },
  field: {
    id: "field", icon: "🌾", name: "Đồng ruộng", at: { x: 16, y: 62 },
    places: ["Thửa ruộng", "Hợp tác xã · chú Tám", "Tiệm vật tư", "Vựa lúa", "Sân phơi", "Hang cua & bãi ốc"],
  },
  market: {
    id: "market", icon: "🏮", name: "Chợ Lớn", at: { x: 84, y: 40 },
    places: ["Nhà hàng", "Xe cộ", "Tiệm quần áo", "Salon tóc", "Vựa cá Chợ Lớn", "Vựa nông sản", "Tiệm thú cưng", "Nhà nghỉ Hoa Sen", "Nội thất cô Năm"],
  },
  // v19.2: the residential quarter (it was the greyed "Khu dân cư — sắp mở")
  khu_nha: {
    id: "khu_nha", icon: "🏘️", name: "Khu nhà", at: { x: 50, y: 14 },
    places: ["Chung cư Phú Mỹ · chú Sáu", "Đất xây nhà (sắp mở)", "Sàn bất động sản (sắp mở)"],
  },
  // v20.3: across the little bridge from Chợ Lớn's south-east canal wall
  bai_dat: {
    id: "bai_dat", icon: "🥊", name: "Bãi đất trống", at: { x: 86, y: 70 },
    places: ["4 sàn đấu", "Bảng thành tích", "Bao cát"],
  },
  // v20.4: under Chợ Lớn's manhole — never shown
  ham_ngam: {
    id: "ham_ngam", icon: "🕳️", name: "Hầm đấu ngầm", at: { x: 72, y: 46 }, hidden: true,
    places: ["Anh Tư Sẹo", "Lồng đấu", "Cửa thách đấu", "Bảng xếp hạng ngầm"],
  },
  // v21 #19: through the gap in Bãi đất trống's broken east wall
  mo_da: {
    id: "mo_da", icon: "⛏️", name: "Mỏ đá", at: { x: 94, y: 86 },
    places: ["10 mỏ quặng", "Bãi thảo dược", "Lán chú Tám (quặng, cuốc)", "Đe rèn", "Vạc thuốc bà Sáu"],
  },
  // v22 (0086): past the pond — 0116: south of it, as in the world (the road down to Bến đò, then the ghe)
  song_cai: {
    id: "song_cai", icon: "🛶", name: "Sông Cái", at: { x: 60, y: 96 },
    places: ["Bến đò (đường từ Ao cá, cấp 3)", "Bến sông · ông Năm đò", "Bãi Lau", "Ghềnh Đá Đỏ", "Vũng Ngát", "Cù lao giữa sông"],
  },
  // 0097: through the gap in Bãi đất trống's south fence
  rung_tram: {
    id: "rung_tram", icon: "🌲", name: "Rừng tràm", at: { x: 78, y: 92 },
    places: ["Thú rừng (săn, bẫy, chụp ảnh)", "Cây tràm, cây gỗ (đốn củi)"],
  },
};

/** v22 (0086): roads that are not portals — the boat trip from Ao cá to Sông Cái (the rowing minigame). */
export const BOAT_ROADS: ReadonlyArray<readonly [MapId, MapId]> = [["pond", "song_cai"]];

/** The maps the town overview shows (a hidden one is a secret). */
export const VISIBLE_MAP_IDS: readonly MapId[] = MAP_IDS.filter((id) => !CITY_PLACES[id].hidden);

/** Every road between two maps: one per pair linked by a portal, whichever side it is read from (sorted, stable). */
export function cityRoads(): Array<readonly [MapId, MapId]> {
  const seen = new Set<string>();
  const out: Array<readonly [MapId, MapId]> = [];
  for (const id of VISIBLE_MAP_IDS) {
    for (const it of getMap(id).interactables) {
      if (it.kind !== "portal" || !it.to || it.to.map === id || CITY_PLACES[it.to.map].hidden) continue;
      const pair = [id, it.to.map].sort((a, b) => MAP_IDS.indexOf(a) - MAP_IDS.indexOf(b)) as [MapId, MapId];
      const key = pair.join("-");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(pair);
    }
  }
  for (const pair of BOAT_ROADS) if (!seen.has(pair.join("-"))) out.push(pair);                         // v22 (0086)
  return out;
}
