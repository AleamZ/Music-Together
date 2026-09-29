import { describe, expect, it, vi } from "vitest";
import { buildWorld, type WorldMap } from "@/lib/game/world/compose";
import { cumulative, pointAt, ROADS, TRAILS } from "@/lib/game/world/roads";
import {
  bridgeAt, DOMAIN, heightAt, heightGrid, MAX_ROAD_SLOPE, MAX_WALK_SLOPE, onPath, RIVER_LEVEL, RIVER_PTS, riverAt, slopeAtCell,
  standHeight, STREAM_PTS, waterAt, ZONE_ELEV, CANALS, EAST_HILLS,
} from "@/lib/game/world/terrain";
import { wildBlocked } from "@/lib/game/world/wild";
import { LANDMARKS, scatterRocks, scatterTrees } from "@/lib/game/world/scenery";
import { WORLD_CELL, WORLD_H, WORLD_W, ZONE_IDS, ZONES, zoneAt } from "@/lib/game/world/zones";
import { getMap } from "@/lib/game/maps/registry";
import type { Vec } from "@/lib/game/types";

const U = 16;

function reach(w: WorldMap, from: Vec, links = true): Uint8Array {
  const seen = new Uint8Array(w.cols * w.rows);
  const at = (p: Vec) => Math.floor(p.y / w.cell) * w.cols + Math.floor(p.x / w.cell);
  const lk = new Map<number, number>();
  if (links) for (const l of w.links) { lk.set(at(l.from), at(l.to)); lk.set(at(l.to), at(l.from)); }
  const q = [at(from)];
  seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop()!, c = i % w.cols, r = (i - c) / w.cols;
    const next = [c > 0 ? i - 1 : -1, c < w.cols - 1 ? i + 1 : -1, r > 0 ? i - w.cols : -1, r < w.rows - 1 ? i + w.cols : -1];
    const l = lk.get(i);
    if (l !== undefined) next.push(l);
    for (const j of next) if (j >= 0 && !seen[j] && !w.blocked[j]) { seen[j] = 1; q.push(j); }
  }
  return seen;
}

