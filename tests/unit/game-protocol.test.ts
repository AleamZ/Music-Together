import { describe, it, expect, vi, afterEach } from "vitest";
import { codeToFacing, createSendGate, facingToCode, parseGameMessage, toPayload, type GameMessage } from "@/lib/game/net/protocol";

const B = { width: 640, height: 400 };
const mv = (x: number): GameMessage => ({ t: "mv", id: "me", x, y: 0, d: "r", mv: true, vx: 1, vy: 0 });

describe("parseGameMessage", () => {
  it("accepts well-formed messages", () => {
    expect(parseGameMessage("hello", { id: "a" }, B)).toEqual({ t: "hello", id: "a" });
    expect(parseGameMessage("mv", { id: "a", x: 1, y: 2, d: "l", mv: true, vx: -1, vy: 0 }, B)?.t).toBe("mv");
    expect(parseGameMessage("pa", { id: "a", x: 1, y: 2, pts: [[3, 4]] }, B)).toEqual({ t: "pa", id: "a", x: 1, y: 2, pts: [[3, 4]] });
  });
  it("rejects malformed or out-of-range messages", () => {
    const bad: Array<[string, unknown]> = [
      ["hello", { id: "" }], ["hello", null], ["nope", { id: "a" }],
      ["mv", { id: "a", x: 1.5, y: 2, d: "l", mv: true, vx: -1, vy: 0 }],
      ["mv", { id: "a", x: 700, y: 2, d: "l", mv: true, vx: -1, vy: 0 }],
      ["mv", { id: "a", x: 1, y: 2, d: "x", mv: true, vx: -1, vy: 0 }],
      ["mv", { id: "a", x: 1, y: 2, d: "l", mv: 1, vx: -1, vy: 0 }],
      ["mv", { id: "a", x: 1, y: 2, d: "l", mv: true, vx: 2, vy: 0 }],
      ["pa", { id: "a", x: 1, y: 2, pts: [] }],
      ["pa", { id: "a", x: 1, y: 2, pts: Array.from({ length: 33 }, () => [1, 1]) }],
      ["pa", { id: "a", x: 1, y: 2, pts: [[3]] }],
    ];
    for (const [event, payload] of bad) expect(parseGameMessage(event, payload, B), `${event} ${JSON.stringify(payload)}`).toBeNull();
  });
  it("accepts fishing state (fs) and the optional hand fish / phase on movement", () => {
    expect(parseGameMessage("fs", { id: "a", f: 1, h: null }, B)).toEqual({ t: "fs", id: "a", f: 1, h: null });
    expect(parseGameMessage("fs", { id: "a", f: 0, h: "ca_loc", c: ["ca_loc", 1200] }, B))
      .toEqual({ t: "fs", id: "a", f: 0, h: "ca_loc", c: ["ca_loc", 1200] });
    // a catch label only comes with f = 0
    expect(parseGameMessage("fs", { id: "a", f: 3, h: null, c: ["ca_loc", 1200] }, B)).toEqual({ t: "fs", id: "a", f: 3, h: null });
    expect(parseGameMessage("st", { id: "a", x: 1, y: 2, d: "u", mv: false, vx: 0, vy: 0, h: "ca_ro", f: 2 }, B))
      .toMatchObject({ t: "st", h: "ca_ro", f: 2 });
    expect(parseGameMessage("mv", { id: "a", x: 1, y: 2, d: "u", mv: true, vx: 0, vy: -1, h: null }, B)).toMatchObject({ t: "mv", h: null });
    expect(parseGameMessage("mv", { id: "a", x: 1, y: 2, d: "u", mv: true, vx: 0, vy: -1 }, B)).not.toHaveProperty("h");
    expect(parseGameMessage("pa", { id: "a", x: 1, y: 2, pts: [[3, 4]], h: "tom_cang" }, B)).toMatchObject({ t: "pa", h: "tom_cang" });
  });
  it("rejects malformed fishing fields", () => {
    const bad: Array<[string, unknown]> = [
      ["fs", { id: "a", f: 4, h: null }], ["fs", { id: "a", f: 1 }], ["fs", { id: "a", f: 1, h: "Cá Lóc" }],
      ["fs", { id: "a", f: 0, h: null, c: ["ca_loc", 0] }], ["fs", { id: "a", f: 0, h: null, c: ["ca_loc", 100_001] }],
      ["fs", { id: "a", f: 0, h: null, c: ["ca_loc", 1.5] }], ["fs", { id: "a", f: 0, h: null, c: ["x-y", 10] }],
      ["st", { id: "a", x: 1, y: 2, d: "u", mv: false, vx: 0, vy: 0, f: 9 }],
      ["mv", { id: "a", x: 1, y: 2, d: "u", mv: false, vx: 0, vy: 0, h: 42 }],
      ["pa", { id: "a", x: 1, y: 2, pts: [[3, 4]], h: "a".repeat(33) }],
    ];
    for (const [event, payload] of bad) expect(parseGameMessage(event, payload, B), `${event} ${JSON.stringify(payload)}`).toBeNull();
  });
  it("round-trips facings and strips the type into the event name", () => {
    expect(codeToFacing(facingToCode("left"))).toBe("left");
    expect(toPayload({ t: "lk", id: "a" })).toEqual({ event: "lk", payload: { id: "a" } });
  });
});

