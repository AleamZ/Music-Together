import { describe, expect, it } from "vitest";
import {
  APT_CLEAR, APT_COLS, APT_ROWS, APT_TILE, APT_WALL_ROWS, aptErrorMessage, canPlace, FURNITURE, fridgeCapOf, furnitureOf, footprint,
  interiorGrid, nearestUsable, parseAptList, parseFridge, parseLayout, parseTv, tvPosition, youTubeIdOf, type Placed,
} from "@/lib/game/housing/apartment";
import { isBlockedAt } from "@/lib/game/movement";

const P = (id: number, item: string, x: number, y: number, rot = 0): Placed => ({ id, item, x, y, rot });

describe("the catalogue", () => {
  it("has every kind in several styles, unique ids and sane sizes", () => {
    const ids = FURNITURE.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const k of ["bed", "table", "chair", "sofa", "lamp", "plant", "rug", "shelf", "tv", "fridge", "wall", "floor"] as const) {
      expect(FURNITURE.some((f) => f.kind === k), k).toBe(true);
    }
    for (const k of ["bed", "table", "chair", "lamp"] as const) {
      expect(new Set(FURNITURE.filter((f) => f.kind === k).map((f) => f.style)).size, k).toBeGreaterThanOrEqual(3);
    }
    for (const f of FURNITURE) {
      expect(f.price, f.id).toBeGreaterThan(0);
      if (f.kind === "wall" || f.kind === "floor") expect([f.w, f.h]).toEqual([0, 0]);
      else expect(f.w * f.h, f.id).toBeGreaterThan(0);
    }
    expect(furnitureOf("tv")?.price).toBe(3000);
    expect(fridgeCapOf("fridge")).toBe(20);
    expect(fridgeCapOf("fridge_big")).toBe(50);
    expect(furnitureOf("fridge_big")?.price).toBe(6000);
  });
});

describe("placing on the grid", () => {
  it("rotation swaps the footprint", () => {
    expect(footprint("bed_go", 0)).toEqual({ w: 2, h: 3 });
    expect(footprint("bed_go", 1)).toEqual({ w: 3, h: 2 });
    expect(footprint("wall_kem", 0)).toBeNull();
  });
  it("refuses the wall, the edges, the door and overlaps; rugs lie under furniture", () => {
    expect(canPlace([], P(0, "chair_go", 0, APT_WALL_ROWS))).toBeNull();
    expect(canPlace([], P(0, "chair_go", 0, APT_WALL_ROWS - 1))).toBe("bounds");
    expect(canPlace([], P(0, "sofa_go", APT_COLS - 2, 4))).toBe("bounds");
    expect(canPlace([], P(0, "bed_go", 0, APT_ROWS - 2))).toBe("bounds");
    expect(canPlace([], P(0, "chair_go", APT_CLEAR[0].x, APT_CLEAR[0].y))).toBe("door");
    const bed = P(1, "bed_go", 0, 2);
    expect(canPlace([bed], P(0, "chair_go", 1, 3))).toBe("overlap");
    expect(canPlace([bed], P(0, "rug_do", 0, 3))).toBeNull();
    expect(canPlace([bed, P(2, "rug_do", 0, 3)], P(0, "rug_xanh", 2, 4))).toBe("overlap");
    // moving an item ignores itself
    expect(canPlace([bed], P(1, "bed_go", 0, 3))).toBeNull();
    expect(canPlace([], P(0, "wall_kem", 0, 3))).toBe("not placeable");
    expect(canPlace([], P(0, "nope", 0, 3))).toBe("not placeable");
    expect(canPlace([], P(0, "chair_go", 3, 3, 4))).toBe("bounds");
  });
  it("caps the room at 60 items", () => {
    const many = Array.from({ length: 60 }, (_, i) => P(i + 1, "rug_do", 0, 2));
    expect(canPlace(many, P(0, "chair_go", 10, 3))).toBe("too many");
  });
});

