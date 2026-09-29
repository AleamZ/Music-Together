import { describe, expect, it } from "vitest";
import { boatWater, isWildBoatSpot, wildBoatInteractable, worldBoatMap } from "@/lib/game/world/boat";
import { buildWorld } from "@/lib/game/world/compose";
import { riverWater } from "@/lib/game/river/geometry";
import { CANALS, RIVER_PTS } from "@/lib/game/world/terrain";
import { WORLD_H, WORLD_W, ZONES, zoneAt } from "@/lib/game/world/zones";

// 0095: the server's lenient mask (supabase/migrations/0095_river_world.sql _river_world_water), ported.
function polyDist(pts: readonly { x: number; y: number }[], x: number, y: number): number {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / l2));
    d = Math.min(d, Math.hypot(x - a.x - t * (b.x - a.x), y - a.y - t * (b.y - a.y)));
  }
  return d;
}
function serverWater(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x > WORLD_W || y > WORLD_H) return false;
  const z = zoneAt({ x, y });
  if (z === "song_cai") {
    const lx = x - ZONES.song_cai.ox, ly = y - ZONES.song_cai.oy;
    if (riverWater(lx, ly, 8)) return true;
    return (lx < 56 || lx > 936) && polyDist(RIVER_PTS, x, y) < 208;
  }
  if (z !== "wild") return false;
  return polyDist(RIVER_PTS, x, y) < 208 || CANALS.some((c) => polyDist(c, x, y) < 21);
}

describe("0095: the boat on the seamless river", () => {
  it("every point the client floats on passes the server's mask", () => {
    let n = 0;
    for (let y = 2; y < WORLD_H; y += 6) for (let x = 2; x < WORLD_W; x += 6) {
      if (!boatWater(x, y)) continue;
      n++;
      expect(serverWater(x, y), `(${x}, ${y})`).toBe(true);
    }
    expect(n).toBeGreaterThan(5000);
  }, 30000);

  it("dry land, other zones and the lake are no boat water", () => {
    expect(boatWater(ZONES.hall.ox + 50, ZONES.hall.oy + 50)).toBe(false);
    expect(boatWater(2000, 1000)).toBe(false);
    expect(boatWater(-10, 1560)).toBe(false);
  });

  it("the boat grid joins Sông Cái to the river both ways and to the canals", () => {
    const w = buildWorld(), g = worldBoatMap(w);
    const start = { x: ZONES.song_cai.ox + 80, y: ZONES.song_cai.oy + 240 };
    const seen = new Uint8Array(g.cols * g.rows), q: number[] = [];
    const s0 = Math.floor(start.y / g.cell) * g.cols + Math.floor(start.x / g.cell);
    expect(g.blocked[s0]).toBe(0);
    seen[s0] = 1; q.push(s0);
    while (q.length) {
      const i = q.pop()!, c = i % g.cols, r = (i - c) / g.cols;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= g.cols || rr >= g.rows) continue;
        const j = rr * g.cols + cc;
        if (!seen[j] && !g.blocked[j]) { seen[j] = 1; q.push(j); }
      }
    }
    const reach = (x: number, y: number) => seen[Math.floor(y / g.cell) * g.cols + Math.floor(x / g.cell)] === 1;
    expect(reach(424, 1900)).toBe(true);                 // the river west of the zone
    expect(reach(3300, 1850)).toBe(true);                // …and east
    expect(reach(2250, 1400)).toBe(true);                // a canal
    expect(reach(3340, 1100)).toBe(true);                // another
  }, 30000);

  it("a cast prompt from the boat on the wild's water, none on land", () => {
    const it = wildBoatInteractable(424, 1900, "right");
    expect(it && isWildBoatSpot(it)).toBe(true);
    expect(it?.label).toBe("Sông Cái");
    expect(wildBoatInteractable(2250, 1400, "up")?.label).toBe("Kênh rạch");
    expect(wildBoatInteractable(2000, 1000, "up")).toBeNull();
  });
});
