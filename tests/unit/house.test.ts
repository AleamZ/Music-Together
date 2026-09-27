import { describe, expect, it } from "vitest";
import {
  buildCost, canPlaceHouse, checkDesign, designOf, doorFronts, EMPTY_DESIGN, entryOf, frontDoors, houseErrorMessage, houseGrid,
  HOUSE_TEMPLATES, isEmptyDesign, LOT_COLS, LOT_ROWS, LOT_TILE, parseHouseLayout, parseHouseList, rentShare, roomsOf, TILE_PRICES, type HousePlaced,
} from "@/lib/game/housing/house";
import { isBlockedAt } from "@/lib/game/movement";

/** Rows of a design (shorter rows and missing rows are yard). */
const D = (...rows: string[]) => designOf(rows);

const TWO_ROOMS = D(
  "",
  "..wwwwwwwww",
  "..wfffwfffw",
  "..nfffdfffn",
  "..wfffwfffw",
  "..wfffwfffw",
  "..wwdwwwwww",
);

describe("v19.3 house designs", () => {
  it("a design is 20 × 14 cells; designOf pads with yard", () => {
    expect(EMPTY_DESIGN).toHaveLength(LOT_COLS * LOT_ROWS);
    expect(TWO_ROOMS).toHaveLength(280);
    expect(isEmptyDesign(EMPTY_DESIGN)).toBe(true);
    expect(isEmptyDesign(TWO_ROOMS)).toBe(false);
  });

  it("accepts a closed two-room house with a front door", () => {
    expect(checkDesign(TWO_ROOMS)).toBeNull();
    const r = roomsOf(TWO_ROOMS);
    expect(r.count).toBe(2);
    expect(r.cells[2 * 20 + 3]).toBe(1);
    expect(r.cells[2 * 20 + 7]).toBe(2);
    expect(r.cells[0]).toBe(0);
    expect(frontDoors(TWO_ROOMS)).toEqual([6 * 20 + 4]);
    // the entry is the yard cell below the front door (feet, world px)
    expect(entryOf(TWO_ROOMS)).toEqual({ x: 4 * LOT_TILE + 8, y: 7 * LOT_TILE + 12 });
    expect(doorFronts(TWO_ROOMS)).toEqual(new Set([3 * 20 + 5, 3 * 20 + 7, 5 * 20 + 4]));
  });

  it("refuses broken designs, in order", () => {
    expect(checkDesign("x".repeat(280))).toBe("bad grid");
    expect(checkDesign(".".repeat(279))).toBe("bad grid");
    // a floor touching the yard
    expect(checkDesign(D("", "..wwwww", "..wfffw", "..wfff.", "..wwdww"))).toBe("open floor");
    // a door with yard on both open sides
    expect(checkDesign(D("", "..wwwww", "..wfffw", "..wfffw", "..wwwww", "...d"))).toBe("bad door");
    // a window inside the house
    expect(checkDesign(D("", "..wwwwwww", "..wfffnfw", "..wfffffw", "..wwdwwww"))).toBe("bad window");
    // walls only
    expect(checkDesign(D("", "..www"))).toBe("no room");
    // seven rooms
    expect(checkDesign(D("", "wwwwwwwwwwwwwww", "wfwfwfwfwfwfwfw", "wfwfwfwfwfwfwfw", "wfwfwfwfwfwfwfw", "wfwfwfwfwfwfwfw", "wdwdwdwdwdwdwdw")))
      .toBe("too many rooms");
    // a room of 2 cells
    expect(checkDesign(D("", "..wwww", "..wffw", "..wwdw"))).toBe("small room");
    // no front door
    expect(checkDesign(D("", "..wwwww", "..wfffw", "..wfffw", "..wwwww"))).toBe("no front door");
    // a second room with no door to it
    expect(checkDesign(D("", "..wwwwwwwww", "..wfffwfffw", "..wfffwfffw", "..wwdwwwwww"))).toBe("unreachable");
  });

  it("prices only the cells that change to a built type", () => {
    const n = (ch: string) => [...TWO_ROOMS].filter((c) => c === ch).length;
    const full = n("f") * TILE_PRICES.f + n("w") * TILE_PRICES.w + n("d") * TILE_PRICES.d + n("n") * TILE_PRICES.n;
    expect(buildCost(null, TWO_ROOMS)).toBe(full);
    expect(buildCost(TWO_ROOMS, TWO_ROOMS)).toBe(0);
    // turning a wall into a window costs the window; clearing costs nothing
    const win = TWO_ROOMS.slice(0, 2 * 20 + 2) + "n" + TWO_ROOMS.slice(2 * 20 + 3);
    expect(buildCost(TWO_ROOMS, win)).toBe(TILE_PRICES.n);
    expect(buildCost(TWO_ROOMS, EMPTY_DESIGN)).toBe(0);
  });

  it("every template is a valid house", () => {
    for (const t of HOUSE_TEMPLATES) expect(checkDesign(t.design), t.id).toBeNull();
    expect(roomsOf(HOUSE_TEMPLATES[2].design).count).toBe(5);
  });

  it("splits the rent 95 / 5", () => {
    expect(rentShare(1000)).toEqual({ owner: 950, fee: 50 });
    expect(rentShare(333)).toEqual({ owner: 316, fee: 17 });
  });
});

