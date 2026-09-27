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
};

/** Every road between two maps: one per pair linked by a portal, whichever side it is read from (sorted, stable). */
export function cityRoads(): Array<readonly [MapId, MapId]> {
  const seen = new Set<string>();
  const out: Array<readonly [MapId, MapId]> = [];
  for (const id of MAP_IDS) {
    for (const it of getMap(id).interactables) {
      if (it.kind !== "portal" || !it.to || it.to.map === id) continue;
      const pair = [id, it.to.map].sort((a, b) => MAP_IDS.indexOf(a) - MAP_IDS.indexOf(b)) as [MapId, MapId];
      const key = pair.join("-");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(pair);
    }
  }
  return out;
}
