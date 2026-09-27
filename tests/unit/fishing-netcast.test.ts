import { describe, it, expect } from "vitest";
import { drawNetThrow, drawNetThrower, leanFeet, netInFront, netPose } from "@/lib/game/art/netthrow";
import { NET_CANVAS, NET_DOCK, NET_PANEL } from "@/components/game/fishing/NetOverlay";
import {
  aimOffset, decodeNet, encodeNet, facingTowards, NET_CODE, NET_STALE_MS, NET_WON_MS, netAlive, netFrame, nextNet, sceneToOffset,
  type NetShow, type NetState,
} from "@/lib/game/fishing/netcast";
import { NET, SCENE } from "@/lib/game/fishing/net";
import { budgetKind, createBudget, GAME_LIMITS } from "@/lib/game/net/budget";
import { parseGameMessage, toPayload, type GameMessage } from "@/lib/game/net/protocol";
import { RemoteWorld } from "@/lib/game/world";
import type { Facing } from "@/lib/game/types";
import { mapFromAscii } from "./helpers/ascii-map";

const B = { width: 320, height: 160 };
const FACINGS: Facing[] = ["up", "down", "left", "right"];
const SHOWS: NetShow[] = ["aim", "charge", "throw", "sunk", "pull", "won"];

describe("net throw on fs (protocol)", () => {
  it("round-trips an fs with n", () => {
    const msg: GameMessage = { t: "fs", id: "a", f: 0, h: null, n: [3, 10, -40, 18, 0] };
    const { event, payload } = toPayload(msg);
    expect(parseGameMessage(event, { ...payload }, B)).toEqual(msg);
  });

  it("drops malformed throws, a throw with the rod out and a throw with a catch label", () => {
    const bad: unknown[] = [
      [0, 0, 0, 0, 0], [7, 0, 0, 0, 0], [1, 121, 0, 0, 0], [1, 0, -121, 0, 0], [1, 0, 0, 41, 0], [6, 0, 0, 0, 10],
      [1, 0.5, 0, 0, 0], [1, 0, 0, 0], "1,0,0,0,0", null,
    ];
    for (const n of bad) expect(parseGameMessage("fs", { id: "a", f: 0, h: null, n }, B)).toBeNull();
    expect(parseGameMessage("fs", { id: "a", f: 1, h: null, n: [1, 0, 20, 0, 0] }, B)).toBeNull();
    expect(parseGameMessage("fs", { id: "a", f: 0, h: null, c: ["ca_loc", 100], n: [6, 0, 0, 0, 2] }, B)).toBeNull();
  });

  it("encodes and decodes every phase, clamped", () => {
    for (const show of SHOWS) {
      const s: NetState = { show, dx: 200, dy: -300, r: 99, k: 12 };
      const n = encodeNet(s);
      expect(n[0]).toBe(NET_CODE[show]);
      expect(decodeNet(n)).toEqual({ show, dx: 120, dy: -120, r: 40, k: 9 });
      expect(parseGameMessage("fs", { id: "a", f: 0, h: null, n }, B)).not.toBeNull();
    }
  });

  it("stays within the fs budget for a whole throw sent quickly", () => {
    expect(budgetKind("fs")).toBe("fs");
    const b = createBudget(GAME_LIMITS);
    // aim, charge, throw at once (a quick tap), then sunk after the flight, pull after the sink, the catch + won, clear
    const at = [0, 150, 300, 1000, 2600, 9000, 9001, 11000];
    for (const t of at) expect(b.take("a", "fs", t)).toBe(true);
  });
});

describe("net throw geometry", () => {
  it("throws forward for every facing, the side axis following the thrower's right", () => {
    const far = { x: SCENE.hands.x, y: 10 };
    expect(sceneToOffset(far, "up").y).toBeLessThan(-44);
    expect(sceneToOffset(far, "down").y).toBeGreaterThan(20);
    expect(sceneToOffset(far, "left").x).toBeLessThan(-22);
    expect(sceneToOffset(far, "right").x).toBeGreaterThan(22);
    const right = { x: SCENE.hands.x + 40, y: 40 };
    expect(sceneToOffset(right, "up").x).toBeGreaterThan(0);
    expect(sceneToOffset(right, "down").x).toBeLessThan(0);
    expect(sceneToOffset(right, "left").y).toBeLessThan(0);
    expect(sceneToOffset(right, "right").y).toBeGreaterThan(0);
    for (const f of FACINGS) {
      const o = sceneToOffset({ x: 0, y: 0 }, f);
      expect(Math.abs(o.x)).toBeLessThanOrEqual(120);
      expect(Math.abs(o.y)).toBeLessThanOrEqual(120);
    }
  });

  it("faces the water", () => {
    expect(facingTowards({ x: 0, y: 0 }, { x: 5, y: -30 })).toBe("up");
    expect(facingTowards({ x: 0, y: 0 }, { x: -30, y: 5 })).toBe("left");
    expect(facingTowards({ x: 0, y: 0 }, { x: 30, y: 5 })).toBe("right");
    expect(facingTowards({ x: 0, y: 0 }, { x: 0, y: 30 })).toBe("down");
  });
});

