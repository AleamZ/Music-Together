import { describe, expect, it } from "vitest";
import { hallLayout } from "@/lib/game/diorama/zones/hall";
import { khuNhaLayout } from "@/lib/game/diorama/zones/khu_nha";
import { blockedAt, FLAT, HEADROOM, MAX_LIGHTS, zoneHeightAt, type ZoneLayout } from "@/lib/game/diorama/zones/kit";
import { marketLayout } from "@/lib/game/diorama/zones/market";
import { getMap } from "@/lib/game/maps/registry";
import { LOTS } from "@/lib/game/maps/khu-nha";
import { LANTERN_POSTS, STALLS } from "@/lib/game/maps/market";
import type { GameMap, MapId } from "@/lib/game/maps/types";

const ZONES: Array<[MapId, (m: GameMap) => ZoneLayout]> = [["hall", hallLayout], ["market", marketLayout], ["khu_nha", khuNhaLayout]];

/** Every map cell a footprint covers (shrunk by `inset` px), as cell centres. */
function cellsUnder(map: GameMap, x: number, y: number, w: number, d: number, inset = 2): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const x0 = x + inset, y0 = y + inset, x1 = x + w - inset, y1 = y + d - inset;
  if (x1 <= x0 || y1 <= y0) return [[x + w / 2, y + d / 2]];
  for (let cy = Math.floor(y0 / map.cell); cy * map.cell < y1; cy++) for (let cx = Math.floor(x0 / map.cell); cx * map.cell < x1; cx++) {
    out.push([cx * map.cell + map.cell / 2, cy * map.cell + map.cell / 2]);
  }
  return out;
}

describe.each(ZONES)("zone diorama %s", (id, layout) => {
  const map = getMap(id);
  const L = layout(map);

  it("covers the map with ground tiles", () => {
    expect(L.width).toBe(map.width);
    expect(L.ground.length).toBe(L.cols * L.rows);
    expect(L.cols * L.tile).toBeGreaterThanOrEqual(map.width);
  });

  it("draws every prop of the map", () => {
    const count = (kinds: string[]) => kinds.reduce<Record<string, number>>((acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + 1 }), {});
    expect(count(L.pieces.map((p) => p.kind))).toEqual(count(map.props.map((p) => p.kind)));
    expect(L.palms.length).toBe(map.props.filter((p) => p.kind === "palm").length);
    expect(L.bananas.length).toBe(map.props.filter((p) => p.kind === "banana").length);
  });

  it("keeps a visible marker over every interactable", () => {
    expect(L.markers.map((m) => m.id).sort()).toEqual(map.interactables.map((i) => i.id).sort());
    for (const m of L.markers) {
      const it = map.interactables.find((i) => i.id === m.id)!;
      expect(m.z).toBeGreaterThan(48);                                       // above a character's head
      expect(m.x).toBeGreaterThanOrEqual(it.rect.x);
      expect(m.x).toBeLessThanOrEqual(it.rect.x + it.rect.w);
    }
  });

  it("puts nothing that blocks a walker on a walkable cell", () => {
    const bad: string[] = [];
    for (const b of L.boxes) {
      if (b.z0 >= HEADROOM || b.z0 + b.h <= FLAT) continue;                // overhead, or flat enough to walk over
      // a detail on a facade (a window, a shutter, ≤ 2 px thick) only needs its back edge on the wall
      const cells = b.d <= 2 ? [[b.x + b.w / 2, b.y + 0.01]] : b.w <= 2 ? [[b.x + 0.01, b.y + b.d / 2]] : cellsUnder(map, b.x, b.y, b.w, b.d);
      for (const [x, y] of cells) if (!blockedAt(map, x, y)) bad.push(`box ${JSON.stringify(b)} @${x},${y}`);
    }
    for (const gb of L.gables) {
      if (gb.z0 >= HEADROOM) continue;
      for (const [x, y] of cellsUnder(map, gb.x, gb.y, gb.w, gb.d)) if (!blockedAt(map, x, y)) bad.push(`gable @${x},${y}`);
    }
    for (const p of [...L.palms, ...L.bananas, ...L.trees, ...L.bamboo]) if (!blockedAt(map, p.x, p.y)) bad.push(`plant @${p.x},${p.y}`);
    for (const f of L.fences) for (const [x, y] of [[f.x1, f.y1], [f.x2, f.y2], [(f.x1 + f.x2) / 2, (f.y1 + f.y2) / 2]]) {
      if (!blockedAt(map, x, y)) bad.push(`fence @${x},${y}`);
    }
    expect(bad).toEqual([]);
  });

  it("the spawn and every use spot stay walkable and clear", () => {
    const clear = (x: number, y: number) => !L.boxes.some((b) => b.z0 < HEADROOM && b.z0 + b.h > FLAT && x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.d);
    expect(clear(map.spawn.x, map.spawn.y)).toBe(true);
    for (const it of map.interactables) expect(clear(it.use.x, it.use.y), it.id).toBe(true);
  });

  it("lights the night within the light budget", () => {
    expect(L.lights.length).toBeGreaterThan(0);
    expect(L.lights.length).toBeLessThanOrEqual(MAX_LIGHTS);
    expect(L.bulbs.length).toBeGreaterThanOrEqual(3);
    expect(L.boxes.some((b) => b.glow)).toBe(true);
  });

  it("has fading roofs whose boxes belong to a declared group", () => {
    const ids = new Set(L.roofs.map((r) => r.id));
    expect(ids.size).toBeGreaterThan(0);
    for (const b of L.boxes) if (b.roof) expect(ids.has(b.roof)).toBe(true);
    for (const g of L.gables) if (g.roof) expect(ids.has(g.roof)).toBe(true);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(layout(map))).toBe(JSON.stringify(L));
  });
});