describe("walking inside", () => {
  it("walls and furniture block, rugs and the door do not", () => {
    const g = interiorGrid([P(1, "bed_go", 0, 2), P(2, "rug_do", 8, 5)]);
    expect(g.width).toBe(APT_COLS * APT_TILE);
    expect(g.height).toBe(APT_ROWS * APT_TILE);
    expect(isBlockedAt(g, 100, 10)).toBe(true);                          // the wall
    expect(isBlockedAt(g, 8, 50)).toBe(true);                            // the bed
    expect(isBlockedAt(g, 8 * APT_TILE + 10, 5 * APT_TILE + 10)).toBe(false); // on the rug
    expect(isBlockedAt(g, 7 * APT_TILE, 9 * APT_TILE + 8)).toBe(false);  // the door mat
  });
  it("finds the nearest bed, TV or fridge within reach", () => {
    const placed = [P(1, "bed_go", 0, 2), P(2, "tv", 10, 2), P(3, "fridge", 13, 5), P(4, "chair_go", 5, 5)];
    expect(nearestUsable(placed, { x: 2 * APT_TILE + 6, y: 3 * APT_TILE })?.id).toBe(1);
    expect(nearestUsable(placed, { x: 11 * APT_TILE, y: 3 * APT_TILE + 8 })?.id).toBe(2);
    expect(nearestUsable(placed, { x: 13 * APT_TILE - 4, y: 5 * APT_TILE + 8 })?.id).toBe(3);
    expect(nearestUsable(placed, { x: 6 * APT_TILE + 8, y: 8 * APT_TILE })).toBeNull();
  });
});

describe("parsing the server's answers", () => {
  it("the block list", () => {
    const s = parseAptList({
      units: [{ no: 1, status: "own", owner_name: "An", visibility: "open", mine: true }, { no: 2, status: "free" }, { no: 99 }],
      mine: { no: 1, tenure: "own", paid_until_ms: null, grace_until_ms: null, visibility: "open", wall: "wall_go", floor: null },
      storage: [{ id: 5, item: "chair_go" }, { id: "x", item: 3 }],
      knocks: [{ account_id: "k", name: "Bình", at_ms: 5 }],
      server_now_ms: 1000, coins: 7,
    })!;
    expect(s.units).toHaveLength(2);
    expect(s.units[0]).toEqual({ no: 1, status: "own", ownerName: "An", visibility: "open", mine: true });
    expect(s.units[1]).toMatchObject({ no: 2, status: "free", ownerName: null, mine: false });
    expect(s.mine).toEqual({ no: 1, tenure: "own", paidUntilMs: null, graceUntilMs: null, visibility: "open", wall: "wall_go", floor: null });
    expect(s.storage).toEqual([{ id: 5, item: "chair_go" }]);
    expect(s.knocks).toEqual([{ accountId: "k", name: "Bình", atMs: 5 }]);
    expect(s.coins).toBe(7);
    expect(parseAptList({})).toBeNull();
  });
  it("a layout, the fridge and the TV", () => {
    expect(parseLayout({ no: 3, owner_id: "o", owner_name: "An", can_edit: true, visibility: "room", wall: null, floor: "floor_go",
      items: [{ id: 1, item: "tv", x: 2, y: 3, rot: 1 }, { id: 2 }], server_now_ms: 5 }))
      .toEqual({ no: 3, ownerId: "o", ownerName: "An", canEdit: true, visibility: "room", wall: null, floor: "floor_go",
        items: [{ id: 1, item: "tv", x: 2, y: 3, rot: 1 }] });
    expect(parseFridge({ cap: 20, bag: 3, bag_cap: 11, fish: [{ id: "f", species_id: "ca_ro", weight_g: 300, price: 40 }] }))
      .toEqual({ cap: 20, bag: 3, bagCap: 11, fish: [{ id: "f", speciesId: "ca_ro", weightG: 300, price: 40 }] });
    const tv = parseTv({ current: { id: "a", v: "dQw4w9WgXcQ", t: "Bài", by: "An", d: 200 }, queue: [{ id: "b", v: "abcdefghijk", t: "X", by: "B" }],
      started_at_ms: 1000, server_now_ms: 5000 })!;
    expect(tv.current).toEqual({ id: "a", videoId: "dQw4w9WgXcQ", title: "Bài", by: "An", durationS: 200 });
    expect(tv.queue).toHaveLength(1);
    expect(tvPosition(tv, 9000, 0)).toBe(8);
    expect(tvPosition({ ...tv, current: null }, 9000, 0)).toBe(0);
  });
  it("YouTube links", () => {
    expect(youTubeIdOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youTubeIdOf("https://youtu.be/dQw4w9WgXcQ?t=3")).toBe("dQw4w9WgXcQ");
    expect(youTubeIdOf("hello")).toBeNull();
  });
  it("texts", () => {
    expect(aptErrorMessage("insufficient funds")).toContain("Không đủ xu");
    expect(aptErrorMessage("no access")).toContain("gõ cửa");
    expect(aptErrorMessage("overlap")).toContain("chồng");
    expect(aptErrorMessage("??")).toBe("Có lỗi, thử lại sau nhé.");
  });
});
