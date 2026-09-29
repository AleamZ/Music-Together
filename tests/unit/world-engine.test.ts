import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { zoneLocalIt } from "@/components/game/GameCanvas";
import { GameEngine, type EngineCallbacks, type LocalMoveMsg } from "@/lib/game/engine";
import { DEFAULT_LOOK } from "@/lib/game/look";
import { MO_DA_ARRIVE } from "@/lib/game/maps/arrivals";
import { getMap } from "@/lib/game/maps/registry";
import type { SceneArt } from "@/lib/game/maps/scene-art";
import type { GameMap, Interactable, Spot } from "@/lib/game/maps/types";
import type { Vec } from "@/lib/game/types";
import { aoiZones, fromZoneMsg, toZoneMsg } from "@/lib/game/world/aoi";
import { buildWorld, type WorldMap } from "@/lib/game/world/compose";
import { MINE, worldArrival } from "@/lib/game/world/wild";
import { serverPos, toWorld, zoneAt, type ZoneId } from "@/lib/game/world/zones";
import type { GameMessage } from "@/lib/game/net/protocol";

// P2: the real engine in world mode (one world map, world px) on a stub 2D context — the zone derived per frame, the
// zone-local positions the RPCs get, the interactables through the spatial hash, the mine mouth and the interiors'
// round trips — and the zone channels' conversions. The loop is driven by hand.

const noopCtx = new Proxy({}, { get: (_t, k) => (k === "measureText" ? () => ({ width: 1 }) : k === "getImageData" ? () => ({ data: new Uint8ClampedArray(4) }) : () => {}), set: () => true });
const art = { props: [], edge: "#000", background: {}, drawAnimated() {}, drawOverhead() {} } as unknown as SceneArt;

let world: WorldMap;
beforeAll(() => { world = buildWorld(); });

let clock = 1000;
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

function setup(start: Spot) {
  const zones: ZoneId[] = [];
  const used: Interactable[] = [];
  const prompts: Array<Interactable | null> = [];
  const moves: LocalMoveMsg[] = [];
  const cb: EngineCallbacks = {
    onLocalMove: (m) => moves.push(m), onLocalPath: () => {}, onInteract: (it) => used.push(it), onPromptChange: (it) => prompts.push(it),
    onActorClick: () => {}, onZoneChange: (z) => zones.push(z),
  };
  const e = new GameEngine(document.createElement("canvas"), world as unknown as GameMap, art, cb, {
    localId: "me", name: "Me", badges: "", look: DEFAULT_LOOK, start, fontFamily: "x", reducedMotion: true, world: true,
  });
  const step = (ms = 50) => { clock += ms; (e as unknown as { update: (dt: number, now: number) => void }).update(ms / 1000, clock); };
  const key = (code: string, down: boolean) => window.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", { code }));
  return { e, zones, used, prompts, moves, step, key };
}
const W = (zone: ZoneId, p: Vec, dir: Spot["dir"] = "down"): Spot => ({ ...toWorld(zone, p)!, dir });

describe("engine world mode: zones", () => {
  it("derives the zone from where my feet are, every frame, walking across the wild from the hall to Chợ Lớn", () => {
    const sign = getMap("hall").interactables.find((i) => i.id === "market_sign")!.use;   // the hall's east opening
    const { e, zones, step, key } = setup(W("hall", { x: sign.x - 4, y: sign.y }, "right"));
    expect(e.isWorld()).toBe(true);
    expect(e.currentZone()).toBe("hall");
    key("KeyD", true);                                                          // the keyboard: out onto the road
    for (let i = 0; i < 40 && e.currentZone() === "hall"; i++) step();
    key("KeyD", false);
    e.tapWorld(toWorld("market", { x: 120, y: 252 })!);                         // a click: along the road into the market
    for (let i = 0; i < 400 && e.currentZone() !== "market"; i++) step();
    expect(zones).toEqual(["wild", "market"]);                     // out of the hall onto the road, then into the market
    expect(e.localPos().x).toBeGreaterThanOrEqual(1760);
  });

  it("gives the RPCs zone-local px (serverPos): toZone(localPos) in the zone I stand in", () => {
    const { e } = setup(W("market", { x: 300, y: 250 }));
    const w = e.localPos();
    expect({ map: e.currentZone(), ...e.toZone(w) }).toEqual(serverPos(w));
    expect(e.fromZone(e.toZone(w))).toEqual(w);
    expect(e.heatProbe().cell).toEqual({ col: Math.floor(300 / 8), row: Math.floor(250 / 8) });   // the claims' cell: zone-local
  });

  it("teleports (a waypoint, the boat, back from an interior) and says the new zone", () => {
    const { e, zones } = setup(W("hall", getMap("hall").spawn));
    e.teleport(W("pond", { x: 300, y: 356 }, "up"));
    expect(e.currentZone()).toBe("pond");
    expect(zones).toEqual(["pond"]);
  });
});