describe("net throw phases", () => {
  it("aims straight ahead, the throw sets the target and later phases keep it", () => {
    let s = nextNet(null, { show: "aim" }, "down");
    expect({ x: s.dx, y: s.dy }).toEqual(aimOffset("down"));
    s = nextNet(s, { show: "charge" }, "down");
    expect(s.show).toBe("charge");
    s = nextNet(s, { show: "throw", scene: { x: 100, y: 20 }, sceneR: 18 }, "down");
    const target = { dx: s.dx, dy: s.dy, r: s.r };
    expect(target.r).toBeGreaterThan(0);
    for (const show of ["sunk", "pull"] as const) {
      s = nextNet(s, { show }, "down");
      expect({ dx: s.dx, dy: s.dy, r: s.r }).toEqual(target);
    }
    s = nextNet(s, { show: "won", k: 3 }, "down");
    expect(s.k).toBe(3);
  });

  it("animates from the phase's own clock", () => {
    expect(netFrame("throw", 0, false).flight).toBe(0);
    expect(netFrame("throw", NET.flightMs / 2, false).flight).toBeCloseTo(0.5);
    expect(netFrame("throw", NET.flightMs * 3, false).flight).toBe(1);
    expect(netFrame("pull", 0, false).drawn).toBe(0);
    expect(netFrame("pull", 60_000, false).drawn).toBeLessThanOrEqual(0.7);
    expect(netFrame("pull", 3000, false).lean).toBeGreaterThan(0);
    expect(netFrame("aim", 3000, false).lean).toBe(0);
    expect(netAlive("won", NET_WON_MS - 1)).toBe(true);
    expect(netAlive("won", NET_WON_MS)).toBe(false);
    expect(netAlive("sunk", NET_STALE_MS - 1)).toBe(true);
    expect(netAlive("sunk", NET_STALE_MS)).toBe(false);
  });

  it("the others see each phase, restart its clock only on a change, and lose it on an fs without n", () => {
    const w = new RemoteWorld(mapFromAscii(Array(20).fill(".".repeat(40))), "me");
    const fs = (n?: [1 | 2 | 3 | 4 | 5 | 6, number, number, number, number]): GameMessage =>
      n ? { t: "fs", id: "b", f: 0, h: null, n } : { t: "fs", id: "b", f: 0, h: null };
    expect(w.net("b", 0)).toBeNull();
    w.applyMessage(fs([1, 0, 30, 0, 0]), 100);
    expect(w.net("b", 150)).toEqual({ s: { show: "aim", dx: 0, dy: 30, r: 0, k: 0 }, since: 50 });
    w.applyMessage(fs([3, 0, 50, 16, 0]), 200);
    w.applyMessage(fs([3, 0, 50, 16, 0]), 400);                         // a repeat keeps the clock
    expect(w.net("b", 500)?.since).toBe(300);
    w.applyMessage(fs([6, 0, 50, 16, 2]), 1000);
    expect(w.net("b", 1000 + NET_WON_MS - 1)?.s.k).toBe(2);
    expect(w.net("b", 1000 + NET_WON_MS)).toBeNull();
    w.applyMessage(fs([4, 0, 50, 16, 0]), 5000);
    w.applyMessage(fs(), 5100);                                        // Esc / lost / done
    expect(w.net("b", 5100)).toBeNull();
    w.applyMessage(fs([5, 0, 50, 16, 0]), 6000);
    w.remove("b");
    expect(w.net("b", 6000)).toBeNull();
  });
});

describe("net throw art", () => {
  const counter = () => {
    const pts: Array<[number, number]> = [];
    return { pts, ctx: { fillStyle: "", fillRect: (x: number, y: number) => { pts.push([x, y]); } } };
  };

  it("draws every phase for every facing, near the thrower", () => {
    for (const f of FACINGS) for (const show of SHOWS) {
      const s = nextNet(nextNet(null, { show: "aim" }, f), { show, scene: { x: 90, y: 30 }, sceneR: 18, k: 3 }, f);
      const { pts, ctx } = counter();
      drawNetThrow(ctx, { x: 200, y: 200 }, f, s, 800, 1234, false);
      expect(pts.length, `${show} ${f}`).toBeGreaterThan(5);
      for (const [x, y] of pts) {
        expect(Math.abs(x - 200)).toBeLessThanOrEqual(170);
        expect(Math.abs(y - 200)).toBeLessThanOrEqual(170);
      }
    }
  });

  it("is still under reduced motion", () => {
    const s: NetState = { show: "sunk", dx: 0, dy: 40, r: 16, k: 0 };
    const a = counter(), b = counter();
    drawNetThrow(a.ctx, { x: 100, y: 100 }, "down", s, 500, 1000, true);
    drawNetThrow(b.ctx, { x: 100, y: 100 }, "down", s, 900, 5000, true);
    expect(a.pts).toEqual(b.pts);
  });

  it("is hidden behind the body facing away except the bundle held up, and leans back while pulling", () => {
    const s = (show: NetShow): NetState => ({ show, dx: 0, dy: -60, r: 16, k: 2 });
    expect(netInFront("up", s("sunk"))).toBe(false);
    expect(netInFront("up", s("won"))).toBe(true);
    for (const f of ["down", "left", "right"] as const) expect(netInFront(f, s("pull"))).toBe(true);
    expect(leanFeet({ x: 0, y: 0 }, "down", s("pull"), 1000, false).y).toBeLessThan(0);
    expect(leanFeet({ x: 0, y: 0 }, "right", s("pull"), 1000, false).x).toBeLessThan(0);
    expect(leanFeet({ x: 0, y: 0 }, "down", s("sunk"), 1000, false)).toEqual({ x: 0, y: 0 });
  });
});

