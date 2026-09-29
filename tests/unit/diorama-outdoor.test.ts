import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { DIORAMA_MAPS, usesDiorama } from "@/lib/game/diorama/flag";
import { baiGroundAt, baiHeightAt, baiLayout, RING_FLOOR } from "@/lib/game/diorama/zones/bai_dat";
import { demoFieldPlots, fieldGroundAt, fieldHeightAt, fieldLayout, mixHex, plotModel } from "@/lib/game/diorama/zones/field";
import { moGroundAt, moLayout, nodeLook, VEIN_COLORS } from "@/lib/game/diorama/zones/mo_da";
import { builtFromGroup, OUTDOOR_BUILDERS } from "@/lib/game/diorama/zones/outdoor";
import { rigOf } from "@/lib/game/diorama/zones/outdoor-kit";
import { driftX, riverDepth, riverGroundAt, riverHeightAt, riverLayout } from "@/lib/game/diorama/zones/song_cai";
import type { PlotLook } from "@/lib/game/art/crops";
import { BRIDGE, RING_RECTS } from "@/lib/game/maps/bai-dat";
import { BRIDGES, CANAL, DRYING_SQUARES, FIELD_PLOTS } from "@/lib/game/maps/field";
import { MO_WALL_H } from "@/lib/game/maps/mo-da";
import { getMap } from "@/lib/game/maps/registry";
import type { MapId } from "@/lib/game/maps/types";
import { RAID_ARENA } from "@/lib/game/realm/model";
import { RIVER } from "@/lib/game/river/geometry";

const OUTDOOR: MapId[] = ["field", "bai_dat", "mo_da", "song_cai"];
const rice = (stage: PlotLook["stage"], extra: Partial<PlotLook> = {}): PlotLook => ({
  crop: "rice", stage, progress: 0.5, water: 2, pests: [], wobble: false, cut: 0, picked: 0, pickings: 1, seed: 7919, ...extra,
});

describe("outdoor dioramas: registration", () => {
  it("has a builder for each of the four maps and the 3D flag covers them (2D stays the default)", () => {
    for (const id of OUTDOOR) {
      expect(OUTDOOR_BUILDERS[id]).toBeTypeOf("function");
      expect(DIORAMA_MAPS.has(id)).toBe(true);
      expect(usesDiorama("3d", id)).toBe(true);
      expect(usesDiorama("2d", id)).toBe(false);
    }
  });
});

