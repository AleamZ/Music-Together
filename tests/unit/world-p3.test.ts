import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine, type EngineCallbacks } from "@/lib/game/engine";
import { isPondWater } from "@/lib/game/fishing/shore";
import { DEFAULT_LOOK } from "@/lib/game/look";
import { jumpTarget, nearestEdge } from "@/lib/game/heat/pond";
import type { SceneArt } from "@/lib/game/maps/scene-art";
import type { GameMap, Interactable, MapId, Spot } from "@/lib/game/maps/types";
import { WALK_SPEED } from "@/lib/game/movement";
import { aggregatePresenceModes } from "@/lib/presence-modes";
import { Pack } from "@/lib/game/pack";
import { ratAt, type FieldRats, type RatLive } from "@/lib/game/farm/rats";
import { beatDue } from "@/lib/game/position";
import { riverWater } from "@/lib/game/river/geometry";
import { RIDE_SPEED, rideSpeed } from "@/lib/game/travel/ride";
import { speedMul, VEHICLES, WORLD_RIDE_SPEED } from "@/lib/game/travel/vehicles";
import { aoiStep, aoiZones, nearestZone, toZoneMsg, WILD_REACH } from "@/lib/game/world/aoi";
import { buildWorld } from "@/lib/game/world/compose";
import { gateNear, gateText, WORLD_GATES } from "@/lib/game/world/gates";
import { worldSwimMap } from "@/lib/game/world/swim";
import { waypointAt, waypointClick, waypointMarks } from "@/lib/game/world/waypoints";
import { fitWorld } from "@/lib/game/world/minimap";
import { MINE } from "@/lib/game/world/mine";
import { toWorld, ZONE_IDS, ZONES, type ZoneId } from "@/lib/game/world/zones";
import { ZoneChannels } from "@/lib/game/net/world-channels";
import type { GameMessage } from "@/lib/game/net/protocol";
import { parseGameMessage } from "@/lib/game/net/protocol";
import type { Facing, Vec } from "@/lib/game/types";

// P3 (unified world, 0089): vehicles ride the world at speed_mul, the ride on the heartbeat, the waypoints on the maps,
// the level gates, the pond / field / river gameplay in world px, and the wild's area of interest + zone-local fallback.

vi.setConfig({ testTimeout: 60_000 });                                           // a few whole worlds are built

describe("vehicles on the world's roads", () => {
  it("derives speed_mul from the old trip like 0089 (bike 1.77, moto 2.54, car 3), capped at 3", () => {
    expect(Object.fromEntries(VEHICLES.map((v) => [v.id, speedMul(v.tripMs)]))).toEqual({ bike: 1.77, moto: 2.54, car: 3 });
    expect(WORLD_RIDE_SPEED).toEqual({ bike: 1.77, moto: 2.54, car: 3 });
    expect(speedMul(0)).toBe(3);
    expect(speedMul(15000)).toBe(1);
    expect(speedMul(99999)).toBe(1);
  });

  it("rides at speed_mul in the world and at the old factors on a per-map game", () => {
    expect(rideSpeed("car", true)).toBe(3);
    expect(rideSpeed("bike", true)).toBe(1.77);
    expect(rideSpeed("car")).toBe(RIDE_SPEED.car);
    expect(rideSpeed(null, true)).toBe(1);
  });

  it("beats every 3 s on foot and every second riding, once I moved 16 px", () => {
    expect(beatDue(null, { x: 0, y: 0 }, 0, null)).toBe(true);
    const last = { x: 0, y: 0, at: 0 };
    expect(beatDue(last, { x: 10, y: 0 }, 5000, "car")).toBe(false);          // not moved enough
    expect(beatDue(last, { x: 40, y: 0 }, 1000, null)).toBe(false);          // on foot: 3 s
    expect(beatDue(last, { x: 40, y: 0 }, 3000, null)).toBe(true);
    expect(beatDue(last, { x: 40, y: 0 }, 1000, "moto")).toBe(true);
    expect(beatDue(last, { x: 40, y: 0 }, 1000, "lift")).toBe(true);
  });
});

