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
