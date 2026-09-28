import { ANH_BA_TOC_LOOK, BEP_LOOK, CHU_HAI_CA_LOOK, CHU_TU_LOOK, CO_BA_LOOK, CO_CHIN_LOOK, CO_SAU_LOOK, CO_TU_LOOK, ONG_TAM_XE_LOOK } from "@/lib/game/look";
import { CO_MUOI_LOOK } from "@/lib/game/pets/npc";
import { CO_HONG_LOOK, CO_NAM_LOOK } from "@/lib/game/housing/npc";
import { THAY_LAM_LOOK } from "@/lib/game/fight/npc";
import { BAI_DAT_ARRIVE, HALL_MARKET_ARRIVE, HAM_ARRIVE, KHU_NHA_ARRIVE, MARKET_ARRIVE } from "./arrivals";
import { cityMapPost } from "./city-post";
import { overlaps } from "./rect";
import type { GameMap, Interactable, Npc, PropPlacement, Rect, StallGoods } from "./types";

/** The city-map signpost near the way in (every map has one). */
export const MARKET_CITY_POST = cityMapPost(120, 264);

// "Chợ Lớn": a street market at dusk (v18.4, spec §18.4). Pure layout + collision; the painter is market-art.ts.

export const MARKET_W = 1280;
export const MARKET_H = 400;
export const MARKET_CELL = 8;

/** The two shop buildings along the north (solid). Shared with the art. */
export const RESTAURANT_FRONT: Rect = { x: 40, y: 40, w: 200, h: 120 };
export const CLOTHES_FRONT: Rect = { x: 400, y: 40, w: 200, h: 120 };
/** ông Tám's "Xe cộ" showroom between them (v18.5; it replaced the decorative chè shophouse): display windows either
 *  side of an open door where ông Tám stands. */
export const SHOWROOM_FRONT: Rect = { x: 240, y: 40, w: 160, h: 120 };
/** The showroom's open door (ông Tám stands in it), shared with the art. */
export const SHOWROOM_DOOR: Rect = { x: 308, y: 108, w: 24, h: 52 };
/** anh Ba's salon (v18.6) on the north row (the map was widened from 640 to 800 for it): a big mirror in the west
 *  window, a barber pole, and anh Ba behind the counter in the open front. */
export const SALON_FRONT: Rect = { x: 600, y: 40, w: 160, h: 120 };
/** The three big shops were street kiosks until the owner asked for proper shops ("làm thành 1 cửa hàng riêng"): they
 *  are now buildings on the north row east of the salon (the map was widened from 800 to 1280 for them), each with its
 *  keeper behind the counter in an open front, served from the pavement like the salon.
 *  cô Năm's "Nội thất cô Năm" (v19.2): display windows with a sofa and a wardrobe. */
export const FURNITURE_FRONT: Rect = { x: 760, y: 40, w: 160, h: 120 };
/** cô Hồng's Nhà nghỉ Hoa Sen (v19.1): two storeys, a neon board, the lobby desk below. The rooms are private views. */
export const MOTEL_FRONT: Rect = { x: 920, y: 40, w: 160, h: 120 };
/** cô Mười's "Tiệm thú cưng" (v18.12): a window of cages and an aquarium. */
export const PET_SHOP_FRONT: Rect = { x: 1080, y: 40, w: 160, h: 120 };
/** The north-row shops served like the salon: the counter rect in the open front, the keeper behind it, the customer on
 *  the pavement south of it. */
const shopCounter = (r: Rect): Rect => ({ x: r.x + 40, y: r.y + 90, w: 80, h: 30 });
const shopUse = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h + 16 });
const keeperSpot = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + 110, dir: "down" as const });
/** The way to Khu nhà (v19.2): the "Khu nhà" sign at the street's east end. */
export const KHU_NHA_SIGN = { x: MARKET_W - 15, y: 204 } as const;