describe("world terrain", () => {
  it("is deterministic and finite over the whole domain", () => {
    const pts: number[] = [];
    for (let y = DOMAIN.y0; y <= DOMAIN.y1; y += 97) for (let x = DOMAIN.x0; x <= DOMAIN.x1; x += 113) pts.push(heightAt(x, y));
    expect(pts.every(Number.isFinite)).toBe(true);
    const again: number[] = [];
    for (let y = DOMAIN.y0; y <= DOMAIN.y1; y += 97) for (let x = DOMAIN.x0; x <= DOMAIN.x1; x += 113) again.push(heightAt(x, y));
    expect(again).toEqual(pts);
  });

  it("puts every zone on a flat plateau at its elevation", () => {
    for (const id of ZONE_IDS) {
      const z = ZONES[id];
      for (let y = z.oy + 4; y < z.oy + z.h; y += 8) for (let x = z.ox + 4; x < z.ox + z.w; x += 8) {
        if (heightAt(x, y) !== ZONE_ELEV[id]) throw new Error(`${id} (${x}, ${y}) = ${heightAt(x, y)}`);
      }
    }
  });

  it("blends the plateaus: no step at a zone's edge", () => {
    for (const id of ZONE_IDS) {
      const z = ZONES[id];
      for (const [x, y] of [[z.ox - 1, z.oy + z.h / 2], [z.ox + z.w + 1, z.oy + z.h / 2], [z.ox + z.w / 2, z.oy - 1], [z.ox + z.w / 2, z.oy + z.h + 1]]) {
        if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H || zoneAt({ x, y }) !== "wild" || waterAt(x, y) !== null) continue;
        expect(Math.abs(heightAt(x, y) - ZONE_ELEV[id]), `${id} (${x}, ${y})`).toBeLessThan(0.35);
      }
    }
  });

  it("keeps every road and trail within the steepest ramp", () => {
    for (const r of [...ROADS, ...TRAILS]) {
      const cum = cumulative(r.pts), L = cum[cum.length - 1];
      let prev = standHeight(r.pts[0].x, r.pts[0].y), worst = 0;
      for (let s = 4; s <= L; s += 4) {
        const p = pointAt(r.pts, cum, s);
        if (zoneAt(p) !== "wild") { prev = standHeight(p.x, p.y); continue; }
        const h = standHeight(p.x, p.y);
        worst = Math.max(worst, Math.abs(h - prev) / (4 / U));
        prev = h;
      }
      expect(worst, r.id).toBeLessThanOrEqual(MAX_ROAD_SLOPE + 1e-6);
    }
  });

  it("runs the river unbroken from the west of the world to Sông Cái and on east, off the world", () => {
    const cum = cumulative(RIVER_PTS), L = cum[cum.length - 1];
    const sc = ZONES.song_cai;
    for (let s = 0; s <= L; s += 8) {
      const p = pointAt(RIVER_PTS, cum, s);
      if (p.x >= sc.ox && p.x < sc.ox + sc.w) {
        expect(p.y, "through the zone on its water's mid-line").toBe(sc.oy + 240);
        continue;
      }
      expect(waterAt(p.x, p.y), `(${p.x | 0}, ${p.y | 0})`).toBe(RIVER_LEVEL);
      expect(heightAt(p.x, p.y)).toBeLessThan(RIVER_LEVEL);
    }
    expect(RIVER_PTS[0].x).toBeLessThan(0);
    expect(RIVER_PTS[RIVER_PTS.length - 1].x).toBeGreaterThan(WORLD_W);
    // it meets the zone's water (local y 80…400) at both edges
    for (const x of [sc.ox - 2, sc.ox + sc.w + 2]) {
      const r = riverAt(x, sc.oy + 240);
      expect(r.d).toBeLessThan(4);
      expect(r.hw).toBeGreaterThan(140);
    }
  });

  it("runs the stream from the pond's edge down into the river", () => {
    const cum = cumulative(STREAM_PTS), L = cum[cum.length - 1];
    let prev = Infinity;
    for (let s = 0; s <= L; s += 6) {
      const p = pointAt(STREAM_PTS, cum, s);
      if (zoneAt(p) !== "wild") continue;
      const w = waterAt(p.x, p.y);
      expect(w, `(${p.x | 0}, ${p.y | 0})`).not.toBeNull();
      expect(w!).toBeLessThanOrEqual(prev + 1e-9);
      prev = w!;
    }
    expect(STREAM_PTS[0].y).toBe(ZONES.pond.oy + ZONES.pond.h);
    const end = STREAM_PTS[STREAM_PTS.length - 1];
    expect(riverAt(end.x, end.y).d).toBeLessThan(riverAt(end.x, end.y).hw);
  });

  it("is a flat delta ringed by the river mouths' water, with one low hill group in the east", () => {
    let wet = 0, n = 0;
    for (let x = DOMAIN.x0; x <= DOMAIN.x1; x += 160) for (const y of [DOMAIN.y0 + 200, DOMAIN.y1 - 200]) {
      n++;
      if (waterAt(x, y) === RIVER_LEVEL && heightAt(x, y) < RIVER_LEVEL) wet++;
    }
    expect(wet / n).toBeGreaterThan(0.9);
    // no mountains: the open land stays within a few units of the river; only the eastern hills rise, and gently
    let top = 0;
    for (let y = 40; y < WORLD_H; y += 80) for (let x = 40; x < WORLD_W; x += 80) {
      if (zoneAt({ x, y }) !== "wild") continue;
      const h = heightAt(x, y);
      if (Math.hypot(x - EAST_HILLS[0].x, y - EAST_HILLS[0].y) > 450) expect(h, `${x},${y}`).toBeLessThan(3.5);
      top = Math.max(top, h);
    }
    expect(top).toBeLessThan(9);
  });

  it("cuts canals joined to the river, at its level", () => {
    for (const c of CANALS) {
      const cum = cumulative(c), L = cum[cum.length - 1];
      let wet = 0, n = 0;
      for (let s = 0; s <= L; s += 16) {
        const p = pointAt(c, cum, s);
        if (zoneAt(p) !== "wild" || onPath(p.x, p.y)) continue;
        n++;
        if (waterAt(p.x, p.y) === RIVER_LEVEL) wet++;
      }
      expect(wet / Math.max(1, n)).toBeGreaterThan(0.95);
    }
  });
});

