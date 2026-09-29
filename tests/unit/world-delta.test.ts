import { describe, expect, it } from "vitest";
import { canalCrossings, floatingMarket, FLOATING_MARKET, mooredBoats, stiltHouses } from "@/lib/game/world/delta";
import { onPath, RIVER_LEVEL, standHeight, waterAt } from "@/lib/game/world/terrain";
import { wildBlocked } from "@/lib/game/world/wild";
import { zoneAt } from "@/lib/game/world/zones";

describe("the delta's life along the water", () => {
  it("bridges every road and trail over the canals (walkable decks over real water)", () => {
    const c = canalCrossings();
    expect(c.length).toBeGreaterThanOrEqual(2);
    expect(c.some((x) => x.monkey)).toBe(true);                               // a cầu khỉ on a trail
    for (const b of c) {
      expect(waterAt(b.x, b.y), `${b.x | 0},${b.y | 0}`).toBe(RIVER_LEVEL);
      expect(wildBlocked(b.x, b.y)).toBe(false);
      expect(b.len, "a crossing, not a path running along a canal").toBeLessThan(120);
      expect(standHeight(b.x, b.y)).toBeGreaterThan(RIVER_LEVEL);
    }
  });

  it("puts stilt houses on dry banks off the paths, solid, each with a xuồng on the water", () => {
    const hs = stiltHouses();
    expect(hs.length).toBeGreaterThan(10);
    for (const h of hs) {
      expect(zoneAt(h)).toBe("wild");
      expect(waterAt(h.x, h.y)).toBeNull();
      expect(onPath(h.x, h.y)).toBe(false);
      expect(wildBlocked(h.x, h.y)).toBe(true);
    }
    for (const b of mooredBoats()) expect(waterAt(b.x, b.y)).toBe(RIVER_LEVEL);
  });

  it("gathers a floating market of ghe on the river", () => {
    const m = floatingMarket();
    expect(m.length).toBeGreaterThanOrEqual(8);
    for (const b of m) {
      expect(waterAt(b.x, b.y)).toBe(RIVER_LEVEL);
      expect(Math.hypot(b.x - FLOATING_MARKET.x, b.y - FLOATING_MARKET.y)).toBeLessThan(FLOATING_MARKET.r + 1);
    }
  });
});

describe("the hamlets", () => {
  it("lotus ponds, garden houses and tạp hóa shops stand on dry land off the paths, solid", async () => {
    const { gardenSpots, lotusPonds, villageShops } = await import("@/lib/game/world/delta");
    expect(lotusPonds().length).toBeGreaterThanOrEqual(3);
    expect(gardenSpots().length).toBeGreaterThanOrEqual(2);
    const shops = villageShops();
    expect(shops.length).toBeGreaterThanOrEqual(2);
    for (const s of shops) expect(s.name).toMatch(/^TẠP HÓA /);
    for (const p of [...lotusPonds(), ...gardenSpots(), ...shops]) {
      expect(zoneAt(p)).toBe("wild");
      expect(waterAt(p.x, p.y)).toBeNull();
      expect(onPath(p.x, p.y)).toBe(false);
      expect(wildBlocked(p.x, p.y)).toBe(true);
    }
  });
});
