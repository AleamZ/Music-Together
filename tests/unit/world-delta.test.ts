import { describe, expect, it } from "vitest";
import { canalCrossings, floatingMarket, FLOATING_MARKET, mooredBoats, stiltHouses } from "@/lib/game/world/delta";
import { onPath, RIVER_LEVEL, standHeight, waterAt } from "@/lib/game/world/terrain";
import { wildBlocked } from "@/lib/game/world/wild";
import { zoneAt } from "@/lib/game/world/zones";

describe("the delta's life along the water", () => {
  it("bridges every road and trail over the canals (walkable decks over real water)", () => {
    const c = canalCrossings();
    expect(c.length).toBeGreaterThan(3);
    expect(c.some((x) => x.monkey)).toBe(true);                               // a cầu khỉ on a trail
    for (const b of c) {
      expect(waterAt(b.x, b.y), `${b.x | 0},${b.y | 0}`).toBe(RIVER_LEVEL);
      expect(wildBlocked(b.x, b.y)).toBe(false);
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
