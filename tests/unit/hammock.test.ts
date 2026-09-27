import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine, type EngineCallbacks, type LocalMoveMsg } from "@/lib/game/engine";
import { DEFAULT_LOOK } from "@/lib/game/look";
import { buildHallMap, HALL_HAMMOCK } from "@/lib/game/maps/hall";
import { isBlockedAt } from "@/lib/game/movement";
import type { SceneArt } from "@/lib/game/maps/scene-art";
import type { Interactable } from "@/lib/game/maps/types";
import { parseGameMessage, type GameMessage } from "@/lib/game/net/protocol";
import { RemoteWorld } from "@/lib/game/world";
import { HAMMOCK_TAKEN_TEXT, HAMMOCK_UP_TEXT, hammockBlocked, hammockKeeper, hammockPrompt } from "@/lib/game/hammock";
import { drawHammockLive, fabricAt, HAMMOCK_DOZE_MS, HAMMOCK_PERIOD_MS, hammockSwing, lyingSprite } from "@/lib/game/art/hammock";

const hall = buildHallMap();
const st = (id: string, x: number, y: number, extra: object = {}) =>
  ({ t: "st", id, x, y, d: "u", mv: false, vx: 0, vy: 0, ...extra }) as GameMessage;

describe("the hammock's rules", () => {
  it("sits in the hall with a walkable use spot south of the fabric", () => {
    expect(hall.interactables).toContain(HALL_HAMMOCK);
    expect(isBlockedAt(hall, HALL_HAMMOCK.use.x, HALL_HAMMOCK.use.y)).toBe(false);
  });
  it("is refused on a vehicle, swimming, riding along, fishing or locked", () => {
    const ok = { riding: false, swimming: false, passenger: false, rodOut: false, locked: false };
    expect(hammockBlocked(ok)).toBe(false);
    for (const k of Object.keys(ok)) expect(hammockBlocked({ ...ok, [k]: true })).toBe(true);
  });
  it("prompts Dậy while I lie, Có người đang nằm while taken, the same objects each time", () => {
    expect(hammockPrompt(HALL_HAMMOCK, false, false)).toBe(HALL_HAMMOCK);
    const up = hammockPrompt(HALL_HAMMOCK, true, false);
    expect(up.prompt).toBe(HAMMOCK_UP_TEXT);
    expect(hammockPrompt(HALL_HAMMOCK, true, true)).toBe(up);
    expect(hammockPrompt(HALL_HAMMOCK, false, true).prompt).toBe(HAMMOCK_TAKEN_TEXT);
    expect(hammockPrompt(HALL_HAMMOCK, false, true)).toBe(hammockPrompt(HALL_HAMMOCK, false, true));
  });
  it("the lowest account id keeps it", () => {
    expect(hammockKeeper([])).toBeNull();
    expect(hammockKeeper(["m", "b", "x"])).toBe("b");
  });
});

describe("hm on movement messages", () => {
  const bounds = { width: 640, height: 400 };
  it("parses hm: 1 on st/mv/pa and drops anything else", () => {
    expect(parseGameMessage("st", { id: "a", x: 128, y: 212, d: "u", mv: false, vx: 0, vy: 0, hm: 1 }, bounds)).toMatchObject({ hm: 1 });
    expect(parseGameMessage("mv", { id: "a", x: 128, y: 212, d: "u", mv: false, vx: 0, vy: 0, hm: 1 }, bounds)).toMatchObject({ hm: 1 });
    expect(parseGameMessage("pa", { id: "a", x: 1, y: 1, pts: [[2, 2]], hm: 1 }, bounds)).toMatchObject({ hm: 1 });
    expect(parseGameMessage("st", { id: "a", x: 128, y: 212, d: "u", mv: false, vx: 0, vy: 0, hm: 2 }, bounds)).not.toHaveProperty("hm");
    expect(parseGameMessage("st", { id: "a", x: 128, y: 212, d: "u", mv: false, vx: 0, vy: 0, hm: true }, bounds)).not.toHaveProperty("hm");
  });
  it("the world remembers who lies in it and since when, until a message without hm or a bye", () => {
    const w = new RemoteWorld(hall, "me");
    w.setRoster([{ id: "ann", name: "Ann", badges: "", look: DEFAULT_LOOK, spot: null }], 0);
    w.applyMessage(st("ann", 128, 212, { hm: 1 }), 100);
    w.applyMessage(st("ann", 128, 212, { hm: 1 }), 900);
    expect(w.hammock("ann")).toBe(true);
    expect(w.hammockSince("ann")).toBe(100);
    w.applyMessage(st("ann", 128, 212), 1000);
    expect(w.hammock("ann")).toBe(false);
    w.applyMessage(st("ann", 128, 212, { hm: 1 }), 1100);
    w.remove("ann");
    expect(w.hammockSince("ann")).toBeNull();
  });
});

