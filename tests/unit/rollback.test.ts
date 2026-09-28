import { describe, expect, it } from "vitest";
import { G_PHASE, PH_OVER, hash } from "@/lib/game/fight/engine";
import { ROLLBACK_W } from "@/lib/game/fight/net";
import { replay, runDuel } from "./pvp-harness";

// v20.3 (spec §v20.3 "Tests"): two sessions on a fake transport with seeded latency and jitter (20–300 ms) and dropped
// bursts; the confirmed hashes are equal on both ends and equal to the server's replay of both logs.

describe("rollback netcode, two simulated clients", () => {
  it("a good link: both clients and the server's replay agree on every frame to the end", () => {
    const r = runDuel({ seed: 1, latency: [20, 60] });
    expect(r.server.status).toBe("done");
    expect(r.a.session.over && r.b.session.over).toBe(true);
    const n = r.server.simFrame;
    expect(r.a.session.confirmedFrame).toBe(n);
    expect(r.b.session.confirmedFrame).toBe(n);
    const h = hash(r.server.sim);
    expect(hash(r.a.session.confirmed)).toBe(h);
    expect(hash(r.b.session.confirmed)).toBe(h);
    expect(hash(replay(r.params, r.server.runs, n))).toBe(h);
    expect(r.desyncs).toBe(0);
    expect(r.server.mismatches).toEqual([0, 0]);
    expect(r.maxDepth).toBeLessThanOrEqual(ROLLBACK_W);
    expect(r.a.session.stats.rollbacks + r.b.session.stats.rollbacks).toBeGreaterThan(0);
  });

  it("jitter 20–300 ms with reordering and two dropped bursts (reconnects): still one history", () => {
    const r = runDuel({ seed: 7, latency: [20, 300], drops: [[4000, 5200], [9000, 9800]], clockError: [30, -25] });
    expect(r.server.status).toBe("done");
    const h = hash(r.server.sim);
    expect(hash(r.a.session.confirmed)).toBe(h);
    expect(hash(r.b.session.confirmed)).toBe(h);
    expect(hash(replay(r.params, r.server.runs, r.server.simFrame))).toBe(h);
    expect(r.maxDepth).toBeLessThanOrEqual(ROLLBACK_W);
    expect(r.a.session.stats.stallFrames + r.b.session.stats.stallFrames).toBeGreaterThan(0);  // the bursts stall
    expect(r.desyncs).toBe(0);
  });

  it("a slow link (300 ms each way): the depth never passes W; the local sim stalls instead", () => {
    const r = runDuel({ seed: 3, latency: [300, 300], delay: 6, maxMs: 30_000 });
    expect(r.maxDepth).toBeLessThanOrEqual(ROLLBACK_W);
    expect(r.a.session.stats.stallFrames).toBeGreaterThan(0);
    expect(r.b.session.stats.stallFrames).toBeGreaterThan(0);
    // whatever both confirmed agrees
    const f = Math.min(r.a.session.confirmedFrame, r.b.session.confirmedFrame);
    const cp = Math.floor(f / 60) * 60;
    expect(r.a.session.checkpoint(cp)).toBe(r.b.session.checkpoint(cp));
  });

  it("time sync: a client whose clock runs 100 ms fast is held back until both run level", () => {
    const adv: number[] = [];
    const r = runDuel({
      seed: 11, latency: [40, 60], clockError: [100, 0], maxMs: 25_000,
      onTick: (t, a) => { if (t > 15_000 && t % 500 === 0) adv.push(a.session.advantage(t)); },
    });
    expect(r.a.session.stats.slip).toBeGreaterThanOrEqual(3);
    expect(r.b.session.stats.slip).toBe(0);
    expect(Math.max(...adv.map(Math.abs))).toBeLessThanOrEqual(4);
  });

  it("a best-of-3 match on a jittery link ends the same everywhere", () => {
    const r = runDuel({ seed: 21, latency: [30, 180], rounds: 3, delay: 5 });
    expect(r.server.status).toBe("done");
    expect(r.server.sim[G_PHASE]).toBe(PH_OVER);
    expect(hash(r.a.session.confirmed)).toBe(hash(r.server.sim));
    expect(hash(r.b.session.confirmed)).toBe(hash(r.server.sim));
  });
});
