import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pxToWorldAbs, worldAbsToPx, PX_PER_UNIT } from "@/lib/game/diorama/coords";
import { dockDeck, routeGround } from "@/lib/game/diorama/world/song-cai-route";
import { BEN_DO_DOCK, buildSongCaiMap } from "@/lib/game/maps/song-cai";
import { riverWater } from "@/lib/game/river/geometry";
import type { Vec } from "@/lib/game/types";
import { buildWorld, type WorldMap } from "@/lib/game/world/compose";
import { WORLD_GATES } from "@/lib/game/world/gates";
import { cumulative, nearestOn, pointAt, ROADS } from "@/lib/game/world/roads";
import { LANDING_NEAR, SONG_CAI_DOCK_LOCAL, SONG_CAI_LEVEL, SONG_CAI_ROUTE as R } from "@/lib/game/world/routes";
import { RIVER_LEVEL, onPath } from "@/lib/game/world/terrain";
import { WILD_INTERACTABLES } from "@/lib/game/world/wild";
import { MAP_LABELS } from "@/lib/game/world/worldmap";
import { toWorld, zoneAt, ZONES } from "@/lib/game/world/zones";

// 0116: the road out to Sông Cái is one route (lib/game/world/routes.ts) — the 2D world map, the 3D world and the server
// all read it. Pins that they agree and that the whole way is walkable.

const SQL = readFileSync("supabase/migrations/0116_song_cai_route.sql", "utf8");
const free = (w: WorldMap, p: Vec) => !w.blocked[Math.floor(p.y / w.cell) * w.cols + Math.floor(p.x / w.cell)];

/** Cells reachable from `from` over free cells (4-neighbour BFS). */
function reach(w: WorldMap, from: Vec): Uint8Array {
  const seen = new Uint8Array(w.cols * w.rows), at = (p: Vec) => Math.floor(p.y / w.cell) * w.cols + Math.floor(p.x / w.cell);
  const q = [at(from)];
  seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop()!, c = i % w.cols, r = (i - c) / w.cols;
    for (const j of [c > 0 ? i - 1 : -1, c < w.cols - 1 ? i + 1 : -1, r > 0 ? i - w.cols : -1, r < w.rows - 1 ? i + w.cols : -1]) {
      if (j >= 0 && !seen[j] && !w.blocked[j]) { seen[j] = 1; q.push(j); }
    }
  }
  return seen;
}