describe("zone specifics", () => {
  it("hall: the bamboo grove, the river, the decks people stand on", () => {
    const L = hallLayout(getMap("hall"));
    expect(L.bamboo.length).toBeGreaterThan(60);
    expect(L.water.length).toBe(1);
    expect(zoneHeightAt(L, 516, 360)).toBeGreaterThan(0);          // the dock
    expect(zoneHeightAt(L, 320, 124)).toBe(12);                    // the DJ on the stage
    expect(zoneHeightAt(L, 400, 250)).toBe(0);                     // the yard
    expect(L.ground[Math.floor(390 / 8) * L.cols + 10]).toBe("water");
  });

  it("market: a stall per STALLS entry, a lantern on every post", () => {
    const L = marketLayout(getMap("market"));
    expect(L.roofs.filter((r) => r.id.startsWith("stall")).length).toBe(STALLS.length);
    for (const p of LANTERN_POSTS) expect(L.bulbs.some((b) => Math.abs(b.x - p.x) < 8 && Math.abs(b.y - p.y) < 6 && b.z > 30)).toBe(true);
  });

  it("khu_nha: a fence round every lot, soil inside", () => {
    const L = khuNhaLayout(getMap("khu_nha"));
    expect(L.fences.length).toBe(LOTS.length * 4);
    for (const r of LOTS) {
      const c = Math.floor((r.x + r.w / 2) / L.tile), row = Math.floor((r.y + r.h / 2) / L.tile);
      expect(L.ground[row * L.cols + c]).toBe("soil");
    }
  });

  it("zones build Three.js groups (no WebGL needed)", async () => {
    const { buildHall } = await import("@/lib/game/diorama/zones/hall");
    const { buildMarket } = await import("@/lib/game/diorama/zones/market");
    const { buildKhuNha } = await import("@/lib/game/diorama/zones/khu_nha");
    for (const [id, build] of [["hall", buildHall], ["market", buildMarket], ["khu_nha", buildKhuNha]] as const) {
      const g = build(getMap(id));
      expect(g.children.length).toBeGreaterThan(5);
      const corner = build(getMap(id), { origin: "corner" });
      expect(corner.position.x).toBeCloseTo(getMap(id).width / 32);
    }
  });
});
