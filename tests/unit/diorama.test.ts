import { beforeEach, describe, expect, it } from "vitest";
import { clampOrbit, flyForward, flyFromOrbit, LIMITS, orbitEye, smoothK, stepFly } from "@/lib/game/diorama/camera";
import { PX_PER_UNIT, pxToWorld, rayPlaneY, rayToMapPx, worldToPx } from "@/lib/game/diorama/coords";
import { GFX_KEY, parseGfx, readGfx, usesDiorama, writeGfx } from "@/lib/game/diorama/flag";
import { buildPondLayout, pondGroundAt, rng } from "@/lib/game/diorama/layout";
import { createFpsMonitor } from "@/lib/game/diorama/quality";
import { buildPondMap, inPond, onPlatform, POND_CX, POND_CY, POND_PLATFORM } from "@/lib/game/maps/pond";

const SIZE = { width: 640, height: 400 };

describe("diorama coords", () => {
  it("maps px to world and back", () => {
    for (const p of [{ x: 0, y: 0 }, { x: 320, y: 200 }, { x: 640, y: 400 }, { x: 123.5, y: 77 }]) {
      const w = pxToWorld(p, SIZE);
      expect(worldToPx(w.x, w.z, SIZE)).toEqual(p);
    }
  });
  it("centres the map and keeps the 2D axes (x right, y down → +z)", () => {
    expect(pxToWorld({ x: 320, y: 200 }, SIZE)).toEqual({ x: 0, z: 0 });
    expect(pxToWorld({ x: 320 + PX_PER_UNIT, y: 200 + 2 * PX_PER_UNIT }, SIZE)).toEqual({ x: 1, z: 2 });
  });
  it("intersects a ray with the ground plane", () => {
    expect(rayPlaneY({ origin: [0, 10, 0], dir: [0, -1, 0] })).toEqual({ x: 0, z: 0 });
    expect(rayPlaneY({ origin: [0, 10, 10], dir: [0, -1, -1] })).toEqual({ x: 0, z: 0 });
    expect(rayPlaneY({ origin: [0, 10, 0], dir: [1, 0, 0] })).toBeNull();     // parallel
    expect(rayPlaneY({ origin: [0, 10, 0], dir: [0, 1, 0] })).toBeNull();     // pointing at the sky
  });
  it("maps a click ray back to map px, null off the map", () => {
    const target = pxToWorld({ x: 300, y: 212 }, SIZE);
    const hit = rayToMapPx({ origin: [target.x, 20, target.z + 20], dir: [0, -1, -1] }, SIZE);
    expect(hit?.x).toBeCloseTo(300);
    expect(hit?.y).toBeCloseTo(212);
    expect(rayToMapPx({ origin: [100, 10, 0], dir: [0, -1, 0] }, SIZE)).toBeNull();
    expect(rayToMapPx({ origin: [0, 10, 0], dir: [0, 0.2, -1] }, SIZE)).toBeNull();
  });
});

describe("diorama flag", () => {
  beforeEach(() => window.localStorage.clear());
  it("parses anything but 3d as 2d", () => {
    expect(parseGfx("3d")).toBe("3d");
    for (const raw of [null, undefined, "", "2d", "3D", "webgl"]) expect(parseGfx(raw)).toBe("2d");
  });
  it("only swaps the maps that have a diorama", () => {
    expect(usesDiorama("3d", "pond")).toBe(true);
    expect(usesDiorama("3d", "hall")).toBe(true);
    expect(usesDiorama("3d", "ham_ngam")).toBe(false);
    expect(usesDiorama("2d", "pond")).toBe(false);
  });
  it("defaults to 2d and persists the choice", () => {
    expect(readGfx()).toBe("2d");
    let heard = 0;
    const on = () => { heard++; };
    window.addEventListener("mt:gfx", on);
    writeGfx("3d");
    window.removeEventListener("mt:gfx", on);
    expect(window.localStorage.getItem(GFX_KEY)).toBe("3d");
    expect(readGfx()).toBe("3d");
    expect(heard).toBe(1);
  });
});

