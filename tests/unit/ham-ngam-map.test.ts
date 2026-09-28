import { describe, expect, it } from "vitest";
import { VISIBLE_MAP_IDS, cityRoads } from "@/lib/game/maps/city";
import { CAGE, CAGE_WATCH, CAGE_WATCH_IDS, HAM_ARRIVE, HAM_H, HAM_W } from "@/lib/game/maps/ham-ngam";
import { UG_HATCH, UG_HATCH_USE } from "@/lib/game/maps/market";
import { getMap } from "@/lib/game/maps/registry";
import { INDOOR_MAPS, inShade } from "@/lib/game/heat/shade";
import { canRide } from "@/lib/game/travel/ride";
import { isBlockedAt } from "@/lib/game/movement";
import { findPath } from "@/lib/game/pathfinding";
import { CAGE_RANGE } from "@/lib/game/fight/underground";

// v20.4 the hầm (spec §v20.4 "Unlock and entrance", "The map"; plan rulings U15, U16).
describe("the hidden map ham_ngam", () => {
  const ham = getMap("ham_ngam");
  it("is 480 × 320 with every use spot walkable and reachable from the ladder's foot", () => {
    expect([ham.width, ham.height]).toEqual([HAM_W, HAM_H]);
    expect([HAM_W, HAM_H]).toEqual([480, 320]);
    expect(isBlockedAt(ham, HAM_ARRIVE.x, HAM_ARRIVE.y)).toBe(false);
    for (const it of ham.interactables) {
      expect(isBlockedAt(ham, it.use.x, it.use.y), it.id).toBe(false);
      expect(findPath(ham, ham.spawn, it.use), it.id).not.toBeNull();
    }
    expect(ham.npcs.map((n) => n.name)).toEqual(["Anh Tư Sẹo"]);
  });
  it("has Tư Sẹo, the board, the ladder door, the cage's watch spots and the ladder up", () => {
    const kinds = ham.interactables.map((i) => [i.id, i.kind]);
    expect(kinds).toEqual([
      ["city_map", "city_map"], ["ham_ngam_exit", "portal"], ["tu_seo", "ug_organizer"], ["ug_board", "ug_board"],
      ["ug_door", "ug_door"], ["cage_n", "cage_watch"], ["cage_s", "cage_watch"], ["cage_w", "cage_watch"], ["cage_e", "cage_watch"],
    ]);
    expect(CAGE_WATCH_IDS).toEqual(["cage_n", "cage_s", "cage_w", "cage_e"]);
    // every watch spot is within 64 px of the cage (spec: "within 64 px of the cage")
    for (const w of CAGE_WATCH) {
      const dx = Math.max(CAGE.x - w.use.x, 0, w.use.x - (CAGE.x + CAGE.w));
      const dy = Math.max(CAGE.y - w.use.y, 0, w.use.y - (CAGE.y + CAGE.h));
      expect(Math.hypot(dx, dy), w.id).toBeLessThanOrEqual(CAGE_RANGE);
    }
    expect(isBlockedAt(ham, CAGE.x + CAGE.w / 2, CAGE.y + CAGE.h / 2)).toBe(true);
  });
  it("is hidden: no road, not on the overview", () => {
    expect(VISIBLE_MAP_IDS).not.toContain("ham_ngam");
    expect(cityRoads().flat()).not.toContain("ham_ngam");
  });
  it("is indoors (R7: an unlisted map), and no vehicle goes down", () => {
    expect(INDOOR_MAPS.has("ham_ngam")).toBe(true);
    expect(inShade("ham_ngam", { x: 5, y: 5 })).toBe(true);
    expect(inShade("ham_ngam", { x: 470, y: 310 })).toBe(true);
    for (const v of ["bike", "moto", "car"] as const) expect(canRide("ham_ngam", v)).toBe(false);
  });
});

describe("the hatch in Chợ Lớn", () => {
  const market = getMap("market");
  const hatch = market.interactables.find((i) => i.kind === "ug_hatch")!;
  it("sits between the lantern stall and Vựa nông sản at (640, 368), used from (640, 352) facing down", () => {
    expect(UG_HATCH).toEqual({ x: 640, y: 368 });
    expect(UG_HATCH_USE).toEqual({ x: 640, y: 352 });
    expect(hatch).toMatchObject({ id: "ug_hatch", prompt: "Gõ cửa", use: { x: 640, y: 352 }, face: "down", to: { map: "ham_ngam" } });
    expect(isBlockedAt(market, 640, 352)).toBe(false);
    expect(findPath(market, market.spawn, hatch.use)).not.toBeNull();
  });
  it("the ladder back up lands on the pavement by the hatch", () => {
    const exit = getMap("ham_ngam").interactables.find((i) => i.id === "ham_ngam_exit")!;
    expect(exit.to).toMatchObject({ map: "market", arrive: { x: 640, y: 350 } });
    expect(hatch.to!.arrive).toEqual(HAM_ARRIVE);
  });
});