describe("v19.3 furniture in a house", () => {
  const items: HousePlaced[] = [{ id: 1, item: "table_go", x: 3, y: 2, rot: 0, mine: true }];
  it("fits on the floor of one room, off the door fronts, not overlapping", () => {
    const at = (p: Partial<HousePlaced>, rooms: number[] | null = null) =>
      canPlaceHouse(TWO_ROOMS, items, { id: 9, item: "chair_go", x: 8, y: 2, rot: 0, mine: true, ...p }, rooms);
    expect(at({})).toBeNull();
    expect(at({ x: 2 })).toBe("not floor");                 // a wall
    expect(at({ item: "sofa_go", x: 5, y: 2 })).toBe("not floor");
    expect(at({ x: 5, y: 3 })).toBe("door");
    expect(at({ x: 4, y: 3 })).toBe("overlap");             // the table (2 × 2 at 3,2)
    expect(at({ item: "rug_do", x: 3, y: 2, rot: 1 })).toBeNull();  // rugs only collide with rugs
    expect(at({ x: -1 })).toBe("bounds");
    expect(at({ item: "wall_kem" })).toBe("not placeable");
    expect(at({}, [1])).toBe("not your room");
    expect(at({}, [2])).toBeNull();
    // the table on its own spot is fine
    expect(canPlaceHouse(TWO_ROOMS, items, items[0], null)).toBeNull();
    expect(canPlaceHouse(TWO_ROOMS, items, { ...items[0], x: 6 }, null)).toBe("not floor");
  });

  it("the walking grid: walls and furniture are solid, yard, doors and rugs are not", () => {
    const g = houseGrid(TWO_ROOMS, [...items, { id: 2, item: "rug_do", x: 7, y: 2, rot: 0, mine: false }]);
    expect(g.width).toBe(LOT_COLS * LOT_TILE);
    expect(g.height).toBe(LOT_ROWS * LOT_TILE);
    const c = (col: number, row: number) => isBlockedAt(g, col * LOT_TILE + 8, row * LOT_TILE + 8);
    expect(c(2, 1)).toBe(true);    // wall
    expect(c(2, 3)).toBe(true);    // window
    expect(c(4, 6)).toBe(false);   // front door
    expect(c(0, 0)).toBe(false);   // yard
    expect(c(3, 2)).toBe(true);    // table
    expect(c(8, 3)).toBe(false);   // rug
  });
});

describe("v19.3 parsing and texts", () => {
  it("parses the street list", () => {
    const l = parseHouseList({
      lots: [
        { no: 1, owned: true, owner_name: "An", mine: true, grid: TWO_ROOMS, roof: "tole", visibility: "open",
          rooms: [{ no: 1, cells: 12, price: 800, taken: false, mine: false }, { no: 2, cells: 12, price: null, taken: false, mine: false }] },
        { no: 2, owned: false, owner_name: null, mine: false, grid: null, roof: "ngoi", visibility: "private", rooms: [] },
        { no: 99 },
      ],
      mine: { no: 1, paid_until_ms: 5, repossess_ms: 10, build_cost: 900, visibility: "open", wall: null, floor: "floor_go",
        rooms: [{ no: 1, cells: 12, price: 800, tenant_name: "Bình", until_ms: 7 }] },
      tenancy: null,
      server_now_ms: 3, coins: 12,
    });
    expect(l).not.toBeNull();
    expect(l!.lots).toHaveLength(2);
    expect(l!.lots[0]).toMatchObject({ no: 1, ownerName: "An", mine: true, roof: "tole", visibility: "open" });
    expect(l!.lots[0].rooms[0]).toEqual({ no: 1, cells: 12, price: 800, taken: false, mine: false });
    expect(l!.lots[1].grid).toBeNull();
    expect(l!.mine).toMatchObject({ no: 1, paidUntilMs: 5, repossessMs: 10, buildCost: 900, floor: "floor_go" });
    expect(l!.mine!.rooms[0].tenantName).toBe("Bình");
    expect(l!.coins).toBe(12);
    expect(parseHouseList({})).toBeNull();
  });

  it("parses a house layout; a bad grid is dropped", () => {
    const h = parseHouseLayout({
      lot: 3, owner_id: "o", owner_name: "An", can_edit: false, my_room: 2, visibility: "room", grid: TWO_ROOMS, roof: "la",
      wall: null, floor: null, rooms: [{ no: 2, price: 600, tenant_name: "Tôi", until_ms: 9 }],
      items: [{ id: 4, item: "bed_go", x: 7, y: 2, rot: 0, mine: true }], server_now_ms: 1,
    });
    expect(h).toMatchObject({ lot: 3, ownerName: "An", canEdit: false, myRoom: 2, roof: "la", visibility: "room" });
    expect(h!.items[0]).toEqual({ id: 4, item: "bed_go", x: 7, y: 2, rot: 0, mine: true });
    expect(parseHouseLayout({ lot: 3, owner_id: "o", grid: "short" })).toBeNull();
  });

  it("maps the server's refusals", () => {
    expect(houseErrorMessage("upkeep due")).toContain("phí");
    expect(houseErrorMessage("has tenants")).toContain("người thuê");
    expect(houseErrorMessage("already have a home")).toContain("nhà");
    expect(houseErrorMessage("unreachable")).toContain("cửa");
    expect(houseErrorMessage("zzz")).toBe("Có lỗi, thử lại sau nhé.");
  });
});
