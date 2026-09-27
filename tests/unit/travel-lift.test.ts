import { describe, expect, it } from "vitest";
import { budgetKind, createBudget, GAME_LIMITS } from "@/lib/game/net/budget";
import { GAME_EVENTS, parseGameMessage, type LiftMessage } from "@/lib/game/net/protocol";
import {
  dropSpot, LIFT_ASK_MS, LIFT_IDLE, LIFT_LOST_MS, LIFT_SYNC_MS, liftNoteText, liftReduce, liftSound, type LiftModel,
} from "@/lib/game/travel/lift";

const B = { width: 640, height: 400 };
const mv = { x: 10, y: 10, d: "d", mv: false, vx: 0, vy: 0 };

describe("lift wire (v18.13)", () => {
  it("carries ps / lf on movement, one of them, never my own id", () => {
    expect(parseGameMessage("mv", { id: "a", ...mv, ps: "b" }, B)).toMatchObject({ ps: "b" });
    expect(parseGameMessage("st", { id: "a", ...mv, lf: "b" }, B)).toMatchObject({ lf: "b" });
    expect(parseGameMessage("pa", { id: "a", x: 1, y: 1, pts: [[2, 2]], lf: "b" }, B)).toMatchObject({ lf: "b" });
    const both = parseGameMessage("mv", { id: "a", ...mv, ps: "b", lf: "c" }, B)!;
    expect(both).toMatchObject({ ps: "b" });
    expect(both).not.toHaveProperty("lf");
    for (const bad of [{ ps: "a" }, { ps: 3 }, { lf: "" }, { lf: "x".repeat(65) }]) {
      const m = parseGameMessage("mv", { id: "a", ...mv, ...bad }, B)!;
      expect(m).not.toHaveProperty("ps");
      expect(m).not.toHaveProperty("lf");
    }
  });
  it("parses rq / ra / rx / lg and drops malformed ones", () => {
    expect(GAME_EVENTS).toEqual(expect.arrayContaining(["rq", "ra", "rx", "lg"]));
    expect(parseGameMessage("rq", { id: "a", to: "b" }, B)).toEqual({ t: "rq", id: "a", to: "b" });
    expect(parseGameMessage("rx", { id: "a", to: "b" }, B)).toEqual({ t: "rx", id: "a", to: "b" });
    expect(parseGameMessage("ra", { id: "a", to: "b", ok: true, v: "moto" }, B)).toEqual({ t: "ra", id: "a", to: "b", ok: true, v: "moto" });
    // a yes without a known vehicle reads as a no
    expect(parseGameMessage("ra", { id: "a", to: "b", ok: true, v: "tank" }, B)).toEqual({ t: "ra", id: "a", to: "b", ok: false });
    expect(parseGameMessage("lg", { id: "a", to: "b", m: "market" }, B)).toEqual({ t: "lg", id: "a", to: "b", m: "market" });
    expect(parseGameMessage("lg", { id: "a", to: "b", m: "moon" }, B)).toBeNull();
    expect(parseGameMessage("rq", { id: "a" }, B)).toBeNull();
    expect(parseGameMessage("ra", { id: "a", to: "b" }, B)).toBeNull();
  });
  it("counts them against one lift budget (1 a second, burst 4)", () => {
    for (const t of ["rq", "ra", "rx", "lg"] as const) expect(budgetKind(t)).toBe("lift");
    const b = createBudget(GAME_LIMITS);
    const ok = [0, 0, 0, 0, 0].map(() => b.take("a", "lift", 0));
    expect(ok).toEqual([true, true, true, true, false]);
    expect(b.take("a", "lift", 1000)).toBe(true);
  });
});

const msg = (m: LiftMessage, o: Partial<{ now: number; riding: "bike" | "moto" | "car" | null; free: boolean; near: boolean }> = {}) =>
  ({ e: "msg" as const, msg: m, now: o.now ?? 0, riding: o.riding === undefined ? "moto" : o.riding, free: o.free ?? true, near: o.near ?? true });