describe("field (Đồng lúa)", () => {
  it("paints the ground in the 2D painter's order", () => {
    expect(fieldGroundAt(300, 10)).toBe("bamboo");
    expect(fieldGroundAt(300, CANAL.y + 10)).toBe("canal");
    expect(fieldGroundAt(BRIDGES[0].x + 10, CANAL.y + 10)).toBe("bridge");
    expect(fieldGroundAt(FIELD_PLOTS[0].rect.x + 20, FIELD_PLOTS[0].rect.y + 20)).toBe("plot");
    expect(fieldGroundAt(DRYING_SQUARES[0].x + 5, DRYING_SQUARES[0].y + 5)).toBe("yard");
    expect(fieldGroundAt(20, 300)).toBe("road");
    expect(fieldHeightAt(BRIDGES[0].x + 10, CANAL.y + 10)).toBeGreaterThan(0);
    expect(fieldHeightAt(FIELD_PLOTS[0].rect.x + 20, FIELD_PLOTS[0].rect.y + 20)).toBeLessThan(0);
  });

  it("an unplanted plot is stubble on the 8 px hill grid", () => {
    const r = FIELD_PLOTS[0].rect, m = plotModel(r, null);
    expect(m.pieces.length).toBe(Math.ceil((r.h - 8) / 8) * Math.ceil((r.w - 7) / 8));
    expect(m.pieces.every((p) => p.kind === "stubble")).toBe(true);
  });

  it("the rice grows taller stage by stage and turns gold", () => {
    const r = FIELD_PLOTS[0].rect;
    const height = (s: PlotLook["stage"]) => Math.max(...plotModel(r, rice(s)).pieces.filter((p) => p.kind === "hill").map((p) => p.h));
    expect(plotModel(r, rice("prepared")).pieces).toEqual([]);
    expect(height("transplanted")).toBeLessThan(height("tillering"));
    expect(height("tillering")).toBeLessThan(height("heading"));
    const ripe = plotModel(r, rice("ripe"));
    expect(ripe.pieces.some((p) => p.kind === "head")).toBe(true);
    expect(ripe.pieces.filter((p) => p.kind === "hill").every((p) => p.color === 0xe0b33c)).toBe(true);
    // the seedbed is a nursery strip along the west side
    const seed = plotModel(r, rice("seedbed"));
    expect(seed.pieces.length).toBeGreaterThan(50);
    expect(seed.pieces.every((p) => p.kind === "seedling" && p.x < r.x + 40)).toBe(true);
  });

  it("cuts from the left (stubble and sheaves) and follows the water level", () => {
    const r = FIELD_PLOTS[0].rect, m = plotModel(r, rice("ripe", { cut: 0.5 }));
    const mid = r.x + r.w / 2;
    expect(m.pieces.filter((p) => p.kind === "stubble").every((p) => p.x < mid + 3)).toBe(true);
    expect(m.pieces.filter((p) => p.kind === "hill").every((p) => p.x >= mid - 3)).toBe(true);
    expect(m.pieces.some((p) => p.kind === "sheaf")).toBe(true);
    expect(plotModel(r, rice("tillering", { water: 0 })).soil).not.toBe(plotModel(r, rice("tillering", { water: 3 })).soil);
    expect(plotModel(r, rice("tillering", { water: 3 })).water).toBe(3);
  });

  it("grows hoa màu on raised beds (bắp tall with tassels, ớt with fruit)", () => {
    const r = FIELD_PLOTS[4].rect;
    const bap = plotModel(r, { ...rice("ripe"), crop: "bap", pickings: 2 });
    expect(bap.beds.length).toBe(4);
    expect(bap.pieces.some((p) => p.kind === "stalk" && p.h > 20)).toBe(true);
    expect(bap.pieces.some((p) => p.kind === "tassel")).toBe(true);
    const ot = plotModel(r, { ...rice("ripe"), crop: "ot", pickings: 3 });
    expect(ot.pieces.filter((p) => p.kind === "fruit").length).toBeGreaterThan(20);
    expect(plotModel(r, { ...rice("beds"), crop: "" }).pieces).toEqual([]);
  });

  it("is deterministic (wobble included) and thins with density", () => {
    const r = FIELD_PLOTS[1].rect;
    expect(plotModel(r, rice("tillering", { wobble: true }))).toEqual(plotModel(r, rice("tillering", { wobble: true })));
    const map = getMap("field");
    expect(fieldLayout(map)).toEqual(fieldLayout(map));
    expect(fieldLayout(map, { density: 0.5 }).bamboo.length).toBeLessThan(fieldLayout(map).bamboo.length);
    expect(mixHex(0x000000, 0xffffff, 0.5)).toBe(0x808080);
  });
});

describe("Bãi đất", () => {
  it("has the canal, the bridge, the rings raised and the fence", () => {
    expect(baiGroundAt(100, 10)).toBe("canal");
    expect(baiGroundAt(BRIDGE.x + 10, 10)).toBe("bridge");
    expect(baiGroundAt(100, 390)).toBe("fence");
    const r = RING_RECTS[2];
    expect(baiHeightAt(r.x + 50, r.y + 50)).toBeGreaterThan(RING_FLOOR);
    expect(baiHeightAt(40, 240)).toBe(0);
  });
  it("stakes the boss arena's border, off the track in, and lights each ring", () => {
    const L = baiLayout(getMap("bai_dat"));
    expect(L.stakes.length).toBeGreaterThan(8);
    const A = RAID_ARENA;
    for (const s of L.stakes) {
      const onEdge = Math.abs(s.x - A.x) < 1 || Math.abs(s.x - A.x - A.w) < 1 || Math.abs(s.y - A.y) < 1 || Math.abs(s.y - A.y - A.h) < 1;
      expect(onEdge).toBe(true);
      expect(s.x > 384 && s.x < 416).toBe(false);
    }
    expect(L.lights.length).toBe(RING_RECTS.length + 2);
    for (const w of L.weeds) for (const r of RING_RECTS) expect(w.x >= r.x && w.x < r.x + r.w && w.y >= r.y && w.y < r.y + r.h).toBe(false);
  });
});

