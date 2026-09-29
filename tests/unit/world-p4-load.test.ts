import { describe, expect, it } from "vitest";
import { FakeBus } from "@/lib/game/net/fake-bus";
import { GridChannels } from "@/lib/game/net/grid-channels";
import type { GameMessage } from "@/lib/game/net/protocol";
import { GAME_LIMITS } from "@/lib/game/net/budget";
import { fromZoneMsg } from "@/lib/game/world/aoi";
import { CELL_H, CELL_HYSTERESIS, CELL_W, cellNeighbourhood, DEGRADED_RATE } from "@/lib/game/world/grid";
import { ROADS } from "@/lib/game/world/wild";
import { isZone, zoneAt, ZONE_IDS, ZONES, type OutdoorMapId } from "@/lib/game/world/zones";
import type { Vec } from "@/lib/game/types";

// P4 load simulator (no network): an in-memory channel bus (lib/game/net/fake-bus.ts, /dev/world-game's) with simulated
// clients of both modes in one room — 3D world clients walking the roads (GridChannels: grid cells + the zone topics) and
// 2D per-map clients wandering their zone (its zone topic, zone-local, exactly as today). Measures deliveries a second,
// channels per client, and checks that close 3D neighbours stay heard across cell borders and that 2D and 3D players in
// the same zone hear each other.

/** A tiny event clock shared by the bus and every client. */
function clock() {
  let t = 0, ids = 0;
  const q: Array<{ at: number; fn: () => void; id: number }> = [];
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => { const id = ++ids; q.push({ at: t + ms, fn, id }); return id; },
    clearTimer: (h: unknown) => { const i = q.findIndex((e) => e.id === h); if (i >= 0) q.splice(i, 1); },
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        let k = -1;
        for (let i = 0; i < q.length; i++) if (q[i].at <= end && (k < 0 || q[i].at < q[k].at)) k = i;
        if (k < 0) break;
        const e = q.splice(k, 1)[0];
        t = e.at;
        e.fn();
      }
      t = end;
    },
  };
}

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** The road network: every road's points, consecutive ones joined, and the road ends in one zone joined to each other. */
function roadGraph(): { pts: Vec[]; next: number[][] } {
  const pts: Vec[] = [], next: number[][] = [];
  const ends = new Map<string, number[]>();
  for (const r of ROADS) {
    const base = pts.length;
    r.pts.forEach((p, i) => { pts.push({ x: p.x, y: p.y }); next.push([]); if (i > 0) { next[base + i].push(base + i - 1); next[base + i - 1].push(base + i); } });
    for (const [end, idx] of [[r.a, base], [r.b, base + r.pts.length - 1]] as const) {
      const z = end.split(":")[0];
      ends.set(z, [...(ends.get(z) ?? []), idx]);
    }
  }
  for (const list of ends.values()) for (const a of list) for (const b of list) if (a !== b) next[a].push(b);
  return { pts, next };
}

interface Client {
  id: string; mode: "3d" | "2d"; pos: Vec; target: Vec | null; node: number; speed: number;
  /** 3D */ grid: GridChannels | null;
  /** 2D: its map (a zone) and its channel. */ zone: OutdoorMapId | null; send2d: ((m: GameMessage) => void) | null;
  heard: Map<string, number>;
  perSec: Map<string, number>;
  /** 3D: since when it has been in its current zone (ms). */
  zoneSince: number; lastZone: string;
  maxOpen: number;
}

interface Result {
  deliveriesPer3dClientPerSec: number;
  maxDeliveriesPerClientPerSec: number;
  maxWantedCells: number;
  maxOpenCells: number;
  avgOpenCells: number;
  maxZoneTopics: number;
  avgZoneTopics: number;
  lost3d: number; checked3d: number;
  lostMixed: number; checkedMixed: number;
  mixedZones: string[];
  maxPerSenderPerSec: number;
  avgHeardPerSenderPerSec: number;
  cellSwitches: number;
  busSendsPerSec: number;
  busDeliveriesPerSec: number;
}