describe("liftReduce: asking", () => {
  it("asks once, waits, and lapses after LIFT_ASK_MS", () => {
    const a = liftReduce(LIFT_IDLE, { e: "ask", driver: "d", now: 100 });
    expect(a.send).toEqual([{ t: "rq", to: "d" }]);
    expect(a.model.state).toEqual({ kind: "asking", driver: "d", until: 100 + LIFT_ASK_MS });
    expect(liftReduce(a.model, { e: "ask", driver: "e", now: 200 }).send).toEqual([]);
    expect(liftReduce(a.model, { e: "tick", now: 100 + LIFT_ASK_MS - 1 }).model).toBe(a.model);
    const t = liftReduce(a.model, { e: "tick", now: 100 + LIFT_ASK_MS });
    expect(t.model.state).toEqual({ kind: "none" });
    expect(t.note).toEqual({ kind: "expired", who: "d" });
  });
  it("gets on with a yes, stays on foot with a no, and takes back a late yes", () => {
    const a = liftReduce(LIFT_IDLE, { e: "ask", driver: "d", now: 0 }).model;
    const yes = liftReduce(a, msg({ t: "ra", id: "d", to: "me", ok: true, v: "bike" }));
    expect(yes.model.state).toEqual({ kind: "passenger", driver: "d", v: "bike" });
    expect(yes.note).toEqual({ kind: "accepted", who: "d" });
    const no = liftReduce(a, msg({ t: "ra", id: "d", to: "me", ok: false }));
    expect(no.model.state).toEqual({ kind: "none" });
    expect(no.note?.kind).toBe("declined");
    // someone else's answer is not mine to take
    expect(liftReduce(a, msg({ t: "ra", id: "x", to: "me", ok: true, v: "car" })).send).toEqual([{ t: "rx", to: "x" }]);
    expect(liftReduce(LIFT_IDLE, msg({ t: "ra", id: "d", to: "me", ok: true, v: "car" })).send).toEqual([{ t: "rx", to: "d" }]);
  });
});

describe("liftReduce: the driver", () => {
  const offered = liftReduce(LIFT_IDLE, msg({ t: "rq", id: "p", to: "me" }, { now: 50 })).model;
  it("shows one request, accepts it with the vehicle, and declines the rest", () => {
    expect(offered.offer).toEqual({ from: "p", until: 50 + LIFT_ASK_MS });
    expect(liftReduce(offered, msg({ t: "rq", id: "q", to: "me" })).send).toEqual([{ t: "ra", to: "q", ok: false }]);
    const acc = liftReduce(offered, { e: "accept", riding: "moto" });
    expect(acc.model).toEqual({ state: { kind: "driver", passenger: "p" }, offer: null });
    expect(acc.send).toEqual([{ t: "ra", to: "p", ok: true, v: "moto" }]);
    // a carrying driver declines at once
    expect(liftReduce(acc.model, msg({ t: "rq", id: "q", to: "me" })).send).toEqual([{ t: "ra", to: "q", ok: false }]);
  });
  it("declines while on foot, busy, far away, or on someone else's vehicle", () => {
    for (const o of [{ riding: null }, { free: false }, { near: false }] as const) {
      const r = liftReduce(LIFT_IDLE, msg({ t: "rq", id: "p", to: "me" }, o));
      expect(r.send).toEqual([{ t: "ra", to: "p", ok: false }]);
      expect(r.model.offer).toBeNull();
    }
    const riding: LiftModel = { state: { kind: "passenger", driver: "d", v: "car" }, offer: null };
    expect(liftReduce(riding, msg({ t: "rq", id: "p", to: "me" })).send).toEqual([{ t: "ra", to: "p", ok: false }]);
  });
  it("declines a request that lapsed, or an accept after I got off", () => {
    const t = liftReduce(offered, { e: "tick", now: 50 + LIFT_ASK_MS });
    expect(t.model.offer).toBeNull();
    expect(t.send).toEqual([{ t: "ra", to: "p", ok: false }]);
    expect(liftReduce(offered, { e: "accept", riding: null }).send).toEqual([{ t: "ra", to: "p", ok: false }]);
    expect(liftReduce(offered, { e: "decline" }).send).toEqual([{ t: "ra", to: "p", ok: false }]);
    // the asker gave up
    expect(liftReduce(offered, msg({ t: "rx", id: "p", to: "me" })).model.offer).toBeNull();
  });
});