describe("waypoints on the world map", () => {
  const marks = waypointMarks(new Set(["wp_hall", "wp_pond"]), "wp_hall");

  it("puts each 0070 waypoint at its world px (0088 world_waypoints)", () => {
    expect(marks.map((m) => m.id)).toEqual(["wp_hall", "wp_pond", "wp_field", "wp_market", "wp_khu_nha", "wp_bai_dat"]);
    expect(marks.find((m) => m.id === "wp_hall")).toMatchObject({ x: 1572, y: 780, found: true, here: true });
    expect(marks.find((m) => m.id === "wp_pond")).toMatchObject({ x: 1260, y: 1396, found: true, here: false });
    expect(marks.find((m) => m.id === "wp_market")?.found).toBe(false);
  });

  it("finds the one clicked on the canvas and says whether it travels", () => {
    const v = fitWorld(832, 448);
    const pond = marks.find((m) => m.id === "wp_pond")!;
    const c = { x: (pond.x - v.x0) * v.scale + 3, y: (pond.y - v.y0) * v.scale - 2 };
    expect(waypointAt(marks, v, c)?.id).toBe("wp_pond");
    expect(waypointAt(marks, v, { x: 1, y: 1 })).toBeNull();
    expect(waypointClick(pond)).toEqual({ travel: true });
    expect(waypointClick(marks[0]).travel).toBe(false);                        // here
    expect(waypointClick(marks.find((m) => m.id === "wp_market")!).travel).toBe(false);   // not found
  });
});

describe("level gates", () => {
  it("shuts Mỏ đá's mouth and Sông Cái's pier for a low level: barrier, guard, no door", () => {
    const low = buildWorld(ZONE_IDS);                                          // mo_da not unlocked
    expect(low.gates.map((g) => g.id)).toEqual(["gate_mo_da"]);
    expect(low.npcs.some((n) => n.id === "guard_mo_da")).toBe(true);
    expect(low.interactables.some((i) => i.id === "mine_entrance")).toBe(false);
    const b = WORLD_GATES.find((g) => g.id === "gate_mo_da")!.barrier!;
    const cell = (x: number, y: number) => low.blocked[Math.floor(y / low.cell) * low.cols + Math.floor(x / low.cell)];
    expect(cell(b.x + b.w / 2, b.y + b.h / 2)).toBe(1);

    const noRiver = buildWorld(ZONE_IDS.filter((z) => z !== "song_cai"));
    expect(noRiver.gates.map((g) => g.id).sort()).toEqual(["gate_mo_da", "gate_song_cai"]);
    expect(noRiver.npcs.some((n) => n.id === "guard_song_cai")).toBe(true);

    const all = buildWorld();
    expect(all.gates).toEqual([]);
    expect(all.interactables.some((i) => i.id === "mine_entrance")).toBe(true);
    expect(all.npcs.some((n) => n.id.startsWith("guard_"))).toBe(false);
  }, 60_000);

  it("finds the gate I walk up to and words the toast", () => {
    const g = gateNear(WORLD_GATES, { x: MINE.use.x - 40, y: MINE.use.y });
    expect(g?.map).toBe("mo_da");
    expect(gateNear(WORLD_GATES, { x: 100, y: 100 })).toBeNull();
    expect(gateText(5)).toContain("Cần cấp 5");
  });
});

describe("the pond, the field's rats and the boat in world px", () => {
  it("lets a swimmer through the pond zone's water (and nowhere else)", () => {
    const w = buildWorld();
    const s = worldSwimMap(w)!;
    let water = 0;
    for (let r = 0; r < 50; r++) for (let c = 0; c < 80; c++) {
      if (!isPondWater(c, r)) continue;
      water++;
      const i = (ZONES.pond.oy / 8 + r) * w.cols + ZONES.pond.ox / 8 + c;
      expect(s.blocked[i]).toBe(0);
    }
    expect(water).toBeGreaterThan(100);
    expect(worldSwimMap(buildWorld(ZONE_IDS.filter((z) => z !== "pond")))).toBeNull();
  });

  it("draws and hunts the field's rats at the field zone's origin", () => {
    const t0 = 1_000_000;
    const rats: FieldRats = { nextAt: 0, price: 150, live: [{ id: 1, plot: 1, since: t0, seed: 7 }], recent: [], plots: {} };
    let t = t0, p: ReturnType<typeof ratAt> = null;
    for (; t < t0 + 60_000 && !p; t += 250) p = ratAt(rats.live[0] as RatLive, t);
    expect(p).not.toBeNull();
    const pack = new Pack(() => false, "me", { x: 0, y: 560 });
    pack.setRats(rats, 0);
    const drawn = pack.drawnRats(0, t - 250);
    expect(drawn[0]).toMatchObject({ x: p!.x, y: p!.y + 560 });
    const flat = new Pack(() => false, "me");
    flat.setRats(rats, 0);
    expect(flat.drawnRats(0, t - 250)[0]).toMatchObject({ x: p!.x, y: p!.y });
  });
});