/** `n3d` world clients on the roads (or crowded at one spot) and `n2d` per-map clients in the zones, for `seconds`. */
function simulate(n3d: number, n2d: number, seconds: number, opts: { crowd?: boolean; seed?: number } = {}): Result {
  const ck = clock();
  const rand = rng(opts.seed ?? 7);
  const bus = new FakeBus({ schedule: (fn) => ck.setTimer(fn, 40 + Math.floor(rand() * 80)), cancel: ck.clearTimer });
  const g = roadGraph();
  const clients: Client[] = [];
  let switches = 0;
  const onMsg = (c: Client) => (m: GameMessage) => {
    if (m.t !== "mv") return;
    c.heard.set(m.id, ck.now());
    c.perSec.set(m.id, (c.perSec.get(m.id) ?? 0) + 1);
  };
  for (let i = 0; i < n3d; i++) {
    const node = Math.floor(rand() * g.pts.length);
    const c: Client = {
      id: `w${i}`, mode: "3d", pos: opts.crowd ? { x: 1300 + (i % 8) * 6, y: 700 + Math.floor(i / 8) * 6 } : { ...g.pts[node] },
      target: null, node, speed: 80 + rand() * 80, grid: null, zone: null, send2d: null,
      heard: new Map(), perSec: new Map(), zoneSince: 0, lastZone: "", maxOpen: 0,
    };
    c.grid = new GridChannels("room", { onMessage: onMsg(c), onStatus: () => {} }, bus.join,
      { now: ck.now, setTimer: ck.setTimer, clearTimer: ck.clearTimer });
    clients.push(c);
  }
  const zonesFor2d: OutdoorMapId[] = ZONE_IDS.filter((z) => z !== "song_cai");   // boat water: nobody walks there
  for (let i = 0; i < n2d; i++) {
    const zone = zonesFor2d[i % zonesFor2d.length], r = ZONES[zone];
    const c: Client = {
      id: `m${i}`, mode: "2d", pos: { x: r.ox + 40 + rand() * (r.w - 80), y: r.oy + 40 + rand() * (r.h - 80) },
      target: null, node: 0, speed: 60 + rand() * 60, grid: null, zone, send2d: null,
      heard: new Map(), perSec: new Map(), zoneSince: 0, lastZone: zone, maxOpen: 0,
    };
    // a per-map client: its map's topic, zone-local; what it hears is turned into world px here only to compare
    const h = bus.join("room", { id: zone, width: r.w, height: r.h }, {
      onMessage: (m) => onMsg(c)(fromZoneMsg(m, zone)),
      onStatus: () => {},
    });
    c.send2d = (m) => h.send(m);
    clients.push(c);
  }
  const TICK = 50, SEND_EVERY = 1000 / 3;                                         // the send gate's 3 a second
  let lost3d = 0, checked3d = 0, lostMixed = 0, checkedMixed = 0, maxPerSender = 0;
  let openSum = 0, zoneSum = 0, samples = 0, maxWanted = 0, maxZones = 0, heardSum = 0, heardPairs = 0;
  const mixedZones = new Set<string>();
  const per3dPerSec: number[] = [];
  const nextSend = clients.map((_, i) => (i * 37) % SEND_EVERY);
  const warm = 3000;
  let busSends0 = 0, busDeliveries0 = 0;
  for (let t = 0; t < seconds * 1000; t += TICK) {
    if (t === warm) { busSends0 = bus.sends; busDeliveries0 = bus.deliveries; }
    for (const [i, c] of clients.entries()) {
      if (c.mode === "3d" && !opts.crowd) {
        let step = (c.speed * TICK) / 1000;
        while (step > 0) {
          const q = c.target ?? g.pts[c.node], d = Math.hypot(q.x - c.pos.x, q.y - c.pos.y);
          if (d <= step) {
            c.pos = { ...q }; step -= d;
            const ns = g.next[c.node];
            const nx = ns[Math.floor(rand() * ns.length)];
            if (nx === undefined) break;
            c.node = nx; c.target = g.pts[nx];
          } else { c.pos = { x: c.pos.x + ((q.x - c.pos.x) / d) * step, y: c.pos.y + ((q.y - c.pos.y) / d) * step }; step = 0; }
        }
      } else if (c.mode === "2d") {
        const r = ZONES[c.zone!];
        if (!c.target) c.target = { x: r.ox + 20 + rand() * (r.w - 40), y: r.oy + 20 + rand() * (r.h - 40) };
        const q = c.target, d = Math.hypot(q.x - c.pos.x, q.y - c.pos.y), step = (c.speed * TICK) / 1000;
        if (d <= step) { c.pos = { ...q }; c.target = null; }
        else c.pos = { x: c.pos.x + ((q.x - c.pos.x) / d) * step, y: c.pos.y + ((q.y - c.pos.y) / d) * step };
      }
      if (c.grid) {
        const z = zoneAt(c.pos);
        if (z !== c.lastZone) { c.lastZone = z; c.zoneSince = ck.now(); }
        let seen = 0;
        for (const at of c.heard.values()) if (ck.now() - at < 2000) seen++;
        c.grid.setVisible(seen);
        const s = c.grid.update(c.pos, z);
        if (s.cellChanged && t > 0) switches++;
        const open = c.grid.cells().length, zs = c.grid.zones().length;
        c.maxOpen = Math.max(c.maxOpen, open);
        maxWanted = Math.max(maxWanted, c.grid.wanted().length);
        maxZones = Math.max(maxZones, zs);
        openSum += open; zoneSum += zs; samples++;
      }
      if (ck.now() >= nextSend[i]) {
        nextSend[i] += SEND_EVERY;
        const x = Math.round(c.pos.x), y = Math.round(c.pos.y);
        const m: GameMessage = { t: "mv", id: c.id, x, y, d: "d", mv: true, vx: 0, vy: 1 };
        if (c.grid) c.grid.send(m);
        else { const r = ZONES[c.zone!]; c.send2d!({ ...m, x: x - r.ox, y: y - r.oy }); }
      }
    }
    ck.advance(TICK);
    if ((t + TICK) % 1000 !== 0) continue;
    // every second: the per-sender rates and the visibility checks (heard in the last second)
    for (const c of clients) {
      if (t >= warm && c.mode === "3d") per3dPerSec.push([...c.perSec.values()].reduce((a, b) => a + b, 0));
      for (const v of c.perSec.values()) { maxPerSender = Math.max(maxPerSender, v); if (t >= warm) { heardSum += v; heardPairs++; } }
      c.perSec.clear();
    }
    if (t < warm) continue;
    const fresh = (a: Client, b: Client) => { const at = a.heard.get(b.id); return at !== undefined && ck.now() - at <= 1000; };
    for (const a of clients) for (const b of clients) {
      if (a === b) continue;
      if (a.mode === "3d" && b.mode === "3d") {
        // 3D ↔ 3D: anyone within a cell minus both hysteresis bands (and a send's worth of walking)
        if (Math.abs(a.pos.x - b.pos.x) > CELL_W - 2 * CELL_HYSTERESIS - 120) continue;
        if (Math.abs(a.pos.y - b.pos.y) > CELL_H - 2 * CELL_HYSTERESIS - 120) continue;
        checked3d++;
        if (!fresh(a, b)) lost3d++;
      } else {
        // 2D ↔ 3D in one zone: the 3D one settled in that zone for 1.5 s (its send zone switched, its copies flow)
        const w = a.mode === "3d" ? a : b, m = a.mode === "3d" ? b : a;
        if (w.lastZone !== m.zone || !isZone(w.lastZone) || ck.now() - w.zoneSince < 1500) continue;
        checkedMixed++;
        mixedZones.add(m.zone!);
        if (!fresh(a, b)) lostMixed++;
      }
    }
  }
  const secs = seconds - warm / 1000;
  return {
    deliveriesPer3dClientPerSec: per3dPerSec.length ? per3dPerSec.reduce((a, b) => a + b, 0) / per3dPerSec.length : 0,
    maxDeliveriesPerClientPerSec: per3dPerSec.length ? Math.max(...per3dPerSec) : 0,
    maxWantedCells: maxWanted,
    maxOpenCells: Math.max(0, ...clients.map((c) => c.maxOpen)),
    avgOpenCells: openSum / Math.max(1, samples),
    maxZoneTopics: maxZones,
    avgZoneTopics: zoneSum / Math.max(1, samples),
    lost3d, checked3d, lostMixed, checkedMixed, mixedZones: [...mixedZones].sort(),
    maxPerSenderPerSec: maxPerSender,
    avgHeardPerSenderPerSec: heardSum / Math.max(1, heardPairs),
    cellSwitches: switches,
    busSendsPerSec: (bus.sends - busSends0) / secs,
    busDeliveriesPerSec: (bus.deliveries - busDeliveries0) / secs,
  };
}

