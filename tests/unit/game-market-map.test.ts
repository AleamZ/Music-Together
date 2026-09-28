import { describe, it, expect } from "vitest";
import { HALL_MARKET_ARRIVE, MARKET_ARRIVE, MARKET_EAST_ARRIVE } from "@/lib/game/maps/arrivals";
import {
  buildMarketMap, CLOTHES_FRONT, FURNITURE_FRONT, MARKET_H, MARKET_W, MOTEL_FRONT, PET_SHOP_FRONT, RESTAURANT_FRONT, SALON_FRONT, SHOWROOM_FRONT, STALLS,
} from "@/lib/game/maps/market";
import { overlaps } from "@/lib/game/maps/rect";
import { propFrame } from "@/lib/game/maps/props";
import { isBlockedAt } from "@/lib/game/movement";
import { findPath } from "@/lib/game/pathfinding";
import { PROMPT_RANGE } from "@/lib/game/scene";

const market = buildMarketMap();
const pick = (id: string) => market.interactables.find((i) => i.id === id)!;

describe("market map (Chợ Lớn)", () => {
  it("has the documented size, grid and interactables", () => {
    expect(market.id).toBe("market");
    expect([MARKET_W, MARKET_H]).toEqual([1280, 400]);
    expect([market.width, market.height, market.cell, market.cols, market.rows]).toEqual([1280, 400, 8, 160, 50]);
    expect(market.blocked).toHaveLength(160 * 50);
    expect(market.seating).toBeNull();
    expect(market.plots).toEqual([]);
    expect(market.spawn).toEqual(MARKET_ARRIVE);
    expect(market.interactables.map((i) => [i.id, i.kind])).toEqual([
      ["city_map", "city_map"], ["market_exit", "portal"], ["restaurant", "restaurant"], ["clothes_shop", "clothes_shop"],
      ["vehicle_shop", "vehicle_shop"], ["salon", "salon"], ["market_fish_depot", "market_fish_depot"], ["market_farm_depot", "market_farm_depot"],
      ["pet_shop", "pet_shop"], ["umbrella_stall", "umbrella_stall"],                  // v18.9
      ["motel", "motel"],                                                           // v19.1
      ["furniture_shop", "furniture_shop"], ["market_to_khu_nha", "portal"],        // v19.2
      ["punch_bag", "punch_bag"],                                                   // v20.1
      ["dojo", "dojo"],                                                             // v20.2
      ["market_to_bai_dat", "portal"],                                              // v20.3
    ]);
  });
  it("puts ông Tám in his showroom's door on the north row, served from the street (v18.5)", () => {
    expect(SHOWROOM_FRONT).toEqual({ x: 240, y: 40, w: 160, h: 120 });
    expect(pick("vehicle_shop")).toMatchObject({ rect: { x: 244, y: 108, w: 152, h: 52 }, use: { x: 320, y: 176 }, face: "up" });
    const ntx = market.npcs.find((n) => n.id === "ong_tam_xe")!;
    expect(ntx).toMatchObject({ name: "ông Tám xe", spot: { x: 320, y: 156, dir: "down" } });
    expect(isBlockedAt(market, ntx.spot.x, ntx.spot.y)).toBe(true);
  });
  it("serves the two depots from the pavement south of their counters, each with its vendor (v18.5)", () => {
    expect(pick("market_fish_depot")).toMatchObject({ rect: { x: 40, y: 304, w: 80, h: 36 }, use: { x: 80, y: 360 }, face: "up" });
    expect(pick("market_farm_depot")).toMatchObject({ rect: { x: 680, y: 304, w: 80, h: 36 }, use: { x: 720, y: 360 }, face: "up" });
    expect(market.npcs.find((n) => n.id === "chu_hai_ca")!.spot).toEqual({ x: 80, y: 320, dir: "down" });
    expect(market.npcs.find((n) => n.id === "co_tu")!.spot).toEqual({ x: 720, y: 320, dir: "down" });
  });
  it("puts anh Ba behind his salon counter at the east end of the north row (v18.6)", () => {
    expect(SALON_FRONT).toEqual({ x: 600, y: 40, w: 160, h: 120 });
    const salon = pick("salon");
    expect(salon).toMatchObject({ label: "Salon tóc", rect: { x: 640, y: 130, w: 80, h: 30 }, use: { x: 680, y: 176 }, face: "up" });
    const ba = market.npcs.find((n) => n.id === "anh_ba_toc")!;
    expect(ba).toMatchObject({ name: "anh Ba tóc", spot: { x: 680, y: 150, dir: "down" } });
    expect(isBlockedAt(market, ba.spot.x, ba.spot.y)).toBe(true);
    // behind the counter: inside the salon's counter rect, north of the customer's spot
    expect(ba.spot.x).toBeGreaterThanOrEqual(salon.rect.x);
    expect(ba.spot.x).toBeLessThan(salon.rect.x + salon.rect.w);
    expect(ba.spot.y).toBeGreaterThanOrEqual(salon.rect.y);
    expect(ba.spot.y).toBeLessThan(salon.use.y);
    expect(market.props.some((p) => p.kind === "shop_counter" && p.x === 680)).toBe(true);
  });
  it("makes the furniture store, the motel and the pet shop real buildings on the north row, east of the salon", () => {
    const row = [SALON_FRONT, FURNITURE_FRONT, MOTEL_FRONT, PET_SHOP_FRONT];
    expect(row.slice(1)).toEqual([
      { x: 760, y: 40, w: 160, h: 120 }, { x: 920, y: 40, w: 160, h: 120 }, { x: 1080, y: 40, w: 160, h: 120 },
    ]);
    // side by side, no gaps or overlaps, and clear of the east alley wall
    for (let k = 1; k < row.length; k++) expect(row[k].x).toBe(row[k - 1].x + row[k - 1].w);
    expect(PET_SHOP_FRONT.x + PET_SHOP_FRONT.w).toBeLessThanOrEqual(MARKET_W - 40);
    const shops = [
      ["furniture_shop", "Nội thất cô Năm", "co_nam", FURNITURE_FRONT],
      ["motel", "Nhà nghỉ Hoa Sen", "co_hong", MOTEL_FRONT],
      ["pet_shop", "Tiệm thú cưng", "co_muoi", PET_SHOP_FRONT],
    ] as const;
    for (const [id, label, npcId, r] of shops) {
      const it = pick(id), cx = r.x + r.w / 2;
      expect(it, id).toMatchObject({ kind: id, label, rect: { x: r.x + 40, y: 130, w: 80, h: 30 }, use: { x: cx, y: 176 }, face: "up" });
      // the whole front is solid; the keeper stands behind the counter, in view, north of the customer
      for (const p of [{ x: r.x + 4, y: r.y + 4 }, { x: r.x + r.w - 4, y: r.y + r.h - 4 }]) expect(isBlockedAt(market, p.x, p.y), id).toBe(true);
      const npc = market.npcs.find((n) => n.id === npcId)!;
      expect(npc.spot, id).toEqual({ x: cx, y: 150, dir: "down" });
      expect(npc.spot.y).toBeGreaterThanOrEqual(it.rect.y);
      expect(npc.spot.y).toBeLessThan(it.use.y);
      expect(market.props.some((p) => p.kind === "shop_counter" && p.x === cx && p.y === 162), id).toBe(true);
      // the pavement in front stays open
      for (const dx of [-60, 0, 60]) expect(isBlockedAt(market, cx + dx, 190), `${id} ${dx}`).toBe(false);
    }
  });
  it("leaves the street clear where the kiosks used to stand, and keeps the Khu nhà road at the east end", () => {
    for (const p of [{ x: 456, y: 228 }, { x: 556, y: 228 }, { x: 732, y: 228 }, { x: 1000, y: 250 }, { x: 1160, y: 250 }]) {
      expect(isBlockedAt(market, p.x, p.y), JSON.stringify(p)).toBe(false);
    }
    const road = pick("market_to_khu_nha");
    expect(road.rect.x + road.rect.w).toBeLessThanOrEqual(MARKET_W);
    expect(road.rect.x).toBeGreaterThan(PET_SHOP_FRONT.x + PET_SHOP_FRONT.w - 40);
    expect(isBlockedAt(market, MARKET_EAST_ARRIVE.x, MARKET_EAST_ARRIVE.y)).toBe(false);
    expect(findPath(market, market.spawn, MARKET_EAST_ARRIVE)).not.toBeNull();
    expect(Math.hypot(road.use.x - MARKET_EAST_ARRIVE.x, road.use.y - MARKET_EAST_ARRIVE.y)).toBeGreaterThan(PROMPT_RANGE);
  });
  it("keeps the solid buildings from overlapping one another", () => {
    const fronts = [RESTAURANT_FRONT, SHOWROOM_FRONT, CLOTHES_FRONT, SALON_FRONT, FURNITURE_FRONT, MOTEL_FRONT, PET_SHOP_FRONT, ...STALLS.map((s) => s.rect)];
    for (let i = 0; i < fronts.length; i++) for (let j = i + 1; j < fronts.length; j++) expect(overlaps(fronts[i], fronts[j]), `${i}/${j}`).toBe(false);
    for (const r of fronts) expect(r.x >= 0 && r.x + r.w <= MARKET_W && r.y >= 40 && r.y + r.h <= 384, JSON.stringify(r)).toBe(true);
  });
  it("keeps the use spots apart: no two share a prompt range", () => {
    const its = market.interactables;
    for (let i = 0; i < its.length; i++) for (let j = i + 1; j < its.length; j++) {
      const d = Math.hypot(its[i].use.x - its[j].use.x, its[i].use.y - its[j].use.y);
      expect(d, `${its[i].id}/${its[j].id}`).toBeGreaterThan(PROMPT_RANGE * 2);
    }
  });
  it("keeps the stalls from overlapping one another", () => {
    const rs = market.interactables.map((i) => i.rect);
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i], b = rs[j];
      expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, `${i}/${j}`).toBe(false);
    }
  });
  it("keeps the arrival and every use spot walkable and reachable from the spawn", () => {
    for (const s of [MARKET_ARRIVE, ...market.interactables.map((i) => i.use)]) {
      expect(isBlockedAt(market, s.x, s.y), JSON.stringify(s)).toBe(false);
      expect(findPath(market, market.spawn, s), JSON.stringify(s)).not.toBeNull();
    }
  });
  it("leads back to the hall, arriving out of the exit's prompt range", () => {
    const exit = pick("market_exit");
    expect(exit.to).toEqual({ map: "hall", arrive: HALL_MARKET_ARRIVE });
    expect(Math.hypot(exit.use.x - MARKET_ARRIVE.x, exit.use.y - MARKET_ARRIVE.y)).toBeGreaterThan(PROMPT_RANGE);
  });
  it("faces the counters from the street", () => {
    expect(pick("restaurant")).toMatchObject({ rect: { x: 100, y: 130, w: 80, h: 30 }, use: { x: 140, y: 176 }, face: "up" });
    expect(pick("clothes_shop")).toMatchObject({ rect: { x: 460, y: 130, w: 80, h: 30 }, use: { x: 500, y: 176 }, face: "up" });
  });
  it("puts cô Bếp and cô Sáu behind their counters, and every vendor in a blocked cell, facing down", () => {
    const bep = market.npcs.find((n) => n.id === "bep")!, sau = market.npcs.find((n) => n.id === "co_sau")!;
    expect(bep).toMatchObject({ name: "cô Bếp", spot: { x: 140, y: 150, dir: "down" } });
    expect(sau).toMatchObject({ name: "cô Sáu", spot: { x: 500, y: 150, dir: "down" } });
    for (const n of market.npcs) {
      expect(n.spot.dir, n.id).toBe("down");
      expect(isBlockedAt(market, n.spot.x, n.spot.y), n.id).toBe(true);
    }
    expect(new Set(market.npcs.map((n) => n.id)).size).toBe(market.npcs.length);
  });
  it("gives every prop a sprite frame", () => {
    for (const p of market.props) expect(propFrame(p).w, p.kind).toBeGreaterThan(0);
  });
});