// ---------------------------------------------------------------- the engine in world mode

const noopCtx = new Proxy({}, { get: (_t, k) => (k === "measureText" ? () => ({ width: 1 }) : k === "getImageData" ? () => ({ data: new Uint8ClampedArray(4) }) : () => {}), set: () => true });
const art = { props: [], edge: "#000", background: {}, drawAnimated() {}, drawOverhead() {} } as unknown as SceneArt;
let clock = 1000;

describe("engine world mode (P3)", () => {
  beforeEach(() => {
    clock = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => noopCtx as unknown as CanvasRenderingContext2D);
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function setup(start: Spot, unlocked: readonly ZoneId[] = [...ZONE_IDS, "mo_da"]) {
    const gates: MapId[] = [];
    const prompts: Array<Interactable | null> = [];
    const cb: EngineCallbacks = {
      onLocalMove: () => {}, onLocalPath: () => {}, onInteract: () => {}, onPromptChange: (it) => prompts.push(it),
      onActorClick: () => {}, onGate: (m) => gates.push(m),
    };
    const e = new GameEngine(document.createElement("canvas"), buildWorld(unlocked) as unknown as GameMap, art, cb, {
      localId: "me", name: "Me", badges: "", look: DEFAULT_LOOK, start, fontFamily: "x", reducedMotion: true, world: true,
    });
    const step = (ms = 50) => { clock += ms; (e as unknown as { update: (dt: number, now: number) => void }).update(ms / 1000, clock); };
    return { e, gates, prompts, step };
  }
  const W = (zone: ZoneId, p: Vec, dir: Facing = "down"): Spot => ({ ...toWorld(zone, p)!, dir });

  it("rides at walk × speed_mul in the world", () => {
    const { e } = setup(W("hall", { x: 300, y: 300 }));
    expect(e.localSpeed()).toBe(WALK_SPEED);
    e.setRiding("car");
    expect(e.localSpeed()).toBeCloseTo(WALK_SPEED * 3);
    e.setRiding("bike");
    expect(e.localSpeed()).toBeCloseTo(WALK_SPEED * 1.77);
  });

  it("jumps into the pond zone from its bank, in world px", () => {
    const edge = nearestEdge({ x: 320, y: 200 })!;
    const face = (["up", "down", "left", "right"] as const).find((f) => jumpTarget(edge, f))!;
    const target = jumpTarget(edge, face)!;
    const { e } = setup(W("pond", edge, face));
    expect(e.currentZone()).toBe("pond");
    expect(e.jumpIn()).toBe(true);
    expect(e.isSwimming()).toBe(true);
    expect(e.localPos()).toEqual(toWorld("pond", target));
  });

  it("does not jump in outside the pond zone", () => {
    const { e } = setup(W("hall", { x: 300, y: 300 }));
    expect(e.jumpIn()).toBe(false);
  });

  it("says the shut gate once as I walk up to it", () => {
    const { e, gates, step } = setup({ x: MINE.use.x - 30, y: MINE.use.y, dir: "right" }, ZONE_IDS);
    step();
    step();
    expect(gates).toEqual(["mo_da"]);
    e.teleport({ x: MINE.use.x - 300, y: MINE.use.y, dir: "left" });
    step();
    e.teleport({ x: MINE.use.x - 30, y: MINE.use.y, dir: "right" });
    step();
    expect(gates).toEqual(["mo_da", "mo_da"]);
  });

  it("sits in a boat on Sông Cái's water and hands the 3D world the gates", () => {
    let spot: Vec | null = null;
    for (let y = 40; y < 440 && !spot; y += 8) for (let x = 40; x < 900 && !spot; x += 8) if (riverWater(x, y)) spot = { x, y };
    const { e } = setup(W("song_cai", spot!), ZONE_IDS);
    const f = (e as unknown as { dioramaFrame: (t: number) => import("@/lib/game/diorama/types").DioramaFrame }).dioramaFrame(clock);
    const me = f.billboards.find((b) => b.me)!;
    expect(me.vehicle).toBe("boat");
    expect(me.act).toBe("sit");
    expect(f.gameplay?.gates.map((g) => g.id)).toContain("gate_mo_da");
  });
});

// ---------------------------------------------------------------- realtime in the wild

describe("the wild's area of interest and the zone-local fallback", () => {
  it("always listens to the nearest zone from the wild", () => {
    const far = { x: 2200, y: 2100 };                                          // south of the river, far from everything
    expect(nearestZone(far)).toBe("song_cai");
    expect(aoiZones("wild", far)).toContain("song_cai");
    expect(nearestZone({ x: 900, y: 700 })).toBe("hall");
  });

  it("recomputes as I walk the wild, keeping a zone within the hysteresis", () => {
    const hall = ZONES.hall;
    const near = { x: hall.ox - 100, y: hall.oy + 100 };                       // west of the hall
    const cur = aoiZones("wild", near);
    expect(cur).toContain("hall");
    expect(aoiStep(cur, "wild", near)).toBeNull();                               // nothing changed
    const edge = { x: hall.ox - WILD_REACH - 30, y: hall.oy + 100 };            // just past the reach: kept
    const kept = aoiStep(cur, "wild", edge);
    expect((kept ?? cur).includes("hall")).toBe(true);
    const gone = aoiStep(cur, "wild", { x: 200, y: 1500 });
    expect(gone).not.toBeNull();
  });

  it("marks the fallback copy, which the old parser ignores and the world channels drop", () => {
    const st: GameMessage = { t: "st", id: "a1b2c3d4-0000-4000-8000-000000000001", x: 900, y: 700, d: "d", mv: false, vx: 0, vy: 0 } as GameMessage;
    const fb = toZoneMsg(st, "hall", true) as Extract<GameMessage, { t: "st" | "mv" }>;
    expect(fb.fb).toBe(1);
    expect(fb.x).toBe(0);                                                       // clamped onto the hall's edge
    const parsed = parseGameMessage("st", { ...fb }, { width: 640, height: 400 });
    expect(parsed && "fb" in parsed ? parsed.fb : undefined).toBe(1);

    const sent: Array<{ zone: string; msg: GameMessage }> = [];
    const got: GameMessage[] = [];
    const handlers = new Map<string, (m: GameMessage) => void>();
    const zc = new ZoneChannels("room", { onMessage: (m) => got.push(m), onStatus: () => {} }, ((_r: string, map: { id: string }, h: { onMessage: (m: GameMessage) => void }) => {
      handlers.set(map.id, h.onMessage);
      return { send: (msg: GameMessage) => sent.push({ zone: map.id, msg }), leave: () => {} };
    }) as never);
    zc.setZones(["wild", "hall"], "hall");
    zc.send(st);
    expect(sent.map((s) => s.zone)).toEqual(["wild", "hall"]);
    expect((sent[1].msg as { fb?: number }).fb).toBe(1);
    handlers.get("hall")!(fb);                                                  // a copy heard: dropped
    handlers.get("wild")!(st);
    expect(got).toHaveLength(1);
    zc.setZones(["hall", "wild"], "hall");                                      // in a zone: no fallback
    sent.length = 0;
    zc.send(st);
    expect(sent.map((s) => s.zone)).toEqual(["hall"]);
  });

  it("reads the wild from presence's w flag (older clients see the nearest zone)", () => {
    const [a, b] = aggregatePresenceModes({ a: [{ mode: "game", map: "hall", w: 1 }], b: [{ mode: "game", map: "hall" }] });
    expect(a.map).toBe("wild");
    expect(b.map).toBe("hall");
  });
});