/** The stalls along the south side: their solid footprint (the vendor stands inside, the customer on the pavement south
 *  of the counter). v18.5: Vựa cá Chợ Lớn at the west end and Vựa nông sản at the east end. */
export const STALLS: ReadonlyArray<{ goods: StallGoods; rect: Rect }> = [
  { goods: "fish", rect: { x: 40, y: 304, w: 80, h: 36 } },
  { goods: "fruit", rect: { x: 200, y: 304, w: 80, h: 36 } },
  { goods: "umbrella", rect: { x: 360, y: 304, w: 80, h: 36 } },   // v18.9: cô Chín's ô dù (was the flower stall)
  { goods: "lantern", rect: { x: 520, y: 304, w: 80, h: 36 } },
  { goods: "produce", rect: { x: 680, y: 304, w: 80, h: 36 } },
];

const stallOf = (goods: StallGoods): Rect => STALLS.find((s) => s.goods === goods)!.rect;
/** Vựa cá Chợ Lớn and Vựa nông sản (v18.5). */
export const FISH_DEPOT_STALL: Rect = stallOf("fish");
export const FARM_DEPOT_STALL: Rect = stallOf("produce");
/** cô Chín's umbrella stall (v18.9). */
export const UMBRELLA_STALL: Rect = stallOf("umbrella");
/** v21 economy: chú Bảy's lantern stall, the desk of the rented player stalls. */
export const PLAYER_STALLS_DESK: Rect = stallOf("lantern");
/** Where a customer stands at a served stall: on the pavement south of its counter, facing it. */
const counterUse = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h + 20 });

/** Street lantern posts: the strings overhead hang between them and the buildings. */
export const LANTERN_POSTS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 234, y: 178 }, { x: 406, y: 178 }, { x: 26, y: 178 }, { x: 600, y: 178 }, { x: 774, y: 178 },
  { x: 934, y: 178 }, { x: 1094, y: 178 }, { x: 1250, y: 178 },
];

/** v20.1 Võ đài: "Bao cát · Luyện võ" on the south pavement — the bag's foot at (1090, 336), practised from (1090, 318)
 *  facing down. It stays when the Võ đường is built beside it (v20.2). */
export const PUNCH_BAG = { x: 1090, y: 336 } as const;
export const PUNCH_BAG_USE = { x: 1090, y: 318 } as const;

/** v20.2 "Võ đường Chợ Lớn" on the south side, east of the stalls, facing the street: the compound (solid), the gate
 *  roof over the pavement (shade, R7), thầy Lâm in the gate and the student's spot north of him, facing down. */
export const VO_DUONG_FRONT: Rect = { x: 800, y: 280, w: 240, h: 104 };
export const VO_DUONG_AWNING: Rect = { x: 860, y: 248, w: 120, h: 36 };
export const THAY_LAM_SPOT = { x: 920, y: 296, dir: "down" as const };
export const VO_DUONG_USE = { x: 920, y: 262 } as const;

/** v20.3: the little bridge over the canal to Bãi đất trống — the canal wall opens at x 1160–1200; the portal sits in the
 *  gap, used from its head on the pavement (1180, 358) facing down. */
export const BRIDGE_GAP = { x: 1160, w: 40 } as const;
export const BRIDGE_PORTAL: Rect = { x: 1164, y: 372, w: 32, h: 24 };

/** v20.4: the rusty manhole between the lantern stall and Vựa nông sản (the underground's hatch), used from the pavement
 *  just north of it, facing down. Decoration for everyone; its prompt only for the unlocked (GameEngine.setHidden). */
export const UG_HATCH = { x: 640, y: 368 } as const;
export const UG_HATCH_USE = { x: 640, y: 352 } as const;

/** Outdoor tables of the nhà hàng (a table and two stools each), west of the door. */
export const EAT_TABLES: ReadonlyArray<{ x: number; y: number }> = [{ x: 64, y: 200 }, { x: 106, y: 222 }];