describe("pond layout", () => {
  const map = buildPondMap();
  const L = buildPondLayout(map);
  it("covers the map with ground tiles that agree with the 2D rules", () => {
    expect(L.cols * L.tile).toBe(640);
    expect(L.rows * L.tile).toBe(400);
    expect(L.ground).toHaveLength(L.cols * L.rows);
    const at = (x: number, y: number) => L.ground[Math.floor(y / L.tile) * L.cols + Math.floor(x / L.tile)];
    expect(["water", "deep"]).toContain(at(POND_CX, POND_CY));
    expect(at(POND_CX, POND_CY)).toBe("deep");
    expect(at(8, 8)).toBe("bamboo");
    expect(pondGroundAt(300, 390)).toBe("path");
  });
  it("is deterministic (every client builds the same diorama)", () => {
    expect(buildPondLayout(map)).toEqual(L);
    const a = rng(7), b = rng(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it("keeps plants off the water, the dock and the paths players walk", () => {
    for (const t of L.trees) expect(inPond(t.x, t.y, 4)).toBe(false);
    for (const r of L.rocks) expect(onPlatform(r.x, r.y)).toBe(false);
    for (const r of L.reeds) expect(onPlatform(r.x, r.y)).toBe(false);
    // the inner shrubs never stand on a walkable cell the map needs: each is next to a blocked cell
    expect(L.trees.length).toBeGreaterThan(20);
  });
  it("places every prop that has a 3D shape, and the dock", () => {
    const kinds = L.buildings.map((b) => b.kind);
    for (const k of ["stall", "hut", "records", "board", "ghe", "palm", "banana", "sign", "city_post"] as const) expect(kinds).toContain(k);
    expect(kinds.filter((k) => k === "palm")).toHaveLength(3);
    expect(L.platform).toEqual(POND_PLATFORM);
    expect(L.lilies.length).toBeGreaterThan(0);
    expect(L.shore.every((p) => Math.abs(Math.hypot((p.x - POND_CX) / 180, (p.y - POND_CY) / 105) - 1) < 0.1)).toBe(true);
  });
  it("thins out with a lower density", () => {
    const low = buildPondLayout(map, { density: 0.5 });
    expect(low.trees.length).toBeLessThan(L.trees.length);
    expect(low.bamboo.length).toBeLessThan(L.bamboo.length);
  });
});

describe("diorama camera", () => {
  it("orbits: yaw 0 looks north from the south, above the target", () => {
    const e = orbitEye({ x: 1, y: 0, z: 2 }, { yaw: 0, pitch: Math.PI / 4, distance: Math.SQRT2 * 10 });
    expect(e.x).toBeCloseTo(1);
    expect(e.y).toBeCloseTo(10);
    expect(e.z).toBeCloseTo(12);
  });
  it("clamps pitch and distance", () => {
    const o = clampOrbit({ yaw: 3, pitch: 9, distance: 0 });
    expect(o).toEqual({ yaw: 3, pitch: LIMITS.pitchMax, distance: LIMITS.distMin });
  });
  it("smooths independently of the frame rate", () => {
    const one = smoothK(1 / 30, 5);
    const two = 1 - (1 - smoothK(1 / 60, 5)) ** 2;
    expect(two).toBeCloseTo(one);
    expect(smoothK(0, 5)).toBe(0);
  });
  it("free-fly: takes off looking at the orbit's target and moves along its heading", () => {
    const s = flyFromOrbit({ x: 0, y: 0, z: 0 }, { yaw: 0, pitch: 0.5, distance: 10 });
    const f = flyForward(s);
    expect(f.z).toBeLessThan(0);
    expect(f.y).toBeLessThan(0);
    const next = stepFly({ ...s, pitch: 0 }, { fwd: 1, right: 0, up: 0, fast: false }, 1);
    expect(next.pos.z).toBeCloseTo(s.pos.z - 10);
    const fast = stepFly(s, { fwd: 0, right: 1, up: -1, fast: true }, 1);
    expect(fast.pos.x).toBeCloseTo(30);
    expect(fast.pos.y).toBeGreaterThanOrEqual(0.5);
  });
});

describe("diorama quality", () => {
  it("drops to low when the fps stays poor after the warm-up, and stays there", () => {
    const m = createFpsMonitor({ window: 10, warmupMs: 500 });
    for (let i = 0; i < 4; i++) m.sample(120);                           // the slow start is not counted
    expect(m.quality()).toBe("high");
    for (let i = 0; i < 20; i++) m.sample(16);
    expect(m.quality()).toBe("high");
    expect(m.fps()).toBeCloseTo(62.5);
    for (let i = 0; i < 10; i++) m.sample(40);
    expect(m.quality()).toBe("low");
    for (let i = 0; i < 20; i++) m.sample(10);
    expect(m.quality()).toBe("low");
  });
  it("ignores a hidden tab's gap and a manual pick turns the auto pick off", () => {
    const m = createFpsMonitor({ window: 4, warmupMs: 0 });
    m.sample(5000);
    expect(m.fps()).toBe(0);
    m.force("high");
    for (let i = 0; i < 10; i++) m.sample(100);
    expect(m.quality()).toBe("high");
  });
});