describe("createSendGate", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("sends a burst of 3, then coalesces movement to the latest state", () => {
    vi.useFakeTimers();
    const sent: GameMessage[] = [];
    const gate = createSendGate((m) => sent.push(m));
    for (let i = 1; i <= 5; i++) gate.push(mv(i));
    expect(sent.map((m) => (m as { x: number }).x)).toEqual([1, 2, 3]);
    vi.advanceTimersByTime(200);
    expect(sent).toHaveLength(3);
    vi.advanceTimersByTime(200);
    expect(sent.map((m) => (m as { x: number }).x)).toEqual([1, 2, 3, 5]);
    vi.advanceTimersByTime(2000);
    expect(sent).toHaveLength(4);
    gate.dispose();
  });

  it("queues control messages FIFO and goes silent after dispose", () => {
    vi.useFakeTimers();
    const sent: GameMessage[] = [];
    const gate = createSendGate((m) => sent.push(m));
    gate.push({ t: "hello", id: "me" });
    gate.push({ t: "lk", id: "me" });
    gate.push({ t: "bye", id: "me" });
    gate.push({ t: "lk", id: "me" });
    expect(sent.map((m) => m.t)).toEqual(["hello", "lk", "bye"]);
    vi.advanceTimersByTime(400);
    expect(sent.map((m) => m.t)).toEqual(["hello", "lk", "bye", "lk"]);
    gate.dispose();
    gate.push({ t: "hello", id: "me" });
    vi.advanceTimersByTime(5000);
    expect(sent).toHaveLength(4);
  });

  it("treats fs as a control message: FIFO, never coalesced", () => {
    vi.useFakeTimers();
    const sent: GameMessage[] = [];
    const gate = createSendGate((m) => sent.push(m));
    for (const f of [1, 2, 3, 0] as const) gate.push({ t: "fs", id: "me", f, h: null });
    gate.push(mv(1));
    gate.push(mv(2));
    vi.advanceTimersByTime(3000);
    expect(sent.map((m) => (m.t === "fs" ? `fs${m.f}` : m.t))).toEqual(["fs1", "fs2", "fs3", "fs0", "mv"]);
    gate.dispose();
  });

  it("holds everything while not ready and sends it on kick()", () => {
    vi.useFakeTimers();
    let ready = false;
    const sent: GameMessage[] = [];
    const gate = createSendGate((m) => sent.push(m), { ready: () => ready });
    gate.push({ t: "hello", id: "me" });
    gate.push(mv(1));
    gate.push(mv(2));
    vi.advanceTimersByTime(5000);
    expect(sent).toEqual([]);
    ready = true;
    gate.kick();
    expect(sent.map((m) => m.t)).toEqual(["hello", "mv"]);
    expect((sent[1] as { x: number }).x).toBe(2);
    gate.dispose();
  });

  it("keeps its normal pace after the clock steps back", () => {
    vi.useFakeTimers();
    let clock = 50_000;
    const sent: GameMessage[] = [];
    const gate = createSendGate((m) => sent.push(m), { now: () => clock });
    for (let i = 0; i < 3; i++) gate.push({ t: "lk", id: "me" }); // the burst empties the bucket
    clock -= 10_000; // the system clock jumps back 10 s
    gate.push({ t: "hello", id: "me" });
    clock += 400;
    vi.advanceTimersByTime(400); // one token takes ~334 ms at 3 msgs/s
    expect(sent.map((m) => m.t)).toEqual(["lk", "lk", "lk", "hello"]);
    gate.dispose();
  });
});
