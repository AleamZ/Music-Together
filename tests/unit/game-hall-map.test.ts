import { describe, it, expect } from "vitest";
import { POND_ARRIVE } from "@/lib/game/maps/arrivals";
import { buildHallMap, HALL_CELL, HALL_H, HALL_W } from "@/lib/game/maps/hall";
import { isBlockedAt } from "@/lib/game/movement";
import { findPath } from "@/lib/game/pathfinding";

const hall = buildHallMap();

describe("hall map", () => {
  it("has the documented size and grid", () => {
    expect([hall.width, hall.height, hall.cell]).toEqual([HALL_W, HALL_H, HALL_CELL]);
    expect(hall.blocked).toHaveLength((640 / 8) * (400 / 8));
  });
  it("has walkable spawn, seats, stand spots and interactable use spots, all reachable from the spawn", () => {
    const seating = hall.seating!;
    const spots = [hall.spawn, ...seating.seats, ...seating.standSpots, ...hall.interactables.map((i) => i.use)];
    for (const s of spots) {
      expect(isBlockedAt(hall, s.x, s.y), JSON.stringify(s)).toBe(false);
      expect(findPath(hall, hall.spawn, s), JSON.stringify(s)).not.toBeNull();
    }
  });
  it("blocks the water but not the dock, and blocks the stage", () => {
    expect(isBlockedAt(hall, 300, 390)).toBe(true);
    expect(isBlockedAt(hall, 516, 380)).toBe(false);
    expect(isBlockedAt(hall, 320, 80)).toBe(true);
  });
  it("has unique interactables with the three v13 ids", () => {
    expect(hall.interactables.map((i) => i.id).sort()).toEqual(["dj_booth", "dock_sign", "notice_board"]);
  });
  it("makes the dock sign a portal to the pond, with a prompt for every interactable", () => {
    const dock = hall.interactables.find((i) => i.id === "dock_sign")!;
    expect(dock).toMatchObject({ kind: "portal", prompt: "Xuống ao câu cá", to: { map: "pond", arrive: POND_ARRIVE } });
    for (const i of hall.interactables) expect(i.prompt.length, i.id).toBeGreaterThan(0);
  });
  it("has six café seats and no shopkeepers", () => {
    expect(hall.seating!.seats).toHaveLength(6);
    expect(hall.npcs).toEqual([]);
  });
});