export const MARKET_SOLIDS: Rect[] = [
  MARKET_CITY_POST.solid,               // the city-map signpost
  { x: 0, y: 0, w: MARKET_W, h: 40 },   // the row of houses behind
  SHOWROOM_FRONT,
  RESTAURANT_FRONT,
  CLOTHES_FRONT,
  SALON_FRONT,
  PET_SHOP_FRONT,
  MOTEL_FRONT,
  FURNITURE_FRONT,
  { x: KHU_NHA_SIGN.x - 7, y: 194, w: 14, h: 10 },   // the "Khu nhà" sign post (v19.2)
  { x: 0, y: 40, w: 40, h: 120 },       // alley wall west of the nhà hàng
  { x: MARKET_W - 40, y: 40, w: 40, h: 120 },   // alley wall east of the pet shop
  ...STALLS.map((s) => s.rect),
  { x: 0, y: 384, w: BRIDGE_GAP.x, h: 16 },                                            // the low canal wall along the south…
  { x: BRIDGE_GAP.x + BRIDGE_GAP.w, y: 384, w: MARKET_W - BRIDGE_GAP.x - BRIDGE_GAP.w, h: 16 },   // …open for the bridge (v20.3)
  { x: 10, y: 242, w: 14, h: 10 },      // "Về sảnh" sign post
  ...LANTERN_POSTS.map((p) => ({ x: p.x - 2, y: p.y - 4, w: 4, h: 4 })),
  ...EAT_TABLES.map((t) => ({ x: t.x - 18, y: t.y - 10, w: 36, h: 10 })),
  { x: PUNCH_BAG.x - 4, y: PUNCH_BAG.y - 6, w: 12, h: 6 },     // the punching bag's stand (v20.1)
  VO_DUONG_FRONT,                                                // the Võ đường's compound (v20.2)
  { x: VO_DUONG_AWNING.x + 6, y: VO_DUONG_FRONT.y - 6, w: 8, h: 6 },                     // and its gate posts
  { x: VO_DUONG_AWNING.x + VO_DUONG_AWNING.w - 14, y: VO_DUONG_FRONT.y - 6, w: 8, h: 6 },
];

