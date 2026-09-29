import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getMap } from "@/lib/game/maps/registry";
import { MAP_IDS, type GameMap } from "@/lib/game/maps/types";
import type { Vec } from "@/lib/game/types";
import { buildWorld, interactablesNear, npcsNear, openingEnd, type WorldMap } from "@/lib/game/world/compose";
import { MO_DA_ARRIVE } from "@/lib/game/maps/arrivals";
import { INTERIOR_EXITS, MINE, OPENINGS, ROADS } from "@/lib/game/world/wild";
import {
  INTERIORS, serverPos, toLocal, toWorld, WORLD_CELL, WORLD_H, WORLD_W, zoneAt, ZONE_IDS, ZONES, type ZoneId,
} from "@/lib/game/world/zones";

const SQL = readFileSync("supabase/migrations/0088_unified_world.sql", "utf8").replace(/\r\n/g, "\n");
const fnBody = (name: string) => {
  const head = `create or replace function public.${name}(`;
  const at = SQL.indexOf(head);
  expect(at, name).toBeGreaterThanOrEqual(0);
  return SQL.slice(at, SQL.indexOf("$$;", at) + 3);
};

/** Cells reachable from `from` (4-neighbour BFS over free cells, plus the world's links). */
function reach(w: WorldMap, from: Vec): Uint8Array {
  const seen = new Uint8Array(w.cols * w.rows);
  const at = (p: Vec) => Math.floor(p.y / w.cell) * w.cols + Math.floor(p.x / w.cell);
  const links = new Map<number, number>();
  for (const l of w.links) { links.set(at(l.from), at(l.to)); links.set(at(l.to), at(l.from)); }
  const q = [at(from)];
  seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop()!, c = i % w.cols, r = (i - c) / w.cols;
    const next = [c > 0 ? i - 1 : -1, c < w.cols - 1 ? i + 1 : -1, r > 0 ? i - w.cols : -1, r < w.rows - 1 ? i + w.cols : -1];
    const l = links.get(i);
    if (l !== undefined) next.push(l);
    for (const j of next) if (j >= 0 && !seen[j] && !w.blocked[j]) { seen[j] = 1; q.push(j); }
  }
  return seen;
}

describe("zones", () => {
  it("fit the world, do not overlap, and are the maps' sizes on the 8 px grid", () => {
    const ids = ZONE_IDS;
    expect([...ids].sort()).toEqual(MAP_IDS.filter((m) => !INTERIORS.includes(m)).sort());
    for (const id of ids) {
      const z = ZONES[id];
      expect(z.ox >= 0 && z.oy >= 0 && z.ox + z.w <= WORLD_W && z.oy + z.h <= WORLD_H, id).toBe(true);
      expect([z.ox % WORLD_CELL, z.oy % WORLD_CELL], id).toEqual([0, 0]);
      expect([z.w, z.h], id).toEqual([getMap(id).width, getMap(id).height]);
    }
    for (const a of ids) for (const b of ids) if (a < b) {
      const p = ZONES[a], q = ZONES[b];
      expect(p.ox < q.ox + q.w && q.ox < p.ox + p.w && p.oy < q.oy + q.h && q.oy < p.oy + p.h, `${a}/${b}`).toBe(false);
    }
  });

  it("toWorld / toLocal round-trip; the wild is the identity; interiors have no world position", () => {
    for (const id of ZONE_IDS) {
      const z = ZONES[id];
      for (const p of [{ x: 0, y: 0 }, { x: z.w - 1, y: z.h - 1 }, { x: 123, y: 77 }]) {
        const w = toWorld(id, p)!;
        expect(zoneAt(w)).toBe(id);
        expect(toLocal(w)).toEqual({ zone: id, p });
      }
    }
    expect(toLocal({ x: 5, y: 5 })).toEqual({ zone: "wild", p: { x: 5, y: 5 } });
    expect(toWorld("wild", { x: 900, y: 500 })).toEqual({ x: 900, y: 500 });
    expect(toWorld("ham_ngam", { x: 1, y: 1 })).toBeNull();
    expect(serverPos({ x: 960 + 612.4, y: 480 + 299.6 })).toEqual({ map: "hall", x: 612, y: 300 });
    for (let i = 0; i < 500; i++) {
      const w = { x: Math.floor(Math.random() * WORLD_W), y: Math.floor(Math.random() * WORLD_H) };
      const l = toLocal(w);
      expect(toWorld(l.zone, l.p)).toEqual(w);
    }
  });

  it("0088's _world_zones is ZONES; its _pos_maps is 0086's plus the wild", () => {
    const rows = [...fnBody("_world_zones").matchAll(/\('(\w+)', (\d+), (\d+), (\d+), (\d+)\)/g)]
      .map((m) => [m[1], Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])]);
    expect(rows).toEqual(ZONE_IDS.map((id) => [id, ZONES[id].ox, ZONES[id].oy, ZONES[id].w, ZONES[id].h]));
    const maps = [...fnBody("_pos_maps").matchAll(/\('(\w+)', (\d+), (\d+)\)/g)].map((m) => [m[1], Number(m[2]), Number(m[3])]);
    expect(maps).toEqual([...MAP_IDS.map((id) => [id, getMap(id).width, getMap(id).height]), ["wild", WORLD_W, WORLD_H]]);
  });
});