const round = (r: Result) => JSON.stringify(r, (_k, v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v));

describe("P4 AOI grid load simulator (in-memory, no network)", () => {
  it("50 3D clients walking the roads: ≤ 9 cells each, deliveries in budget, no lost neighbour", () => {
    const r = simulate(50, 0, 60);
    console.info("[p4-load] 50 3D / 60 s:", round(r));
    expect(r.maxWantedCells).toBeLessThanOrEqual(9);
    expect(r.avgOpenCells).toBeLessThanOrEqual(9.5);                              // a switch holds old + new for a moment
    expect(r.maxOpenCells).toBeLessThanOrEqual(9 + 6);
    expect(r.maxZoneTopics).toBeLessThanOrEqual(6);
    expect(r.cellSwitches).toBeGreaterThan(20);                                   // the walks cross many borders
    expect(r.checked3d).toBeGreaterThan(100);
    expect(r.lost3d).toBe(0);
    expect(r.maxPerSenderPerSec).toBeLessThanOrEqual(GAME_LIMITS.move.burst);     // never trips a receive budget
    // a room-wide channel would hand each client (n − 1) × 3 moves a second; the grid far fewer
    expect(r.deliveriesPer3dClientPerSec).toBeLessThan(49 * 3 * 0.5);
  });

  it("50/50 2D and 3D clients: they hear each other in every zone", () => {
    const r = simulate(50, 50, 60, { seed: 11 });
    console.info("[p4-load] 50 3D + 50 2D / 60 s:", round(r));
    expect(r.lost3d).toBe(0);
    expect(r.checkedMixed).toBeGreaterThan(100);
    expect(r.mixedZones).toEqual(["bai_dat", "field", "hall", "khu_nha", "market", "pond"]);
    expect(r.lostMixed).toBe(0);
    expect(r.maxPerSenderPerSec).toBeLessThanOrEqual(GAME_LIMITS.move.burst);
    expect(r.maxWantedCells).toBeLessThanOrEqual(9);
  });

  it("40 3D clients crowded in one spot degrade to 2 moves a second each", () => {
    const r = simulate(40, 0, 20, { crowd: true });
    console.info("[p4-load] 40 crowded / 20 s:", round(r));
    expect(r.avgHeardPerSenderPerSec).toBeLessThanOrEqual(DEGRADED_RATE + 0.1);
    expect(r.lost3d).toBe(0);
    expect(r.maxDeliveriesPerClientPerSec).toBeLessThanOrEqual(39 * (DEGRADED_RATE + 1));
  });

  it("the neighbourhood is 9 cells at most anywhere", () => {
    for (let c = 0; c < 28; c++) expect(cellNeighbourhood(c).length).toBeLessThanOrEqual(9);
  });
});