// The real engine on a stub 2D context (like engine-lift.test.ts), the loop driven by hand.
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

function setup(localId = "me") {
  const moves: LocalMoveMsg[] = [];
  const shell: Interactable[] = [];
  const prompts: Array<Interactable | null> = [];
  const cb: EngineCallbacks = {
    onLocalMove: (m) => moves.push(m), onLocalPath: () => {}, onInteract: (it) => shell.push(it), onPromptChange: (it) => prompts.push(it),
    onActorClick: () => {},
  };
  const e = new GameEngine(document.createElement("canvas"), hall, art, cb, {
    localId, name: "Me", badges: "", look: DEFAULT_LOOK, start: { x: 128, y: 214, dir: "up" }, fontFamily: "x", reducedMotion: true,
  });
  e.setRoster([{ id: "dan", name: "Dan", badges: "", look: DEFAULT_LOOK, spot: null }]);
  const step = (ms = 16) => { clock += ms; (e as unknown as { update: (dt: number, now: number) => void }).update(ms / 1000, clock); };
  return { e, moves, shell, prompts, step };
}

describe("GameEngine: lying in the hammock", () => {
  it("E lies me down on the use spot and tells the others; E again gets me up; the shell never hears of it", () => {
    const { e, moves, shell, prompts, step } = setup();
    step();
    expect(prompts.at(-1)?.kind).toBe("hammock");
    e.interact();
    expect(e.inHammock()).toBe(true);
    expect(e.localPos()).toEqual(HALL_HAMMOCK.use);
    expect(moves.at(-1)).toMatchObject({ hm: 1 });
    step();
    expect(prompts.at(-1)?.prompt).toBe(HAMMOCK_UP_TEXT);
    e.interact();
    expect(e.inHammock()).toBe(false);
    expect(moves.at(-1)).not.toHaveProperty("hm");
    expect(shell).toEqual([]);
  });
  it("a movement key gets me up", () => {
    const { e, step } = setup();
    step();
    e.interact();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowDown" }));
    step();
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowDown" }));
    expect(e.inHammock()).toBe(false);
  });
  it("is refused on a vehicle, and getting on one gets me up", () => {
    const { e, step } = setup();
    e.setRiding("bike");
    step();
    e.interact();
    expect(e.inHammock()).toBe(false);
    e.setRiding(null);
    step();
    e.interact();
    expect(e.inHammock()).toBe(true);
    e.setRiding("bike");
    expect(e.inHammock()).toBe(false);
  });
  it("one at a time: taken while someone else lies in it; a tie goes to the lower id", () => {
    const { e, prompts, step } = setup();
    e.applyMessage(st("dan", 128, 212, { hm: 1 }));
    step();
    expect(prompts.at(-1)?.prompt).toBe(HAMMOCK_TAKEN_TEXT);
    e.interact();
    expect(e.inHammock()).toBe(false);
    e.applyMessage(st("dan", 128, 212));
    step();
    e.interact();
    expect(e.inHammock()).toBe(true);
    // Dan ("dan" < "me") lay down at the same moment: he keeps it
    e.applyMessage(st("dan", 128, 212, { hm: 1 }));
    step();
    expect(e.inHammock()).toBe(false);
  });
  it("…and the lower id stays when the other lies down too", () => {
    const { e, step } = setup("amy");
    step();
    e.interact();
    e.applyMessage(st("dan", 128, 212, { hm: 1 }));
    step();
    expect(e.inHammock()).toBe(true);
  });
});

