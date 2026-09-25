import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import GameCanvas, { type GameCanvasHandle, type GameCanvasProps } from "@/components/game/GameCanvas";
import { DEFAULT_LOOK } from "@/lib/game/look";

// One fake engine per world: it records what the canvas tells it about the input lock.
const { engines } = vi.hoisted(() => ({
  engines: [] as Array<{ mapId: string; input: boolean[]; destroyed: boolean }>,
}));

vi.mock("@/lib/game/engine", () => ({
  GameEngine: class {
    rec: { mapId: string; input: boolean[]; destroyed: boolean };
    constructor(_canvas: unknown, map: { id: string }) {
      this.rec = { mapId: map.id, input: [], destroyed: false };
      engines.push(this.rec);
    }
    setInputEnabled(enabled: boolean) {
      this.rec.input.push(enabled);
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
  joinGameChannel: () => ({ send: () => {}, leave: () => {} }),
}));
vi.mock("@/lib/game/net/replies", () => ({
  createReplyScheduler: () => ({ onHello: () => {}, dispose: () => {} }),
  replyWindowMs: () => 0,
}));

// braces matter: a function returned from beforeEach is run as a teardown
beforeEach(() => {
  engines.length = 0;
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
