import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import GameCanvas, { type GameCanvasHandle } from "@/components/game/GameCanvas";
import type { WorldLive } from "@/lib/game/diorama/world/live-plan";
import type { DioramaFrame } from "@/lib/game/diorama/types";
import { GameEngine } from "@/lib/game/engine";
import type { Stall } from "@/lib/game/economy/model";
import { DEFAULT_LOOK } from "@/lib/game/look";
import type { GameChannelHandlers } from "@/lib/game/net/channel";
import type { WorldState } from "@/lib/game/realm/rpc";
import { ZONE_IDS } from "@/lib/game/world/zones";

// P4: GameCanvas in world mode feeds the 3D world view's setLive from the shell's state (no WebGL in jsdom: the view
// is a recording fake).

const { views, FakeView } = vi.hoisted(() => {
  const views: Array<{ lives: WorldLive[]; render(f: DioramaFrame): void }> = [];
  class FakeView {
    lives: WorldLive[] = [];
    constructor() { views.push(this); }
    setLive(l: WorldLive) { this.lives.push(l); }
    render() {}
    setCameraMode() {}
    setFelled() {}
    setPlots() {}
    dispose() {}
  }
  return { views, FakeView };
});
vi.mock("@/lib/game/diorama/world/view", () => ({ WorldView: FakeView }));

const noopCtx = new Proxy({}, { get: (_t, k) => (k === "measureText" ? () => ({ width: 1 }) : k === "getImageData" ? () => ({ data: new Uint8ClampedArray(4) }) : () => {}), set: () => true });
const join = (_room: string, _map: { id: string }, h: GameChannelHandlers) => {
  queueMicrotask(() => h.onStatus(true));
  return { send: () => {}, leave: () => {} };
};

beforeEach(() => {
  views.length = 0;
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

const realm: WorldState = {
  serverNowMs: Date.now(), night: false, snowUntilMs: null, fights: [], next: [], party: null, invites: [], dungeon: null, clearsToday: 0,
  wild: { animals: [{ id: 9, species: "deer", hx: 300, hy: 200, seed: 3, bornMs: Date.now(), expiresMs: Date.now() + 1e6, photographed: false }], bag: {}, album: {}, killsToday: 0 },
};

describe("GameCanvas world mode → WorldView.setLive (P4)", () => {
  it("stalls, animals and houses from the handle; pets and bobbers from the engine's frame", async () => {
    const setView = vi.spyOn(GameEngine.prototype, "setView3D");
    const ref = createRef<GameCanvasHandle>();
    render(<GameCanvas ref={ref} roomId="r" localId="me" mapId="hall" arrive={null} initial={{ name: "Me", badges: "", look: DEFAULT_LOOK }}
      isMember={() => true} isHere={() => true} onInteract={() => {}} onPromptChange={() => {}} onActorClick={() => {}}
      onConnectionChange={() => {}} onLookChanged={() => {}} onFishingInput={() => {}} onFirstFrame={() => {}} onUnsupported={() => {}}
      onFatal={() => {}} world={{ unlocked: ZONE_IDS }} joinChannel={join} />);
    await act(async () => {});
    const v = views[0];
    expect(v).toBeDefined();
    const h = ref.current!;
    h.setLiveInputs!({ stalls: [{ no: 2, mine: false, renterName: "Bé Na", paidMs: null, items: [] } as Stall] });
    h.setLiveInputs!({ realm: { state: realm, zone: "field", offsetMs: 0 } });
    h.setHouses([{ lot: 1, owned: true, grid: null, roof: "la" }]);
    const last = v.lives.at(-1)!;
    expect(last.stalls?.map((s) => s.name)).toEqual(["Bé Na"]);
    expect(last.animals?.map((a) => a.species)).toEqual(["deer"]);
    expect(last.houses?.[0]).toMatchObject({ lot: 0, owned: true });

    // the engine renders through a wrapper: the moving part (the deer on its path) is brought up to time, then the view draws
    const wrapper = setView.mock.calls.map((c) => c[0]).filter(Boolean).at(-1)!;
    const renders = vi.spyOn(v, "render");
    const n = v.lives.length;
    const f = { gameplay: { rats: [], dogs: [], leaps: [], gates: [], pets: [{ ownerId: "me", species: "cho", x: 1, y: 2 }] } } as unknown as DioramaFrame;
    wrapper.render(f);
    expect(v.lives.length).toBe(n + 1);
    expect(renders).toHaveBeenCalledWith(f);                                      // the frame's pets reach the view as is
    // nothing moving: a frame sets nothing
    h.setLiveInputs!({ realm: null });
    const m = v.lives.length;
    wrapper.render(f);
    expect(v.lives.length).toBe(m);
  }, 30_000);                                                              // builds the whole delta world
});