export const MARKET_INTERACTABLES: Interactable[] = [
  MARKET_CITY_POST.interactable,
  {
    id: "market_exit", kind: "portal", label: "Về sảnh", prompt: "Về sảnh nhạc", rect: { x: 8, y: 228, w: 18, h: 24 },
    use: { x: 40, y: 244 }, to: { map: "hall", arrive: HALL_MARKET_ARRIVE },
  },
  {
    id: "restaurant", kind: "restaurant", label: "Nhà hàng", prompt: "Gọi món · cô Bếp", rect: { x: 100, y: 130, w: 80, h: 30 },
    use: { x: 140, y: 176 }, face: "up",
  },
  {
    id: "clothes_shop", kind: "clothes_shop", label: "Tiệm quần áo", prompt: "Xem đồ · cô Sáu", rect: { x: 460, y: 130, w: 80, h: 30 },
    use: { x: 500, y: 176 }, face: "up",
  },
  {
    id: "vehicle_shop", kind: "vehicle_shop", label: "Xe cộ", prompt: "Xem xe · ông Tám", rect: { x: 244, y: 108, w: 152, h: 52 },
    use: { x: 320, y: 176 }, face: "up",
  },
  {
    id: "salon", kind: "salon", label: "Salon tóc", prompt: "Làm tóc · anh Ba", rect: { x: 640, y: 130, w: 80, h: 30 },
    use: { x: 680, y: 176 }, face: "up",
  },
  {
    id: "market_fish_depot", kind: "market_fish_depot", label: "Vựa cá Chợ Lớn", prompt: "Bán cá (+20%) · chú Hai", rect: FISH_DEPOT_STALL,
    use: counterUse(FISH_DEPOT_STALL), face: "up",
  },
  {
    id: "market_farm_depot", kind: "market_farm_depot", label: "Vựa nông sản", prompt: "Bán lúa, hoa màu (+20%) · cô Tư",
    rect: FARM_DEPOT_STALL, use: counterUse(FARM_DEPOT_STALL), face: "up",
  },
  {
    id: "pet_shop", kind: "pet_shop", label: "Tiệm thú cưng", prompt: "Thú cưng · cô Mười", rect: shopCounter(PET_SHOP_FRONT),
    use: shopUse(PET_SHOP_FRONT), face: "up",
  },
  {
    id: "umbrella_stall", kind: "umbrella_stall", label: "Sạp ô dù", prompt: "Mua ô · cô Chín", rect: UMBRELLA_STALL,
    use: counterUse(UMBRELLA_STALL), face: "up",
  },
  {
    // v21 economy: chú Bảy's lantern stall also rents out the player stalls (0073 claims its counter, (560, 360))
    id: "player_stalls", kind: "player_stalls", label: "Sạp cho thuê", prompt: "Thuê sạp, mua hàng người chơi · chú Bảy",
    rect: PLAYER_STALLS_DESK, use: counterUse(PLAYER_STALLS_DESK), face: "up",
  },
  {
    id: "motel", kind: "motel", label: "Nhà nghỉ Hoa Sen", prompt: "Thuê phòng, ngủ · cô Hồng", rect: shopCounter(MOTEL_FRONT),
    use: shopUse(MOTEL_FRONT), face: "up",
  },
  {
    id: "furniture_shop", kind: "furniture_shop", label: "Nội thất cô Năm", prompt: "Mua nội thất · cô Năm", rect: shopCounter(FURNITURE_FRONT),
    use: shopUse(FURNITURE_FRONT), face: "up",
  },
  {
    id: "market_to_khu_nha", kind: "portal", label: "Khu nhà", prompt: "Đi Khu nhà (chung cư)", rect: { x: MARKET_W - 24, y: 180, w: 18, h: 24 },
    use: { x: MARKET_W - 44, y: 196 }, to: { map: "khu_nha", arrive: KHU_NHA_ARRIVE },
  },
  {
    id: "punch_bag", kind: "punch_bag", label: "Bao cát · Luyện võ", prompt: "Luyện võ (bao cát)",
    rect: { x: PUNCH_BAG.x - 13, y: PUNCH_BAG.y - 36, w: 26, h: 36 }, use: { ...PUNCH_BAG_USE }, face: "down",
  },
  {
    id: "dojo", kind: "dojo", label: "Võ đường · thầy Lâm", prompt: "Học võ, thi lên đai · thầy Lâm",
    rect: { x: THAY_LAM_SPOT.x - 20, y: VO_DUONG_FRONT.y, w: 40, h: 32 }, use: { ...VO_DUONG_USE }, face: "down",
  },
  {
    id: "market_to_bai_dat", kind: "portal", label: "Bãi đất trống", prompt: "Qua cầu ra Bãi đất trống (sàn đấu)",
    rect: BRIDGE_PORTAL, use: { x: 1180, y: 358 }, face: "down", to: { map: "bai_dat", arrive: BAI_DAT_ARRIVE },
  },
  {
    // v20.4: not a portal (the knock and ug_enter come first); hidden unless ug_status says unlocked
    id: "ug_hatch", kind: "ug_hatch", label: "Nắp cống", prompt: "Gõ cửa",
    rect: { x: UG_HATCH.x - 12, y: UG_HATCH.y - 8, w: 24, h: 16 }, use: { ...UG_HATCH_USE }, face: "down",
    to: { map: "ham_ngam", arrive: HAM_ARRIVE },
  },
];

/** The cook and the seller stand behind their counters, ông Tám in his showroom's door, and the stall vendors behind
 *  theirs (all inside blocked cells). */