describe("net throw v2: the thrower and the docked overlay", () => {
  const recorder = () => {
    const ops: string[] = [];
    const ctx = {
      fillStyle: "",
      fillRect: (x: number, y: number, w: number, h: number) => { ops.push(`r${x},${y},${w},${h}`); },
      drawImage: (...a: unknown[]) => { ops.push(`i${a.slice(1).join(",")}`); },
    };
    return { ops, ctx: ctx as unknown as CanvasRenderingContext2D };
  };
  const frame = {} as HTMLCanvasElement;
  const S = (show: NetShow, dy = 50): NetState => ({ show, dx: 0, dy, r: 18, k: 4 });

  it("draws the body (sliced) and the net for every phase and facing", () => {
    for (const f of FACINGS) for (const show of SHOWS) {
      const { ops, ctx } = recorder();
      drawNetThrower(ctx, { x: 200, y: 200 }, f, frame, "warm", S(show, f === "up" ? -60 : 50), 400, 2000, false);
      expect(ops.filter((o) => o.startsWith("i")).length, `${show} ${f}`).toBe(3);
      expect(ops.filter((o) => o.startsWith("r")).length, `${show} ${f}`).toBeGreaterThan(40);
    }
  });

  it("puts the net behind the body facing up, except the lifted bag", () => {
    const firstImage = (show: NetShow) => {
      const { ops, ctx } = recorder();
      drawNetThrower(ctx, { x: 200, y: 200 }, "up", frame, "warm", S(show, -60), 400, 2000, false);
      return ops.findIndex((o) => o.startsWith("i"));
    };
    expect(firstImage("sunk")).toBeGreaterThan(20);
    expect(firstImage("won")).toBeLessThan(firstImage("sunk"));
  });

  it("winds the net hand back, follows through, alternates hands pulling and lifts the bag", () => {
    const feet = { x: 100, y: 100 };
    const aim = netPose(feet, "right", S("aim"), 0, 0, false);
    const wound = netPose(feet, "right", S("charge"), NET.periodMs / 2, 0, false);
    expect(wound.n.x).toBeLessThan(aim.n.x);
    expect(wound.n.y).toBeLessThan(aim.n.y);
    expect(wound.shift.x).toBeLessThan(0);
    const out = netPose(feet, "right", S("throw"), 400, 0, false);
    expect(out.n.x).toBeGreaterThan(aim.n.x);
    const p1 = netPose(feet, "right", S("pull"), 1000, 0, false), p2 = netPose(feet, "right", S("pull"), 1000, 350, false);
    expect(p1.n.x).toBeGreaterThan(p1.o.x);
    expect(p2.n.x).toBeLessThan(p2.o.x);
    expect(netPose(feet, "down", S("won"), 100, 0, false).n.y).toBeLessThan(feet.y - 36);
  });

  it("holds still key frames under reduced motion", () => {
    for (const show of SHOWS) {
      const a = recorder(), b = recorder();
      drawNetThrower(a.ctx, { x: 100, y: 100 }, "down", frame, "tan", S(show), show === "throw" ? 100 : 500, 1000, true);
      drawNetThrower(b.ctx, { x: 100, y: 100 }, "down", frame, "tan", S(show), show === "throw" ? 200 : 900, 7777, true);
      if (show !== "pull") expect(a.ops, show).toEqual(b.ops);
    }
  });

  it("docks the minigame to the side without a backdrop over the world", () => {
    expect(NET_DOCK).toContain("pointer-events-none");
    expect(NET_DOCK).toContain("bottom-0");
    expect(NET_DOCK).toContain("h-[45vh]");
    expect(NET_DOCK).toContain("sm:right-0");
    expect(NET_DOCK).toContain("sm:w-[420px]");
    expect(NET_DOCK).not.toMatch(/(^|\s)inset-0(\s|$)/);
    expect(NET_DOCK).not.toMatch(/(^|\s)bg-black\//);
    expect(NET_PANEL).toContain("pointer-events-auto");
    expect(NET_CANVAS).toContain("max-sm:max-w-");
  });
});