describe("Mỏ đá", () => {
  it("has the rock face, the gate and the rails", () => {
    expect(moGroundAt(300, MO_WALL_H - 1)).toBe("face");
    expect(moGroundAt(4, 200)).toBe("gate");
    expect(moGroundAt(4, 100)).toBe("wall");
    expect(moGroundAt(200, 200)).toBe("rail");
    expect(moGroundAt(300, 300)).toBe("floor");
  });
  it("shows a node's vein in its item's colour when ready, rubble while it grows back", () => {
    const view = { nodes: new Map([[1, { item: "ore_vang", readyAtMs: 1000 }], [2, { item: "ore_sat", readyAtMs: 5000 }]]) };
    expect(nodeLook(1, 2000, view)).toEqual({ state: "vein", color: VEIN_COLORS.ore_vang });
    expect(nodeLook(2, 2000, view).state).toBe("rubble");
    expect(nodeLook(3, 2000, view).state).toBe("plain");
  });
  it("puts the hills behind the north edge and a lamp on every other timber prop", () => {
    const L = moLayout(getMap("mo_da"));
    expect(L.hills.every((h) => h.y < 0)).toBe(true);
    expect(L.lights.length).toBe(6);
  });
});

describe("Sông Cái", () => {
  it("has the water, rocks, the island, the jetty and the banks", () => {
    expect(riverGroundAt(400, 250)).toBe("water");
    expect(riverGroundAt(300, 150)).toBe("rock");
    expect(riverGroundAt(620, 230)).toBe("island");
    expect(riverGroundAt(20, 240)).toBe("jetty");
    expect(riverGroundAt(400, 20)).toBe("grass");
    expect(riverGroundAt(400, RIVER.y0 - 2)).toBe("mud");
    expect(riverHeightAt(20, 240)).toBeGreaterThan(riverHeightAt(400, 250));
  });
  it("is deepest mid-stream and shallow over the shoals", () => {
    const mid = (RIVER.y0 + RIVER.y1) / 2;
    expect(riverDepth(420, mid)).toBeGreaterThan(riverDepth(420, RIVER.y0 + 4));
    const [sx, sy] = RIVER.shoals[0];
    expect(riverDepth(sx, sy)).toBeLessThan(riverDepth(420, mid));
  });
  it("drifts downstream (east) and wraps inside the band", () => {
    for (let t = 0; t < 60_000; t += 700) {
      const x = driftX(131, 20, t);
      expect(x).toBeGreaterThanOrEqual(RIVER.x0 - 20);
      expect(x).toBeLessThan(RIVER.x1 + 20);
    }
    expect(driftX(0, 20, 1000) - driftX(0, 20, 0)).toBeCloseTo(20);
    const L = riverLayout(getMap("song_cai"));
    expect(L.reeds.every((r) => r.y < RIVER.y0 || r.y > RIVER.y1)).toBe(true);
    expect(L.hyacinths.length).toBe(9);
  });
});

describe("outdoor builders (Three.js, no WebGL)", () => {
  it.each(OUTDOOR)("builds %s as a group with its hooks, few draw objects, and disposes", (id) => {
    const map = getMap(id);
    const g = OUTDOOR_BUILDERS[id]!(map);
    expect(g).toBeInstanceOf(THREE.Group);
    const rig = rigOf(g);
    expect(rig.lamps.length).toBeGreaterThan(0);
    expect(rig.lamps.length).toBeLessThanOrEqual(8);
    let meshes = 0;
    g.traverse((o) => { if (o instanceof THREE.Mesh) meshes++; });
    expect(meshes).toBeLessThan(200);                        // statics merged per material
    expect(() => rig.animate(1234, 20)).not.toThrow();
    expect(Number.isFinite(rig.heightAt(map.spawn.x, map.spawn.y))).toBe(true);
    const built = builtFromGroup(g);
    expect(built.root).toBe(g);
    built.dispose();
    expect(g.children.length).toBe(0);
  });

  it("refills the field's crops from the farm state", () => {
    const g = OUTDOOR_BUILDERS.field!(getMap("field"));
    const rig = rigOf(g);
    const count = () => { let n = 0; g.traverse((o) => { if (o instanceof THREE.InstancedMesh && o.userData.keep) n += o.count; }); return n; };
    const bare = count();
    rig.setPlots!(demoFieldPlots(), Date.now());
    expect(count()).toBeGreaterThan(bare);
    rig.dispose();
  });
});