describe("liftReduce: ending and portals", () => {
  const driving: LiftModel = { state: { kind: "driver", passenger: "p" }, offer: null };
  const riding: LiftModel = { state: { kind: "passenger", driver: "d", v: "moto" }, offer: null };
  it("either side ends it, and the other hears it", () => {
    expect(liftReduce(riding, { e: "leave" })).toMatchObject({ model: LIFT_IDLE, send: [{ t: "rx", to: "d" }] });
    expect(liftReduce(driving, { e: "drop" })).toMatchObject({ model: LIFT_IDLE, send: [{ t: "rx", to: "p" }] });
    expect(liftReduce(driving, { e: "dismounted" })).toMatchObject({ model: LIFT_IDLE, send: [{ t: "rx", to: "p" }] });
    expect(liftReduce(riding, msg({ t: "rx", id: "d", to: "me" }))).toMatchObject({ model: LIFT_IDLE, note: { kind: "dropped", who: "d" } });
    expect(liftReduce(driving, msg({ t: "rx", id: "p", to: "me" }))).toMatchObject({ model: LIFT_IDLE, note: { kind: "left", who: "p" } });
    expect(liftReduce(riding, msg({ t: "rx", id: "x", to: "me" })).model).toBe(riding);
    expect(liftReduce(riding, { e: "lost" })).toMatchObject({ model: LIFT_IDLE, note: { kind: "lost", who: "d" } });
    expect(liftReduce(driving, { e: "lost" }).send).toEqual([{ t: "rx", to: "p" }]);
  });
  it("the driver's portal takes the passenger along; nobody else's does", () => {
    expect(liftReduce(driving, { e: "portal", m: "market" }).send).toEqual([{ t: "lg", to: "p", m: "market" }]);
    expect(liftReduce(LIFT_IDLE, { e: "portal", m: "market" }).send).toEqual([]);
    expect(liftReduce(riding, msg({ t: "lg", id: "d", to: "me", m: "pond" })).follow).toBe("pond");
    expect(liftReduce(riding, msg({ t: "lg", id: "x", to: "me", m: "pond" })).follow).toBeUndefined();
  });
});

describe("dropSpot / liftSound / texts", () => {
  it("sets the passenger down beside, else behind, else in place", () => {
    const open = () => false;
    expect(dropSpot(open, { x: 100, y: 100 }, "right")).toEqual({ x: 100, y: 110 });
    expect(dropSpot(open, { x: 100, y: 100 }, "down")).toEqual({ x: 86, y: 100 });
    expect(dropSpot((x) => x !== 100 + 20, { x: 100, y: 100 }, "left")).toEqual({ x: 120, y: 100 });
    expect(dropSpot(() => true, { x: 100.4, y: 99.6 }, "up")).toEqual({ x: 100, y: 100 });
  });
  it("ends a lift whose partner is gone or disagrees after the sync window", () => {
    const base = { now: 10_000, since: 0, seenAt: 10_000, seen: true, agrees: true };
    expect(liftSound(base)).toBe(true);
    expect(liftSound({ ...base, agrees: false })).toBe(false);
    expect(liftSound({ ...base, agrees: false, since: base.now - LIFT_SYNC_MS })).toBe(true);
    expect(liftSound({ ...base, seen: false, seenAt: base.now - LIFT_LOST_MS })).toBe(true);
    expect(liftSound({ ...base, seen: false, seenAt: base.now - LIFT_LOST_MS - 1 })).toBe(false);
  });
  it("names the partner in the toasts", () => {
    expect(liftNoteText("accepted", "Lan")).toContain("Lan");
    expect(liftNoteText("lost", "Lan")).toContain("Lan");
  });
});
