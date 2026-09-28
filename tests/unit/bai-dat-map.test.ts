import { describe, expect, it } from "vitest";
import { inShade } from "@/lib/game/heat/shade";
import { BAI_DAT_ARRIVE, MARKET_BRIDGE_ARRIVE } from "@/lib/game/maps/arrivals";
import { RING_RECTS, cornerSpot } from "@/lib/game/maps/bai-dat";
import { CITY_PLACES } from "@/lib/game/maps/city";
import { BRIDGE_PORTAL } from "@/lib/game/maps/market";
import { getMap } from "@/lib/game/maps/registry";
import type { GameMap, Interactable } from "@/lib/game/maps/types";
import { isRoadTrip } from "@/lib/game/travel/vehicles";

const find = (m: GameMap, id: string): Interactable => m.interactables.find((i) => i.id === id)!;
const blockedAt = (m: GameMap, x: number, y: number): boolean => m.blocked[Math.floor(y / m.cell) * m.cols + Math.floor(x / m.cell)] === 1;

describe("Bãi đất trống (v20.3 spec 'Map')", () => {
  const bai = getMap("bai_dat"), market = getMap("market");

  it("is reached over the bridge in Chợ Lớn's south-east canal wall, and back", () => {
    expect(bai.width).toBe(800);
    expect(bai.height).toBe(400);
    const there = find(market, "market_to_bai_dat"), back = find(bai, "bai_dat_exit");
    expect(BRIDGE_PORTAL).toEqual({ x: 1164, y: 372, w: 32, h: 24 });
    expect(there).toMatchObject({ kind: "portal", rect: BRIDGE_PORTAL, use: { x: 1180, y: 358 }, face: "down" });
    expect(there.to).toEqual({ map: "bai_dat", arrive: BAI_DAT_ARRIVE });
    expect(BAI_DAT_ARRIVE).toEqual({ x: 400, y: 48, dir: "down" });
    expect(back.to).toEqual({ map: "market", arrive: MARKET_BRIDGE_ARRIVE });
    expect(back.rect.x <= 400 && back.rect.x + back.rect.w >= 400 && back.rect.y <= 12 && back.rect.y + back.rect.h >= 12).toBe(true);
    // the canal wall is open between x 1160 and 1200 only
    expect(blockedAt(market, 1150, 388)).toBe(true);
    expect(blockedAt(market, 1180, 388)).toBe(false);
    expect(blockedAt(market, 1210, 388)).toBe(true);
    expect(isRoadTrip("market", "bai_dat") || isRoadTrip("bai_dat", "market")).toBe(false);
    expect(bai.spawn).toEqual(BAI_DAT_ARRIVE);
  });

  it("has four rings with a red and a blue corner each, at the spec's spots, under the shade", () => {
    expect(RING_RECTS).toEqual([
      { x: 100, y: 100, w: 200, h: 100 }, { x: 500, y: 100, w: 200, h: 100 },
      { x: 100, y: 260, w: 200, h: 100 }, { x: 500, y: 260, w: 200, h: 100 },
    ]);
    const corners = bai.interactables.filter((i) => i.kind === "ring_corner");
    expect(corners).toHaveLength(8);
    RING_RECTS.forEach((r, i) => {
      const red = find(bai, `ring_${i + 1}_red`), blue = find(bai, `ring_${i + 1}_blue`);
      expect(red).toMatchObject({ ring: i + 1, corner: "red", use: { x: r.x + 16, y: r.y + r.h / 2 }, face: "right" });
      expect(blue).toMatchObject({ ring: i + 1, corner: "blue", use: { x: r.x + r.w - 16, y: r.y + r.h / 2 }, face: "left" });
      expect(cornerSpot(i + 1, "red")).toEqual({ x: r.x + 16, y: r.y + 50, dir: "right" });
      for (const c of [red, blue]) {
        expect(inShade("bai_dat", c.use)).toBe(true);
        expect(blockedAt(bai, c.use.x, c.use.y)).toBe(false);
      }
    });
    expect(inShade("bai_dat", { x: 400, y: 230 })).toBe(false);
  });

  it("every use spot and the arrival are walkable; the board, the bag and the city map are there", () => {
    for (const it of bai.interactables) expect(blockedAt(bai, it.use.x, it.use.y), it.id).toBe(false);
    expect(blockedAt(bai, BAI_DAT_ARRIVE.x, BAI_DAT_ARRIVE.y)).toBe(false);
    expect(blockedAt(market, MARKET_BRIDGE_ARRIVE.x, MARKET_BRIDGE_ARRIVE.y)).toBe(false);
    expect(bai.interactables.map((i) => i.kind)).toEqual(expect.arrayContaining(["city_map", "ring_board", "punch_bag", "portal"]));
    expect(CITY_PLACES.bai_dat).toMatchObject({ name: "Bãi đất trống", at: { x: 86, y: 70 } });
    expect(CITY_PLACES.bai_dat.places).toEqual(["4 sàn đấu", "Bảng thành tích", "Bao cát"]);
  });
});
