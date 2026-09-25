import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import GameCanvas, { type GameCanvasHandle, type GameCanvasProps } from "@/components/game/GameCanvas";
import { DEFAULT_LOOK } from "@/lib/game/look";

// One fake engine and channel per world: they record what the canvas tells them (input lock, plots, farm
// animations, messages) and let a test deliver messages.
type EngineRec = { mapId: string; input: boolean[]; plots: unknown[]; anims: number[]; applied: unknown[]; destroyed: boolean };
const { engines, channels } = vi.hoisted(() => ({
  engines: [] as EngineRec[],
  channels: [] as Array<{ onMessage: (msg: unknown) => void; sent: unknown[] }>,
}));

vi.mock("@/lib/game/engine", () => ({
  GameEngine: class {
    rec: EngineRec;
    constructor(_canvas: unknown, map: { id: string }) {
      this.rec = { mapId: map.id, input: [], plots: [], anims: [], applied: [], destroyed: false };
      engines.push(this.rec);
    }
    setInputEnabled(enabled: boolean) {
      this.rec.input.push(enabled);
    }
    setPlots(plots: unknown) {
      this.rec.plots.push(plots);
    }
    showFarmAnim(a: number) {
      this.rec.anims.push(a);
    }
    applyMessage(msg: unknown) {
      this.rec.applied.push(msg);
    }
    setLocalHand() {}
    setSpecies() {}
    setBottomInset() {}
    start() {}
    destroy() {
      this.rec.destroyed = true;
    }
    snapshot() {
      return { t: "hello", id: "me" };
    }
    walkers() {
      return 0;
    }
  },
}));
vi.mock("@/lib/game/maps/registry", () => ({
  getMap: (id: string) => ({ id, width: 640, height: 400, spawn: { x: 100, y: 100, dir: "down" } }),
  paintMap: () => ({}),
}));
vi.mock("@/lib/game/net/channel", () => ({
  joinGameChannel: (_room: string, _map: unknown, h: { onMessage: (msg: unknown) => void }) => {
    const ch = { onMessage: h.onMessage, sent: [] as unknown[] };
    channels.push(ch);
    return { send: (msg: unknown) => ch.sent.push(msg), leave: () => {} };
  },
}));
vi.mock("@/lib/game/net/replies", () => ({
  createReplyScheduler: () => ({ onHello: () => {}, dispose: () => {} }),
  replyWindowMs: () => 0,
}));

// braces matter: a function returned from beforeEach is run as a teardown
beforeEach(() => {
  engines.length = 0;
  channels.length = 0;
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const noop = () => {};
const onUnsupported = vi.fn();
const props: Omit<GameCanvasProps, "ref" | "mapId"> = {
  roomId: "r",
  localId: "me",
  arrive: null,
  initial: { name: "An", badges: "", look: DEFAULT_LOOK },
  isMember: () => true,
  onInteract: noop,
  onPromptChange: noop,
  onActorClick: noop,
  onConnectionChange: noop,
  onLookChanged: noop,
  onFishingInput: noop,
  onFirstFrame: noop,
  onUnsupported,
  onFatal: noop,
};

describe("GameCanvas input lock across travel", () => {
  it("gives the new map's engine the lock that was on when I left (a panel stays open)", () => {
    const ref = createRef<GameCanvasHandle>();
    const { rerender } = render(<GameCanvas ref={ref} mapId="hall" {...props} />);
    expect(onUnsupported).not.toHaveBeenCalled();
    ref.current!.setInputEnabled(false);
    rerender(<GameCanvas ref={ref} mapId="pond" {...props} />);
    const [hall, pond] = engines;
    expect(hall.input.at(-1)).toBe(false);
    expect(hall.destroyed).toBe(true);
    expect(pond.mapId).toBe("pond");
    expect(pond.input.at(-1)).toBe(false);
  });
  it("lets go of it again: input back on reaches the next map's engine too", () => {
    const ref = createRef<GameCanvasHandle>();
    const { rerender } = render(<GameCanvas ref={ref} mapId="hall" {...props} />);
    ref.current!.setInputEnabled(false);
    rerender(<GameCanvas ref={ref} mapId="pond" {...props} />);
    ref.current!.setInputEnabled(true);
    rerender(<GameCanvas ref={ref} mapId="hall" {...props} />);
    expect(engines.map((e) => e.mapId)).toEqual(["hall", "pond", "hall"]);
    expect(engines[2].input.at(-1)).toBe(true);
  });
});

describe("GameCanvas plots across travel", () => {
  it("passes the plots on at once and gives them to the next map's engine", () => {
    const ref = createRef<GameCanvasHandle>();
    const { rerender } = render(<GameCanvas ref={ref} mapId="field" {...props} />);
    const plots = [{ no: 1, look: null, label: "1 · An", urgent: false }];
    ref.current!.setPlots(plots);
    expect(engines[0].plots.at(-1)).toBe(plots);
    rerender(<GameCanvas ref={ref} mapId="hall" {...props} />);
    rerender(<GameCanvas ref={ref} mapId="field" {...props} />);
    expect(engines[2].plots.at(-1)).toBe(plots);
  });
});

describe("GameCanvas farm messages", () => {
  it("plays my farm animation and sends fa and fp", () => {
    const ref = createRef<GameCanvasHandle>();
    render(<GameCanvas ref={ref} mapId="field" {...props} />);
    ref.current!.farmAnim(3);
    ref.current!.plotChanged(7);
    expect(engines[0].anims).toEqual([3]);
    expect(channels[0].sent).toEqual([{ t: "fa", id: "me", a: 3 }, { t: "fp", id: "me", p: 7 }]);
  });
  it("passes on fp from the others and from my other tab, and gives fa to the engine", () => {
    const onPlotChanged = vi.fn();
    render(<GameCanvas mapId="field" {...props} onPlotChanged={onPlotChanged} />);
    channels[0].onMessage({ t: "fp", id: "ann", p: 7 });
    channels[0].onMessage({ t: "fp", id: "me", p: 0 });
    expect(onPlotChanged.mock.calls).toEqual([[7], [0]]);
    channels[0].onMessage({ t: "fa", id: "ann", a: 1 });
    expect(engines[0].applied).toEqual([{ t: "fa", id: "ann", a: 1 }]);
  });
});
