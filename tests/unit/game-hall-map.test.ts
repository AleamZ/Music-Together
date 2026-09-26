import { describe, it, expect } from "vitest";
import { FIELD_WEST_ARRIVE, HALL_DOCK_ARRIVE, HALL_FIELD_ARRIVE, POND_ARRIVE } from "@/lib/game/maps/arrivals";
import { buildHallMap, CARD_DECK, CARD_SOLIDS, HALL_CELL, HALL_H, HALL_PROPS, HALL_SOLIDS, HALL_W, overlaps } from "@/lib/game/maps/hall";
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
  it("has unique interactables: the three v13 ones, the v15 field sign and the v16 card corner", () => {
    expect(hall.interactables.map((i) => i.id).sort()).toEqual([
      "cards_cao", "cards_poker", "cards_sign", "cards_tienlen", "dj_booth", "dock_sign", "field_sign", "notice_board",
    ]);
  });
  it("makes the field sign a portal to the field's west entrance", () => {
    const sign = hall.interactables.find((i) => i.id === "field_sign")!;
    expect(sign).toMatchObject({ kind: "portal", prompt: "Ra đồng ruộng", to: { map: "field", arrive: FIELD_WEST_ARRIVE } });
  });
  it("makes the dock sign a portal to the pond, with a prompt for every interactable", () => {
    const dock = hall.interactables.find((i) => i.id === "dock_sign")!;
    expect(dock).toMatchObject({ kind: "portal", prompt: "Xuống ao câu cá", to: { map: "pond", arrive: POND_ARRIVE } });
    for (const i of hall.interactables) expect(i.prompt.length, i.id).toBeGreaterThan(0);
  });
  it("has the card corner of the v16 spec (§5): three tables and the sign, their labels and prompts", () => {
    const pick = (id: string) => hall.interactables.find((i) => i.id === id)!;
    expect(pick("cards_tienlen")).toMatchObject({ kind: "card_table", game: "tienlen", label: "Bàn Tiến lên", prompt: "Vào bàn Tiến lên" });
    expect(pick("cards_cao")).toMatchObject({ kind: "card_table", game: "cao", label: "Chiếu Cào", prompt: "Vào chiếu Cào" });
    expect(pick("cards_poker")).toMatchObject({ kind: "card_table", game: "poker", label: "Bàn Poker", prompt: "Vào bàn Poker" });
    expect(pick("cards_sign")).toMatchObject({ kind: "card_rules", label: "Góc đánh bài", prompt: "Đọc Sổ luật" });
    for (const id of ["cards_tienlen", "cards_cao", "cards_poker", "cards_sign"]) {
      const it = pick(id);
      expect(overlaps(CARD_DECK, it.rect), id).toBe(true);
      expect(isBlockedAt(hall, it.use.x, it.use.y), id).toBe(false);
      for (const from of [hall.spawn, HALL_DOCK_ARRIVE, HALL_FIELD_ARRIVE]) {
        expect(findPath(hall, from, it.use), `${id} from ${JSON.stringify(from)}`).not.toBeNull();
      }
    }
    expect(HALL_PROPS.filter((p) => p.kind === "card_table").map((p) => p.kind === "card_table" && p.game)).toEqual(["tienlen", "cao", "poker"]);
  });
  it("keeps the corner's tables off every other solid and off each other; the field sign stays reachable", () => {
    const tables = CARD_SOLIDS.slice(0, 3);
    const others = HALL_SOLIDS.filter((s) => !CARD_SOLIDS.includes(s));
    for (const t of tables) {
      for (const s of others) expect(overlaps(t, s), JSON.stringify([t, s])).toBe(false);
      for (const u of tables) if (u !== t) expect(overlaps(t, u)).toBe(false);
    }
    const sign = hall.interactables.find((i) => i.id === "field_sign")!;
    expect(findPath(hall, hall.spawn, sign.use)).not.toBeNull();
    expect(hall.seating!.standSpots).toContainEqual({ x: 300, y: 300, dir: "left" });
    expect(hall.seating!.standSpots.some((s) => overlaps(CARD_DECK, { x: s.x, y: s.y, w: 1, h: 1 }))).toBe(false);
  });
  it("has six café seats and no shopkeepers", () => {
    expect(hall.seating!.seats).toHaveLength(6);
    expect(hall.npcs).toEqual([]);
  });
});