describe("buildWorld", () => {
  const world = buildWorld();
  const seen = reach(world, world.spawn);
  const cellOf = (p: Vec) => Math.floor(p.y / WORLD_CELL) * world.cols + Math.floor(p.x / WORLD_CELL);
  const free = (p: Vec) => world.blocked[cellOf(p)] === 0 && seen[cellOf(p)] === 1;
  /** A reachable free cell within r px (an NPC stands on its own solid; the boat's deck is in the water). */
  const nearFree = (p: Vec, r: number) => {
    for (let dy = -r; dy <= r; dy += 4) for (let dx = -r; dx <= r; dx += 4) if (free({ x: p.x + dx, y: p.y + dy })) return true;
    return false;
  };

  it("is one grid of the world's size with the hall's spawn in world px", () => {
    expect([world.cols, world.rows, world.blocked.length]).toEqual([520, 280, 520 * 280]);
    expect(world.spawn).toMatchObject(toWorld("hall", getMap("hall").spawn)!);
    expect(world.zones).toEqual([...ZONE_IDS]);
  });

  it("stamps each zone's grid at its offset (outside its openings)", () => {
    for (const id of ZONE_IDS) {
      const m = getMap(id), z = ZONES[id];
      let differ = 0;
      for (let i = 0; i < m.blocked.length; i++) {
        const c = i % m.cols, r = (i - c) / m.cols;
        if (world.blocked[(z.oy / 8 + r) * world.cols + z.ox / 8 + c] !== m.blocked[i]) differ++;
      }
      expect(differ, id).toBeLessThan(m.blocked.length * 0.02);                       // only the carved openings
    }
  });

  const zonesWithMaps = ZONE_IDS.map((id) => [id, getMap(id)] as [ZoneId, GameMap]);

  it("every old spawn, interactable and portal end lands on a free world cell reachable from the hall's spawn; NPCs keep their cells", () => {
    const bad: string[] = [];
    for (const [id, m] of zonesWithMaps) {
      const W = (p: Vec) => toWorld(id, p)!;
      if (!free(W(m.spawn))) bad.push(`${id} spawn`);
      for (const it of m.interactables) {
        const ok = it.kind === "boat" ? nearFree(W(it.use), 64) : free(W(it.use));   // the ghe floats off Cầu ao
        if (!ok) bad.push(`${id} ${it.id} use`);
        if (it.to && !INTERIORS.includes(it.to.map) && !free(toWorld(it.to.map, it.to.arrive)!)) bad.push(`${id} ${it.id} arrive`);
      }
      // a shopkeeper stands behind its counter (on a solid, as on its map): the world keeps its cell as it was
      for (const n of m.npcs) {
        const w = W(n.spot), local = m.blocked[Math.floor(n.spot.y / 8) * m.cols + Math.floor(n.spot.x / 8)];
        if (world.blocked[cellOf(w)] !== local) bad.push(`${id} npc ${n.id}`);
      }
      for (const p of m.plots) if (!nearFree(W(p.post), 16)) bad.push(`${id} plot ${p.no}`);
    }
    expect(bad).toEqual([]);
  });

  it("the portals between outdoor maps are gone (openings); the hầm's hatch stays; roads join the openings' ends", () => {
    expect(world.interactables.filter((i) => i.kind === "portal").map((i) => i.id)).toEqual(["mine_entrance"]);
    const hatch = world.interactables.find((i) => i.kind === "ug_hatch");
    expect(hatch?.to?.map).toBe("ham_ngam");
    expect(hatch?.zone).toBe("market");
    for (const [id, m] of zonesWithMaps) for (const it of m.interactables)
      if (it.kind === "portal") expect(OPENINGS.some((o) => o.zone === id && o.portal === it.id), `${id} ${it.id}`).toBe(true);
    for (const o of OPENINGS) {
      const use = getMap(o.zone).interactables.find((i) => i.id === o.portal)!.use;
      const end = openingEnd(o, use);
      const road = ROADS.find((r) => r.a === `${o.zone}:${o.portal}` || r.b === `${o.zone}:${o.portal}`);
      expect(road, `${o.zone}:${o.portal}`).toBeDefined();
      const tip = road!.a === `${o.zone}:${o.portal}` ? road!.pts[0] : road!.pts[road!.pts.length - 1];
      expect(tip, `${o.zone}:${o.portal}`).toEqual(end);
    }
  });

  it("tags things with their zone and hashes them", () => {
    const board = world.interactables.find((i) => i.id === "notice_board")!;
    expect(board.zone).toBe("hall");
    expect(interactablesNear(world, board.use, 4)).toContain(board);
    const n = world.npcs[0];
    expect(npcsNear(world, n.spot, 1)).toContain(n);
    expect(world.plots.every((p) => p.zone === "field")).toBe(true);
    expect(world.props.length).toBe(ZONE_IDS.reduce((s, id) => s + getMap(id).props.length, 0));
  });

  it("a locked zone is solid and empty; its neighbours keep their walls shut", () => {
    const w = buildWorld(ZONE_IDS.filter((z) => z !== "song_cai" && z !== "khu_nha"));
    const z = ZONES.khu_nha;
    expect(w.blocked[(z.oy / 8 + 25) * w.cols + z.ox / 8 + 40]).toBe(1);
    expect(w.interactables.some((i) => i.zone === "khu_nha")).toBe(false);
    expect(w.links).toEqual([]);
    const s = reach(w, w.spawn);
    const gate = toWorld("market", getMap("market").interactables.find((i) => i.id === "market_to_khu_nha")!.use)!;
    expect(s[Math.floor(gate.y / 8) * w.cols + Math.floor(gate.x / 8)]).toBe(1);        // the gate's spot, but no further
    const inside = toWorld("khu_nha", getMap("khu_nha").spawn)!;
    expect(s[Math.floor(inside.y / 8) * w.cols + Math.floor(inside.x / 8)]).toBe(0);
  });
});