describe("hammock art", () => {
  it("swings ~2 px with someone in it over HAMMOCK_PERIOD_MS, barely empty, more in the wind, never under reduced motion", () => {
    expect(hammockSwing(HAMMOCK_PERIOD_MS / 4, true, 0, false)).toBeCloseTo(2);
    expect(Math.abs(hammockSwing(HAMMOCK_PERIOD_MS / 4 + HAMMOCK_PERIOD_MS, true, 0, false) - 2)).toBeLessThan(1e-9);
    const calm = Math.max(...Array.from({ length: 50 }, (_, i) => Math.abs(hammockSwing(i * 97, false, 0, false))));
    const storm = Math.max(...Array.from({ length: 50 }, (_, i) => Math.abs(hammockSwing(i * 97, false, 3, false))));
    expect(calm).toBeLessThan(1);
    expect(storm).toBeGreaterThan(calm);
    expect(hammockSwing(700, true, 3, true)).toBe(0);
  });
  it("the fabric's ends stay tied while its middle swings", () => {
    const { x, y, x2 } = { x: 96, y: 202, x2: 160 };
    expect(fabricAt(x, y, x2, x + 10, 2)).toEqual(fabricAt(x, y, x2, x + 10, 0));
    const mid = Math.round((x + 10 + x2 - 8) / 2);
    expect(fabricAt(x, y, x2, mid, 2)!.top - fabricAt(x, y, x2, mid, 0)!.top).toBe(2);
    expect(fabricAt(x, y, x2, x, 0)).toBeNull();
  });
  it("lays a frame on its back, head west, cropped to its pixels", () => {
    // a 3×4 frame: the head pixel at the top (1, 0), the feet at the bottom (0, 3) and (2, 3)
    const W = 3, H = 4, data = new Uint8ClampedArray(W * H * 4);
    for (const [px, py] of [[1, 0], [1, 1], [0, 3], [2, 3]]) data[(py * W + px) * 4 + 3] = 255;
    data[(0 * W + 1) * 4] = 7;                                             // mark the head red = 7
    const frame = { width: W, height: H, getContext: () => ({ getImageData: () => ({ data }) }) } as unknown as HTMLCanvasElement;
    let put: ImageData | null = null;
    const make = (w: number, h: number) => ({
      width: w, height: h,
      getContext: () => ({ createImageData: (a: number, b: number) => ({ width: a, height: b, data: new Uint8ClampedArray(a * b * 4) }), putImageData: (img: ImageData) => { put = img; } }),
    }) as unknown as HTMLCanvasElement;
    const s = lyingSprite(frame, make);
    expect([s.w, s.h]).toEqual([4, 3]);
    const img = put as unknown as ImageData;
    // the head (frame row 0) is the west column, in the middle row
    expect(img.data[(1 * 4 + 0) * 4]).toBe(7);
    expect(img.data[(1 * 4 + 0) * 4 + 3]).toBe(255);
    expect(lyingSprite(frame, make)).toBe(s);
  });
  it("draws the body in the sag and the fabric over it, and the z z once dozing", () => {
    const ops: string[] = [];
    const ctx = new Proxy({}, { get: (_t, k) => (k === "drawImage" ? () => ops.push("body") : k === "fillRect" ? () => ops.push("px") : () => {}), set: () => true }) as unknown as CanvasRenderingContext2D;
    const body = { canvas: {} as HTMLCanvasElement, w: 30, h: 14 };
    drawHammockLive(ctx, 96, 202, 160, 0, 0, 0, null, 0, 0, false);
    expect(ops).not.toContain("body");
    const empty = ops.length;
    ops.length = 0;
    drawHammockLive(ctx, 96, 202, 160, 0, 0, 1, body, 0, 0, false);
    expect(ops.filter((o) => o === "body")).toHaveLength(30);
    expect(ops.lastIndexOf("px")).toBeGreaterThan(ops.lastIndexOf("body"));   // the lip is drawn after the body
    const awake = ops.length;
    ops.length = 0;
    drawHammockLive(ctx, 96, 202, 160, 0, 0, 1, body, HAMMOCK_DOZE_MS, 0, false);
    expect(ops.length).toBeGreaterThan(awake);
    expect(awake).toBeGreaterThan(empty);
  });
});
