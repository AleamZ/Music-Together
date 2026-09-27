import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine, type EngineCallbacks, type LocalMoveMsg } from "@/lib/game/engine";
import { DEFAULT_LOOK } from "@/lib/game/look";
import type { SceneArt } from "@/lib/game/maps/scene-art";
import type { GameMessage } from "@/lib/game/net/protocol";
import { LIFT_LOST_MS } from "@/lib/game/travel/lift";
import { mapFromAscii } from "./helpers/ascii-map";

// The real engine on a stub 2D context: the lift's movement, tags and endings (v18.13). The loop is driven by hand.

const map = mapFromAscii(Array(20).fill(".".repeat(40)));
const noopCtx = new Proxy({}, { get: (_t, k) => (k === "measureText" ? () => ({ width: 1 }) : k === "getImageData" ? () => ({ data: new Uint8ClampedArray(4) }) : () => {}), set: () => true });
const art = { props: [], edge: "#000", background: {}, drawAnimated() {}, drawOverhead() {} } as unknown as SceneArt;

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

function setup() {
  const moves: LocalMoveMsg[] = [];
  const lost = vi.fn();
  const cb: EngineCallbacks = {
    onLocalMove: (m) => moves.push(m), onLocalPath: () => {}, onInteract: () => {}, onPromptChange: () => {}, onActorClick: () => {},
    onLiftLost: lost,
  };
  const e = new GameEngine(document.createElement("canvas"), map, art, cb, {
    localId: "me", name: "Me", badges: "", look: DEFAULT_LOOK, start: { x: 60, y: 60, dir: "down" }, fontFamily: "x", reducedMotion: true,
  });
  e.setRoster([{ id: "dan", name: "Dan", badges: "", look: DEFAULT_LOOK, spot: null }, { id: "pia", name: "Pia", badges: "", look: DEFAULT_LOOK, spot: null }]);
  const step = (ms = 16) => { clock += ms; (e as unknown as { update: (dt: number, now: number) => void }).update(ms / 1000, clock); };
  return { e, moves, lost, step };
}
const st = (id: string, x: number, y: number, extra: object = {}) =>
  ({ t: "st", id, x, y, d: "r", mv: false, vx: 0, vy: 0, ...extra }) as GameMessage;

describe("GameEngine lifts (v18.13)", () => {
  it("offers a lift from a rider in range who carries nobody, only while I am on foot", () => {
    const { e } = setup();
    e.applyMessage(st("dan", 200, 60, { v: "moto" }));
    expect(e.liftCandidate()).toBeNull();
    e.applyMessage(st("dan", 75, 60, { v: "moto" }));
    expect(e.liftCandidate()).toEqual({ id: "dan", name: "Dan" });
    expect(e.nearForLift("dan")).toBe(true);
    e.applyMessage(st("dan", 75, 60, { v: "moto", ps: "pia" }));
    expect(e.liftCandidate()).toBeNull();
    e.applyMessage(st("dan", 75, 60, { v: "moto" }));
    e.setRiding("bike");
    expect(e.liftCandidate()).toBeNull();
  });
  it("a passenger sits on the driver, says so, and cannot walk; getting off sets me down beside the vehicle", () => {
    const { e, moves, step } = setup();
    e.applyMessage(st("dan", 100, 80, { v: "car", ps: "me" }));
    e.setLift({ role: "passenger", peer: "dan" });
    expect(moves.at(-1)).toMatchObject({ lf: "dan" });
    step();
    expect(e.localPos()).toEqual({ x: 100, y: 80 });
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowLeft" }));
    step(200);
    expect(e.localPos()).toEqual({ x: 100, y: 80 });
    e.setLift(null);
    expect(e.localPos()).toEqual({ x: 100, y: 90 });
    expect(moves.at(-1)).not.toHaveProperty("lf");
    expect(e.liftState()).toBeNull();
  });
  it("a driver tags the passenger and ends the lift when they leave, vanish or disagree", () => {
    const { e, moves, lost, step } = setup();
    e.setRiding("moto");
    e.applyMessage(st("pia", 70, 60, { lf: "me" }));
    e.setLift({ role: "driver", peer: "pia" });
    expect(moves.at(-1)).toMatchObject({ v: "moto", ps: "pia" });
    step();
    expect(lost).not.toHaveBeenCalled();
    e.removeActor("pia");
    expect(lost).toHaveBeenCalledTimes(1);
    expect(e.liftState()).toBeNull();
    // unseen for too long
    e.setLift({ role: "driver", peer: "cara" });
    step(LIFT_LOST_MS + 50);
    expect(lost).toHaveBeenCalledTimes(2);
    // seen, but not riding with me after the sync window
    e.applyMessage(st("pia", 70, 60));
    e.setLift({ role: "driver", peer: "pia" });
    step(1000);
    expect(lost).toHaveBeenCalledTimes(2);
    step(2500);
    expect(lost).toHaveBeenCalledTimes(3);
  });
  it("a passenger whose driver is seen on foot is set down", () => {
    const { e, lost, step } = setup();
    e.applyMessage(st("dan", 100, 80, { v: "bike", ps: "me" }));
    e.setLift({ role: "passenger", peer: "dan" });
    step();
    e.applyMessage(st("dan", 100, 80));
    step(3500);
    expect(lost).toHaveBeenCalled();
    expect(e.liftState()).toBeNull();
  });
});
