// 0097: Rừng tràm (the 2D window of the forest), the felled trees shared by 2D and 3D, the forest's animals.
import { beforeEach, describe, expect, it } from "vitest";
import { addFelled, felledKeys, isFelled, resetFelledForTests, setFelled, subscribeFelled } from "@/lib/game/forest/felled-store";
import { RUNG_TRAM_ORIGIN } from "@/lib/game/forest/catalog";
import { cellTrees, felledPoints } from "@/lib/game/forest/near";
import { rungTramTrees } from "@/lib/game/forest/trees2d";
import { getMap } from "@/lib/game/maps/registry";
import { RT_ORIGIN, rtForest } from "@/lib/game/maps/rung-tram";
import { isBlockedAt } from "@/lib/game/movement";
import { findPath } from "@/lib/game/pathfinding";
import { photoOnly, speciesOf, WILD_ITEMS } from "@/lib/game/realm/model";
import { nearForest } from "@/lib/game/world/forest-grid";
import { buildWorld } from "@/lib/game/world/compose";
import { FARM_ANIM } from "@/lib/game/net/protocol";

describe("Rừng tràm, the 2D window", () => {
  const m = getMap("rung_tram");
  it("is the server's window (0097 _forest_origin) and walkable only on the forest", () => {
    expect(RT_ORIGIN).toEqual(RUNG_TRAM_ORIGIN);
    expect(isBlockedAt(m, m.spawn.x, m.spawn.y)).toBe(false);
    expect(nearForest(m.spawn.x + RT_ORIGIN.x, m.spawn.y + RT_ORIGIN.y)).toBe(true);
    let open = 0;
    for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
      const x = c * m.cell + m.cell / 2, y = r * m.cell + m.cell / 2;
      if (m.blocked[r * m.cols + c] === 0) { open++; if (x > 40) expect(rtForest(x, y) || Math.abs(x - 72) < 16).toBe(true); }
    }
    expect(open / (m.rows * m.cols)).toBeGreaterThan(0.6);
  });
  it("joins Bãi đất trống's south gate both ways (2D only: the 3D world has the real forest)", () => {
    const gate = getMap("bai_dat").interactables.find((i) => i.id === "rung_tram_gate")!;
    expect(gate.to?.map).toBe("rung_tram");
    expect(gate.only2d).toBe(true);
    const exit = m.interactables.find((i) => i.id === "rung_tram_exit")!;
    expect(exit.to?.map).toBe("bai_dat");
    expect(findPath(m, m.spawn, exit.use)).not.toBeNull();
    expect(findPath(getMap("bai_dat"), getMap("bai_dat").spawn, gate.use)).not.toBeNull();
    expect(buildWorld().interactables.some((i) => i.id === "rung_tram_gate")).toBe(false);
  }, 30_000);
  it("has the forest's own trees, in the map's px", () => {
    const trees = rungTramTrees();
    expect(trees.length).toBeGreaterThan(20);
    for (const t of trees) {
      expect(t.x).toBeGreaterThanOrEqual(0); expect(t.x).toBeLessThan(640);
      expect(cellTrees(t.cx, t.cy)[t.k]).toEqual({ x: t.x + RT_ORIGIN.x, y: t.y + RT_ORIGIN.y });
    }
  }, 30_000);
});

describe("the felled trees, shared", () => {
  beforeEach(() => resetFelledForTests());
  it("follow the server's list and clock, and notify only on a change", () => {
    let n = 0;
    subscribeFelled(() => { n++; });
    setFelled([{ tree: "1:2:3", respawnMs: 10_000 }], 5_000);                // 5 s left
    expect(isFelled("1:2:3")).toBe(true);
    expect(isFelled("1:2:3", Date.now() + 6_000)).toBe(false);
    expect(n).toBe(1);
    setFelled([{ tree: "1:2:3", respawnMs: 10_000 }], 5_000);
    expect(n).toBe(1);
    addFelled("4:5:6", Date.now() + 1000);
    expect(felledKeys()).toEqual(["1:2:3", "4:5:6"]);
    expect(n).toBe(2);
  });
  it("map to the 3D forest's trees", () => {
    const t = rungTramTrees()[0];
    expect(felledPoints([t.key])).toEqual([{ x: t.x + RT_ORIGIN.x, y: t.y + RT_ORIGIN.y }]);
    expect(felledPoints(["-9:-9:0"])).toEqual([]);
  }, 30_000);
});

describe("the forest's animals (forest-content)", () => {
  it("three for the pot, three for the album only", () => {
    for (const id of ["chuot_dong", "ga_rung", "ran_ri_ca"]) {
      const sp = speciesOf(id)!;
      expect(photoOnly(sp)).toBe(false);
      expect(WILD_ITEMS[sp.drop!].name).toMatch(/^Thịt/);
    }
    for (const id of ["cay_huong", "co_trang", "rua_hop_lung_den"]) expect(photoOnly(speciesOf(id)!)).toBe(true);
  });
  it("chop and cook are animations everyone sees", () => {
    expect([FARM_ANIM.chop, FARM_ANIM.cook]).toEqual([13, 14]);
  });
});