describe("P2: Mỏ đá underground", () => {
  const world = buildWorld();
  const seen = reach(world, world.spawn);
  const cellOf = (p: Vec) => Math.floor(p.y / WORLD_CELL) * world.cols + Math.floor(p.x / WORLD_CELL);

  it("is an interior: no zone, no world position, nothing of it in the world", () => {
    expect(INTERIORS).toContain("mo_da");
    expect(ZONE_IDS).not.toContain("mo_da");
    expect(toWorld("mo_da", { x: 44, y: 200 })).toBeNull();
    expect(zoneAt({ x: 3600, y: 1240 })).toBe("wild");                                   // the old plateau is the wild's
    expect(world.interactables.some((i) => i.zone === ("mo_da" as ZoneId))).toBe(false);
    expect(world.interactables.some((i) => i.id === "mo_da_gate")).toBe(false);           // Bãi đất's gate is an opening
  });

  it("the mine mouth on the hills is a portal down to the cave, reachable on foot, the road ending at it", () => {
    const door = world.interactables.find((i) => i.id === "mine_entrance")!;
    expect(door).toMatchObject({ zone: "wild", kind: "portal", to: { map: "mo_da", arrive: MO_DA_ARRIVE }, use: MINE.use });
    expect(interactablesNear(world, MINE.use, 4)).toContain(door);
    for (const p of [MINE.use, INTERIOR_EXITS.mo_da!]) {
      expect(world.blocked[cellOf(p)], `${p.x},${p.y}`).toBe(0);
      expect(seen[cellOf(p)], `${p.x},${p.y}`).toBe(1);
    }
    expect(world.blocked[cellOf(MINE.mouth)]).toBe(1);                                    // the frame itself is solid
    const road = ROADS.find((r) => r.b === "wild:mine")!;
    expect(road.a).toBe("bai_dat:mo_da_gate");
    expect(road.pts[road.pts.length - 1]).toEqual(MINE.use);
    expect(OPENINGS.find((o) => o.portal === "mo_da_gate")).toMatchObject({ zone: "bai_dat", wild: true });
  });

  it("0088's portal graph joins the mouth and the cave both ways (the level gate is the claim on mo_da)", () => {
    const body = fnBody("_pos_portals");
    const exit = getMap("mo_da").interactables.find((i) => i.id === "mo_da_exit")!;
    expect(body).toContain(`('wild', 'mo_da', ${MINE.use.x}, ${MINE.use.y}, ${MO_DA_ARRIVE.x}, ${MO_DA_ARRIVE.y}, false)`);
    expect(body).toContain(`('mo_da', 'wild', ${exit.use.x}, ${exit.use.y}, ${INTERIOR_EXITS.mo_da!.x}, ${INTERIOR_EXITS.mo_da!.y}, false)`);
    expect(fnBody("_world_zones")).not.toContain("'mo_da'");
    expect(SQL).toContain("delete from public.world_waypoints where id = 'ww_mo_da'");
  });

  it("0088's waypoint exemption needs a fresh paid trip to that waypoint (no free teleport)", () => {
    const body = fnBody("_pos_at_waypoint");
    expect(body).toContain("r.tp_at >= p_since");
    expect(body).toContain("interval '60 seconds'");
    expect(fnBody("_pos_claim")).toContain("_pos_at_waypoint(p_account, p_map, p_x, p_y, pp.map, pp.x, pp.y, pp.at)");
  });
});