describe("engine world mode: interactables through the spatial hash", () => {
  it("prompts a zone's interactable near me in world px; the shell gets it zone-local (zoneLocalIt)", () => {
    const board = getMap("hall").interactables.find((i) => i.id === "notice_board")!;
    const { e, used, prompts, step } = setup(W("hall", board.use, board.face ?? "up"));
    step();
    expect(prompts.at(-1)?.id).toBe("notice_board");
    expect(prompts.at(-1)?.use).toEqual(toWorld("hall", board.use));
    e.interact();
    expect(used).toHaveLength(1);
    expect(zoneLocalIt(used[0], e.currentZone())).toEqual(board);
  });

  it("walks to a clicked interactable far away (the click looks around the clicked point)", () => {
    const board = getMap("hall").interactables.find((i) => i.id === "notice_board")!;
    const { e, used, step } = setup(W("hall", getMap("hall").spawn));
    e.tapWorld({ x: board.rect.x + 960 + board.rect.w / 2, y: board.rect.y + 480 + board.rect.h / 2 });
    for (let i = 0; i < 400 && used.length === 0; i++) step();
    expect(used.map((i) => i.id)).toEqual(["notice_board"]);
  });
});

describe("the mine: mouth → cave → back up", () => {
  it("the mine mouth on the hills is a portal to Mỏ đá's arrival; coming out of the cave lands at the mouth", () => {
    const { e, used, prompts, step } = setup({ ...MINE.use, dir: "right" });
    step();
    expect(e.currentZone()).toBe("wild");
    expect(prompts.at(-1)?.id).toBe("mine_entrance");
    e.interact();
    const door = zoneLocalIt(used[0], e.currentZone());
    expect(door.to).toEqual({ map: "mo_da", arrive: MO_DA_ARRIVE });
    // the cave (an interior: its own map) — its exit portal names Bãi đất, the world mode lands at the mouth
    const exit = getMap("mo_da").interactables.find((i) => i.id === "mo_da_exit")!;
    const out = worldArrival("mo_da", exit.to!.map);
    expect(out).toEqual(MINE.exit);
    expect(zoneAt(out!)).toBe("wild");
    expect(world.blocked[Math.floor(out!.y / 8) * world.cols + Math.floor(out!.x / 8)]).toBe(0);
    // a per-map client's exit still goes to Bãi đất (no world arrival between two outdoor maps)
    expect(worldArrival("hall", "market")).toBeNull();
  });

  it("the hầm (an interior too): the market's hatch goes down, its ladder comes up at the hatch, both in the world", () => {
    const hatch = world.interactables.find((i) => i.kind === "ug_hatch")!;
    expect(hatch.zone).toBe("market");
    expect(hatch.to?.map).toBe("ham_ngam");
    const up = getMap("ham_ngam").interactables.find((i) => i.kind === "portal" && i.to?.map === "market")!;
    const at = toWorld("market", up.to!.arrive)!;
    expect(world.blocked[Math.floor(at.y / 8) * world.cols + Math.floor(at.x / 8)]).toBe(0);
    expect(worldArrival("ham_ngam", "market")).toBeNull();                     // the hatch's own spot
  });
});

describe("zone channels (the cut-down AOI)", () => {
  it("listens to my zone, the road-joined ones and the wild; from the wild, the zones near me", () => {
    expect(aoiZones("hall", { x: 1200, y: 600 })).toEqual(["hall", "field", "market", "pond", "wild"]);
    expect(aoiZones("wild", MINE.use)).toEqual(["wild", "bai_dat", "khu_nha"]);
    expect(aoiZones("pond", { x: 1200, y: 1200 })).toContain("song_cai");     // the boat
  });

  it("sends zone-local (clamped; a path cut where it leaves the zone) and reads back world px", () => {
    const mv: GameMessage = { t: "mv", id: "a", x: 1000, y: 700, d: "r", mv: true, vx: 1, vy: 0 };
    expect(toZoneMsg(mv, "hall")).toMatchObject({ x: 40, y: 220 });
    expect(fromZoneMsg(toZoneMsg(mv, "hall"), "hall")).toMatchObject({ x: 1000, y: 700 });
    const pa: GameMessage = { t: "pa", id: "a", x: 1500, y: 680, pts: [[1580, 680], [1640, 680], [1700, 700]] };
    const out = toZoneMsg(pa, "hall") as Extract<GameMessage, { t: "pa" }>;
    expect(out.pts).toEqual([[620, 200], [640, 200]]);                          // cut at the hall's east edge
    expect(fromZoneMsg({ ...pa }, "wild")).toEqual(pa);                          // the wild's px are world px
  });
});
