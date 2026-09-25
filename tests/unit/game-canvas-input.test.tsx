import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import GameCanvas, { type GameCanvasHandle, type GameCanvasProps } from "@/components/game/GameCanvas";
import { DEFAULT_LOOK } from "@/lib/game/look";

// One fake engine and channel per world: they record what the canvas tells them (input lock, plots, farm
// animations, messages, hellos and byes) and let a test deliver messages.
type EngineRec = {
  mapId: string; input: boolean[]; plots: unknown[]; anims: number[]; applied: unknown[]; hellos: string[]; removed: string[];
  destroyed: boolean;
};
const { engines, channels, replies } = vi.hoisted(() => ({
  engines: [] as EngineRec[],
  channels: [] as Array<{ onMessage: (msg: unknown) => void; sent: unknown[] }>,
  replies: { hellos: 0 },
}));

vi.mock("@/lib/game/engine", () => ({
  GameEngine: class {
    rec: EngineRec;
    constructor(_canvas: unknown, map: { id: string }) {
      this.rec = { mapId: map.id, input: [], plots: [], anims: [], applied: [], hellos: [], removed: [], destroyed: false };
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
    noteHello(id: string) {
      this.rec.hellos.push(id);
    }
    removeActor(id: string) {
      this.rec.removed.push(id);
    }
    setRoster() {}
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
  createReplyScheduler: () => ({ onHello: () => { replies.hellos++; }, dispose: () => {} }),
  replyWindowMs: () => 0,
}));

// braces matter: a function returned from beforeEach is run as a teardown
beforeEach(() => {
  engines.length = 0;
  channels.length = 0;
  replies.hellos = 0;
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
  isHere: () => true,
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
    const plots = [{ no: 1, look: null, label: "1 · An", urgent: false, parts: 0, harvester: null }];
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

describe("GameCanvas presence filter and receive budgets (anti-cheat spec §14)", () => {
  const mv = (id: string) => ({ t: "mv", id, x: 1, y: 1, d: "d", mv: true, vx: 0, vy: 1 });
  const entry = (id: string) => ({ id, name: id, badges: "", look: DEFAULT_LOOK, spot: null });

  it("takes bye, lk, fs and fa only from members on this map, and nothing from anyone who is not a member", () => {
    const onLookChanged = vi.fn();
    const onPlotChanged = vi.fn();
    render(<GameCanvas mapId="field" {...props} isMember={(id) => id !== "stranger"} isHere={(id) => id === "ann"}
      onLookChanged={onLookChanged} onPlotChanged={onPlotChanged} />);
    const deliver = (msg: unknown) => channels[0].onMessage(msg);
    for (const msg of [{ t: "lk", id: "bob" }, { t: "fs", id: "bob", f: 1, h: null }, { t: "fa", id: "bob", a: 1 }, { t: "bye", id: "bob" }]) {
      deliver(msg);
    }
    const id = "stranger";
    for (const msg of [{ t: "hello", id }, { t: "lk", id }, { t: "fp", id, p: 1 }, { t: "fs", id, f: 1, h: null }, { t: "fa", id, a: 1 }, { t: "bye", id }]) {
      deliver(msg);
    }
    expect(onLookChanged).not.toHaveBeenCalled();
    expect(onPlotChanged).not.toHaveBeenCalled();
    expect(engines[0]).toMatchObject({ applied: [], hellos: [], removed: [] });
    expect(replies.hellos).toBe(0);
    deliver(mv("bob"));
    deliver(mv("stranger"));
    expect(engines[0].applied).toEqual([mv("bob")]);
    for (const msg of [{ t: "hello", id: "ann" }, { t: "lk", id: "ann" }, { t: "fp", id: "ann", p: 1 }, { t: "fa", id: "ann", a: 1 }, { t: "bye", id: "ann" }]) {
      deliver(msg);
    }
    expect(engines[0]).toMatchObject({ hellos: ["ann"], removed: ["ann"] });
    expect(replies.hellos).toBe(1);
    expect(onLookChanged).toHaveBeenCalledWith("ann");
    expect(onPlotChanged).toHaveBeenCalledWith(1);
    expect(engines[0].applied).toEqual([mv("bob"), { t: "fa", id: "ann", a: 1 }]);
  });

  it("answers the hello and passes on the fp of a member whose presence has not arrived yet (R34)", () => {
    const onPlotChanged = vi.fn();
    render(<GameCanvas mapId="field" {...props} isHere={() => false} onPlotChanged={onPlotChanged} />);
    channels[0].onMessage({ t: "hello", id: "newbie" });
    channels[0].onMessage({ t: "fp", id: "newbie", p: 4 });
    expect(engines[0].hellos).toEqual(["newbie"]);
    expect(replies.hellos).toBe(1);
    expect(onPlotChanged).toHaveBeenCalledWith(4);
  });

  it("drops what a sender sends over its budget", () => {
    render(<GameCanvas mapId="pond" {...props} />);
    const deliver = (msg: unknown, times: number) => { for (let i = 0; i < times; i++) channels[0].onMessage(msg); };
    deliver(mv("ann"), 10);
    deliver({ t: "fs", id: "ann", f: 1, h: null }, 8);
    deliver({ t: "fa", id: "ann", a: 2 }, 8);
    deliver({ t: "hello", id: "ann" }, 5);
    deliver({ t: "bye", id: "ann" }, 3);
    deliver(mv("bob"), 1);
    const applied = engines[0].applied as Array<{ t: string; id: string }>;
    expect(applied.filter((m) => m.t === "mv" && m.id === "ann")).toHaveLength(5);
    expect(applied.filter((m) => m.t === "fs")).toHaveLength(5);
    expect(applied.filter((m) => m.t === "fa")).toHaveLength(5);
    expect(applied.filter((m) => m.id === "bob")).toHaveLength(1);
    expect(engines[0]).toMatchObject({ hellos: ["ann"], removed: ["ann"] });
    expect(replies.hellos).toBe(1);
  });

  it("answers a member who appears on this map as a hello would, but not the roster a world starts with", () => {
    const ref = createRef<GameCanvasHandle>();
    const { rerender } = render(<GameCanvas ref={ref} mapId="pond" {...props} isHere={(id) => id !== "cara"} />);
    ref.current!.setRoster([entry("ann")]);
    expect(replies.hellos).toBe(0);
    ref.current!.setRoster([entry("ann"), entry("bob")]);
    expect(replies.hellos).toBe(1);
    ref.current!.setRoster([entry("ann"), entry("bob"), entry("cara")]);
    expect(replies.hellos).toBe(1);
    ref.current!.setRoster([entry("ann")]);
    ref.current!.setRoster([entry("ann"), entry("bob")]);
    expect(replies.hellos).toBe(2);
    rerender(<GameCanvas ref={ref} mapId="hall" {...props} isHere={(id) => id !== "cara"} />);
    ref.current!.setRoster([entry("dan")]);
    expect(replies.hellos).toBe(2);
  });
});