export const MARKET_NPCS: Npc[] = [
  { id: "bep", name: "cô Bếp", look: BEP_LOOK, spot: { x: 140, y: 150, dir: "down" } },
  { id: "co_sau", name: "cô Sáu", look: CO_SAU_LOOK, spot: { x: 500, y: 150, dir: "down" } },
  { id: "ong_tam_xe", name: "ông Tám xe", look: ONG_TAM_XE_LOOK, spot: { x: 320, y: 156, dir: "down" } },
  { id: "chu_hai_ca", name: "chú Hai", look: CHU_HAI_CA_LOOK, spot: { x: 80, y: 320, dir: "down" } },
  { id: "anh_ba_toc", name: "anh Ba tóc", look: ANH_BA_TOC_LOOK, spot: { x: 680, y: 150, dir: "down" } },
  { id: "ba_nam", name: "bà Năm", look: CO_BA_LOOK, spot: { x: 240, y: 320, dir: "down" } },
  { id: "chu_bay", name: "chú Bảy", look: CHU_TU_LOOK, spot: { x: 560, y: 320, dir: "down" } },
  { id: "co_tu", name: "cô Tư", look: CO_TU_LOOK, spot: { x: 720, y: 320, dir: "down" } },
  { id: "co_muoi", name: "cô Mười", look: CO_MUOI_LOOK, spot: keeperSpot(PET_SHOP_FRONT) },
  { id: "co_chin", name: "cô Chín", look: CO_CHIN_LOOK, spot: { x: 400, y: 320, dir: "down" } },
  { id: "co_hong", name: "cô Hồng", look: CO_HONG_LOOK, spot: keeperSpot(MOTEL_FRONT) },
  { id: "co_nam", name: "cô Năm", look: CO_NAM_LOOK, spot: keeperSpot(FURNITURE_FRONT) },
  { id: "thay_lam", name: "thầy Lâm", look: THAY_LAM_LOOK, spot: THAY_LAM_SPOT },   // v20.2: the Võ đường's gate
];

export const MARKET_PROPS: PropPlacement[] = [
  MARKET_CITY_POST.prop,
  { kind: "shop_counter", x: 140, y: 162 },
  { kind: "shop_counter", x: 500, y: 162 },
  { kind: "shop_counter", x: 680, y: 162 },
  ...[FURNITURE_FRONT, MOTEL_FRONT, PET_SHOP_FRONT].map((r): PropPlacement => ({ kind: "shop_counter", x: r.x + r.w / 2, y: r.y + r.h + 2 })),
  ...STALLS.map((s): PropPlacement => ({ kind: "market_stall", x: s.rect.x + s.rect.w / 2, y: s.rect.y + s.rect.h, goods: s.goods })),
  ...EAT_TABLES.map((t): PropPlacement => ({ kind: "eat_table", x: t.x, y: t.y })),
  ...LANTERN_POSTS.map((p): PropPlacement => ({ kind: "lantern_post", x: p.x, y: p.y })),
  { kind: "sign", x: 17, y: 252, icon: "note" },
  { kind: "sign", x: KHU_NHA_SIGN.x, y: KHU_NHA_SIGN.y, icon: "home" },
  { kind: "punch_bag", x: PUNCH_BAG.x, y: PUNCH_BAG.y },                    // v20.1
];

export function buildMarketMap(): GameMap {
  const cols = MARKET_W / MARKET_CELL, rows = MARKET_H / MARKET_CELL;
  const blocked = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cell = { x: c * MARKET_CELL, y: r * MARKET_CELL, w: MARKET_CELL, h: MARKET_CELL };
    blocked[r * cols + c] = MARKET_SOLIDS.some((s) => overlaps(s, cell)) ? 1 : 0;
  }
  return {
    id: "market", width: MARKET_W, height: MARKET_H, cell: MARKET_CELL, cols, rows, blocked,
    spawn: MARKET_ARRIVE, seating: null, interactables: MARKET_INTERACTABLES, props: MARKET_PROPS, npcs: MARKET_NPCS, plots: [],
  };
}
