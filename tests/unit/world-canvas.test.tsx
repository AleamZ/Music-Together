import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import GameCanvas, { type GameCanvasHandle } from "@/components/game/GameCanvas";
import { DEFAULT_LOOK } from "@/lib/game/look";
import { getMap } from "@/lib/game/maps/registry";
import type { Interactable } from "@/lib/game/maps/types";
import type { GameChannelHandlers } from "@/lib/game/net/channel";
import type { GameMessage } from "@/lib/game/net/protocol";
import { cellAt, cellNeighbourhood, cellTopicId } from "@/lib/game/world/grid";
import { MINE } from "@/lib/game/world/wild";
import { serverPos, toWorld, ZONE_IDS, type ZoneId } from "@/lib/game/world/zones";

// P2: GameCanvas in world mode with the real engine (a stub 2D context; no WebGL in jsdom, so the world view fails and
// says so) and a fake channel factory: what the shell and the RPCs get from the handle is zone-local (serverPos), the
// interactables it hands over are the zones' own, the wire is zone-local on my zone's topic, and a real arrival moves me.

const noopCtx = new Proxy({}, { get: (_t, k) => (k === "measureText" ? () => ({ width: 1 }) : k === "getImageData" ? () => ({ data: new Uint8ClampedArray(4) }) : () => {}), set: () => true });

let topics: Map<string, { h: GameChannelHandlers; sent: GameMessage[] }>;
const join = (_room: string, map: { id: string }, h: GameChannelHandlers) => {
  const rec = { h, sent: [] as GameMessage[] };
  topics.set(map.id, rec);
  queueMicrotask(() => h.onStatus(true));
  return { send: (m: GameMessage) => rec.sent.push(m), leave: () => { topics.delete(map.id); } };
};

beforeEach(() => {
  topics = new Map();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => noopCtx as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount(props: Partial<Parameters<typeof GameCanvas>[0]> = {}) {
  const ref = createRef<GameCanvasHandle>();
  const got = { interact: [] as Interactable[], zones: [] as ZoneId[], aoi: [] as ZoneId[][], failed: 0 };
  const base = {
    roomId: "r", localId: "me", mapId: "hall" as const, arrive: null, initial: { name: "Me", badges: "", look: DEFAULT_LOOK },
    isMember: () => true, isHere: () => true, onInteract: (it: Interactable) => got.interact.push(it), onPromptChange: () => {},
    onActorClick: () => {}, onConnectionChange: () => {}, onLookChanged: () => {}, onFishingInput: () => {}, onFirstFrame: () => {},
    onUnsupported: () => {}, onFatal: () => {}, world: { unlocked: ZONE_IDS }, joinChannel: join,
    onZoneChange: (z: ZoneId) => got.zones.push(z), onAoiChange: (a: ZoneId[]) => got.aoi.push(a), onWorldFailed: () => got.failed++,
  };
  const r = render(<GameCanvas ref={ref} {...base} {...props} />);
  return { ref, got, r, base };
}

describe("GameCanvas in world mode (P2)", () => {
  it("answers the shell zone-local: localPos is serverPos, mapId the zone; worldPos/zone the world's", async () => {
    const { ref, got } = mount();
    await act(async () => {});
    const h = ref.current!;
    const spawn = getMap("hall").spawn;
    expect(h.worldPos()).toEqual(toWorld("hall", spawn));
    expect(h.localPos()).toEqual({ x: spawn.x, y: spawn.y });
    const sp = serverPos(h.worldPos()!);
    expect({ map: h.mapId(), ...h.localPos() }).toEqual(sp);
    expect(h.zone()).toBe("hall");
    expect(got.zones).toEqual(["hall"]);
    expect(got.aoi[0]).toContain("hall");
    // P4: my grid cell + its neighbours (world px), and the zone topics they overlap (the 2D clients there)
    const cell = cellAt(h.worldPos()!);
    const cells = cellNeighbourhood(cell).map(cellTopicId);
    expect([...topics.keys()].filter((t) => t.startsWith("c")).sort()).toEqual([...cells].sort());
    expect([...topics.keys()].filter((t) => !t.startsWith("c")).sort()).toEqual(got.aoi[0].filter((z) => z !== "wild").sort());
    expect(got.failed).toBe(1);                                                  // jsdom: no WebGL for the world view
  }, 30_000);                                                              // builds the whole delta world (heavier since the delta passes)

  it("broadcasts on my grid cell (world px) with a zone-local copy on my zone's topic; plant takes zone-local points", async () => {
    const { ref } = mount();
    await act(async () => {});
    const h = ref.current!;
    const hall = topics.get("hall")!;
    const own = topics.get(cellTopicId(cellAt(h.worldPos()!)))!;
    expect(hall.sent.some((m) => m.t === "hello")).toBe(true);
    expect(own.sent.some((m) => m.t === "hello")).toBe(true);
    const copy = hall.sent.find((m) => m.t === "st") as Extract<GameMessage, { t: "st" | "mv" }>;
    expect(copy).toMatchObject({ fb: 1, x: getMap("hall").spawn.x, y: getMap("hall").spawn.y });   // zone-local, flagged
    h.plant({ x: 100, y: 120 }, "up");                                            // a fishing spot, zone-local
    expect(h.worldPos()).toEqual(toWorld("hall", { x: 100, y: 120 }));
    expect(h.localPos()).toEqual({ x: 100, y: 120 });
    const last = own.sent.filter((m) => m.t === "mv").at(-1) as Extract<GameMessage, { t: "st" | "mv" }>;
    const w = toWorld("hall", { x: 100, y: 120 })!;
    expect([last.x, last.y]).toEqual([w.x, w.y]);                                 // the cell's wire is world px
    for (const [t, rec] of topics) if (t !== "hall" && rec !== own && !t.startsWith("c")) expect(rec.sent.filter((m) => m.t === "mv")).toEqual([]);
  });

  it("a real arrival (travelKey) moves me in the running world — out of the cave onto the mine mouth", async () => {
    const { ref, r, base } = mount();
    await act(async () => {});
    r.rerender(<GameCanvas ref={ref} {...base} mapId="bai_dat" arrive={getMap("bai_dat").spawn} travelKey={1} arriveWorld={MINE.exit} />);
    await act(async () => {});
    expect(ref.current!.worldPos()).toEqual({ x: MINE.exit.x, y: MINE.exit.y });
    expect(ref.current!.zone()).toBe("wild");
    expect(ref.current!.localPos()).toBeNull();                                   // the wild: no zone-local position
    expect(ref.current!.mapId()).toBeNull();
  });

  it("an interior (Mỏ đá) is its own map: its own topic, identity positions", async () => {
    const { ref } = mount({ mapId: "mo_da", arrive: getMap("mo_da").spawn });
    await act(async () => {});
    expect([...topics.keys()]).toEqual(["mo_da"]);
    expect(ref.current!.mapId()).toBe("mo_da");
    expect(ref.current!.localPos()).toEqual({ x: getMap("mo_da").spawn.x, y: getMap("mo_da").spawn.y });
    expect(ref.current!.worldPos()).toBeNull();
  });
});
