import { describe, expect, it } from "vitest";
import { getMap } from "@/lib/game/maps/registry";
import { APT_BLOCK, LOTS } from "@/lib/game/maps/khu-nha";
import { FURNITURE_FRONT, MOTEL_FRONT } from "@/lib/game/maps/market";
import { overlaps } from "@/lib/game/maps/rect";
import { isBlockedAt } from "@/lib/game/movement";
import { findPath } from "@/lib/game/pathfinding";
import { PROMPT_RANGE } from "@/lib/game/scene";
import { isRoadTrip, tripForward } from "@/lib/game/travel/vehicles";

describe("v19.2 Khu nhà", () => {
  const khu = getMap("khu_nha"), market = getMap("market");
  const find = (m: typeof khu, id: string) => m.interactables.find((i) => i.id === id)!;
  it("links Chợ Lớn's east end and Khu nhà both ways, by road", () => {
    const there = find(market, "market_to_khu_nha"), back = find(khu, "khu_nha_exit");
    expect(there.to!.map).toBe("khu_nha");
    expect(back.to!.map).toBe("market");
    for (const [m, p] of [[khu, there.to!.arrive], [market, back.to!.arrive]] as const) {
      expect(isBlockedAt(m, p.x, p.y)).toBe(false);
      expect(findPath(m, m.spawn, p)).not.toBeNull();
    }
    // arriving does not show the way-back prompt at once
    expect(Math.hypot(back.to!.arrive.x - there.use.x, back.to!.arrive.y - there.use.y)).toBeGreaterThan(PROMPT_RANGE);
    expect(Math.hypot(there.to!.arrive.x - back.use.x, there.to!.arrive.y - back.use.y)).toBeGreaterThan(PROMPT_RANGE);
    expect(isRoadTrip("market", "khu_nha") && isRoadTrip("khu_nha", "market")).toBe(true);
    expect(isRoadTrip("hall", "khu_nha")).toBe(false);
    expect([tripForward("hall", "market"), tripForward("market", "khu_nha"), tripForward("khu_nha", "market"), tripForward("market", "hall")])
      .toEqual([true, true, false, false]);
  });
  it("the block's lobby and cô Năm's counter are reachable from the spawn and solid behind", () => {
    const lobby = find(khu, "apartment"), shop = find(market, "furniture_shop");
    expect(lobby.kind).toBe("apartment");
    expect(shop.kind).toBe("furniture_shop");
    expect(findPath(khu, khu.spawn, lobby.use)).not.toBeNull();
    expect(findPath(market, market.spawn, shop.use)).not.toBeNull();
    expect(isBlockedAt(khu, APT_BLOCK.x + 20, APT_BLOCK.y + 60)).toBe(true);
    expect(isBlockedAt(market, FURNITURE_FRONT.x + 10, FURNITURE_FRONT.y + 10)).toBe(true);
    expect(overlaps(FURNITURE_FRONT, MOTEL_FRONT)).toBe(false);
    expect(LOTS).toHaveLength(8);
    for (const npc of [...khu.npcs, ...market.npcs.filter((n) => n.id === "co_nam")]) {
      const m = khu.npcs.includes(npc) ? khu : market;
      expect(isBlockedAt(m, npc.spot.x, npc.spot.y), npc.id).toBe(true);
    }
  });
});