describe("the road out to Sông Cái (routes.ts)", () => {
  const road = ROADS.find((r) => r.id === R.id)!;

  it("is one road of the world's network, junction → landing, off the hall–pond road", () => {
    expect(road.pts).toBe(R.pts);
    expect(road.pts[0]).toEqual(R.junction);
    expect(road.pts[road.pts.length - 1]).toEqual(R.landing);
    const hp = ROADS.find((r) => r.id === "hall_pond")!;
    expect(nearestOn(hp.pts, cumulative(hp.pts), R.junction.x, R.junction.y).d).toBeLessThan(1);
    expect(zoneAt(R.landing)).toBe("wild");
    expect(zoneAt(R.dockFoot)).toBe("song_cai");
  });

  it("maps 2D ↔ 3D through coords.ts within tolerance, and the 3D pieces stand where the 2D map draws them", () => {
    for (const p of [...R.pts, R.sign, R.landing, R.dockFoot]) {
      const a = pxToWorldAbs(p);
      expect(a.x * PX_PER_UNIT).toBeCloseTo(p.x, 6);
      const back = worldAbsToPx(a.x, a.z);
      expect(Math.hypot(back.x - p.x, back.y - p.y)).toBeLessThan(1e-6);
      // zone-local ↔ world: the dock's foot in Sông Cái's px is the same 3D point
      const l = pxToWorldAbs(SONG_CAI_DOCK_LOCAL, { x: ZONES.song_cai.ox, y: ZONES.song_cai.oy });
      const w = pxToWorldAbs(R.dockFoot);
      expect(Math.hypot(l.x - w.x, l.z - w.z)).toBeLessThan(1e-9);
    }
    // the dock's deck never dips under the water, and its head meets the land at the road's end
    for (let y = R.dock.y; y <= R.dock.y + R.dock.h; y += 4) expect(dockDeck(y)).toBeGreaterThan(RIVER_LEVEL);
    expect(Math.abs(dockDeck(R.dock.y) - routeGround(R.landing.x, R.dock.y))).toBeLessThan(0.5);
    // the per-map 2D Sông Cái draws the same dock (zone-local)
    expect(toWorld("song_cai", { x: BEN_DO_DOCK.x, y: 0 })!.x).toBe(R.dock.x);
    expect(BEN_DO_DOCK.w).toBe(R.dock.w);
    expect(toWorld("song_cai", { x: 0, y: BEN_DO_DOCK.y + BEN_DO_DOCK.h })!.y).toBe(R.dock.y + R.dock.h);
  });

  it("is walkable: every waypoint and every 4 px of it is on the road and outside the colliders, locked or not", () => {
    for (const w of [buildWorld(), buildWorld(["hall", "pond", "field", "market", "khu_nha", "bai_dat", "mo_da"])]) {
      const cum = cumulative(road.pts), L = cum[cum.length - 1];
      for (const p of road.pts) expect(free(w, p), `(${p.x}, ${p.y})`).toBe(true);
      for (let s = 0; s <= L; s += 4) {
        const p = pointAt(road.pts, cum, s);
        expect(onPath(p.x, p.y)).toBe(true);
        expect(free(w, p), `s=${s}`).toBe(true);
      }
      // from the pond's exit, on foot, all the way to the landing
      const exit = toWorld("pond", { x: 352, y: 374 })!;
      expect(reach(w, exit)[Math.floor(R.landing.y / w.cell) * w.cols + Math.floor(R.landing.x / w.cell)]).toBe(1);
      // the guard and the boarding point are where the road ends
      expect(w.interactables.some((i) => i.id === "song_cai_landing" && Math.hypot(i.use.x - R.landing.x, i.use.y - R.landing.y) < 1)).toBe(true);
    }
    // the dock's foot is open boat water on Sông Cái (the row lands you there), the dock itself is not
    const sc = buildSongCaiMap();
    expect(riverWater(SONG_CAI_DOCK_LOCAL.x, SONG_CAI_DOCK_LOCAL.y)).toBe(true);
    expect(sc.blocked[Math.floor(SONG_CAI_DOCK_LOCAL.y / sc.cell) * sc.cols + Math.floor(SONG_CAI_DOCK_LOCAL.x / sc.cell)]).toBe(0);
    expect(sc.blocked[Math.floor(90 / sc.cell) * sc.cols + Math.floor(SONG_CAI_DOCK_LOCAL.x / sc.cell)]).toBe(1);
  }, 60_000);

  it("names the junction's signpost and Bến đò on the 2D map, and keeps the level gate at the landing", () => {
    expect(R.sign.text).toBe(`→ Sông Cái (cấp ${SONG_CAI_LEVEL})`);
    expect(MAP_LABELS.find((l) => l.id === "sign_song_cai")?.name).toBe(R.sign.text);
    expect(MAP_LABELS.some((l) => l.id === "ben_do")).toBe(true);
    const g = WORLD_GATES.find((q) => q.id === "gate_song_cai_road")!;
    expect(g.map).toBe("song_cai");
    expect(g.at).toEqual(R.landing);
    expect(WILD_INTERACTABLES.find((i) => i.id === "song_cai_landing")?.kind).toBe("boat");
  });

  it("is mirrored by the server (0116 _song_cai_landing) and never judged 'too far' when walked", () => {
    const m = /'(\{"x": \d+, "y": \d+, "r": \d+, "foot_x": \d+, "foot_y": \d+\})'::jsonb/.exec(SQL);
    expect(m).not.toBeNull();
    const l = JSON.parse(m![1]) as { x: number; y: number; r: number; foot_x: number; foot_y: number };
    expect({ x: l.x, y: l.y }).toEqual(R.landing);
    expect(l.r).toBe(LANDING_NEAR);
    expect({ x: l.foot_x, y: l.foot_y }).toEqual(SONG_CAI_DOCK_LOCAL);
    // the server judges pond → wild at the straight distance (the wild is adjacent to every zone): the road from the
    // pond's exit is no longer than that, so walking it at speed is never refused
    const exit = toWorld("pond", { x: 352, y: 374 })!;
    const walked = Math.hypot(R.junction.x - exit.x, R.junction.y - exit.y) + cumulative(R.pts).at(-1)!;
    expect(walked).toBeLessThanOrEqual(Math.hypot(R.landing.x - exit.x, R.landing.y - exit.y) + 64);
  });
});