describe("the wild's collision from the terrain", () => {
  const world = buildWorld();
  const g = heightGrid();

  it("blocks water, cliffs and the hill in the wild; roads, trails and bridges stay open", () => {
    const bad: string[] = [];
    for (let r = 1; r < world.rows - 1; r++) for (let c = 1; c < world.cols - 1; c++) {
      const x = c * WORLD_CELL + 4, y = r * WORLD_CELL + 4;
      if (zoneAt({ x, y }) !== "wild") continue;
      const b = world.blocked[r * world.cols + c] === 1;
      if (onPath(x, y)) { if (b) bad.push(`path ${x},${y}`); continue; }
      if (waterAt(x, y) !== null && bridgeAt(x, y) === null && !b) bad.push(`water ${x},${y}`);
      if (slopeAtCell(g, c, r) > MAX_WALK_SLOPE && !b) bad.push(`cliff ${x},${y}`);
      if (b !== wildBlocked(x, y)) bad.push(`mismatch ${x},${y}`);
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it("the bridges lead to the south bank; Sông Cái is only reached by boat", () => {
    const walk = reach(world, world.spawn, false);
    for (const t of TRAILS) {
      const end = t.pts[t.pts.length - 1];
      expect(walk[Math.floor(end.y / 8) * world.cols + Math.floor(end.x / 8)], t.id).toBe(1);
      const mid = t.pts.find((p, i) => i > 0 && waterAt(p.x, (p.y + t.pts[i - 1].y) / 2) !== null);
      expect(mid ?? t.pts[t.pts.length - 1]).toBeDefined();
    }
    const jetty = getMap("song_cai").spawn;
    const j = { x: jetty.x + ZONES.song_cai.ox, y: jetty.y + ZONES.song_cai.oy };
    expect(walk[Math.floor(j.y / 8) * world.cols + Math.floor(j.x / 8)]).toBe(0);
    const boat = reach(world, world.spawn, true);
    expect(boat[Math.floor(j.y / 8) * world.cols + Math.floor(j.x / 8)]).toBe(1);
  });
});

describe("the world's scenery", () => {
  // CPU-bound (~2 s alone: every tree and rock of the world checked against the zones, paths and water), so under the
  // full suite's parallel load it outran vitest's 5 s default; the scatter is a pure function of hashAt / fbm (no
  // Math.random, no clock anywhere in lib/game/world), proven below against a fresh, uncached module instance.
  it("keeps every tree and rock off the zones, the paths and the water; deterministic", async () => {
    const trees = scatterTrees();
    const rocks = scatterRocks();
    expect(trees.length).toBeGreaterThan(3000);
    const bad = [...trees, ...rocks].filter((t) => zoneAt({ x: t.x, y: t.y }) !== "wild" && t.x >= 0 && t.y >= 0 && t.x < WORLD_W && t.y < WORLD_H
      || onPath(t.x, t.y) || waterAt(t.x, t.y) !== null);
    expect(bad.slice(0, 5)).toEqual([]);
    expect(new Set(trees.map((t) => t.kind))).toEqual(new Set(["round", "conifer", "yellow"]));
    // determinism: a second module instance (its own empty caches) scatters exactly the same world
    vi.resetModules();
    const fresh = await import("@/lib/game/world/scenery");
    expect(fresh.scatterTrees()).not.toBe(trees);
    expect(fresh.scatterTrees()).toEqual(trees);
    expect(fresh.scatterRocks()).toEqual(rocks);
  }, 30_000);

  it("puts the landmarks in the wild, off the water", () => {
    for (const l of LANDMARKS) {
      expect(zoneAt(l), `${l.kind} ${l.x},${l.y}`).toBe("wild");
      expect(waterAt(l.x, l.y), l.kind).toBeNull();
    }
    expect(LANDMARKS.map((l) => l.kind)).toEqual(expect.arrayContaining(["flag", "arch", "tower", "headframe", "pagoda"]));
  });
});