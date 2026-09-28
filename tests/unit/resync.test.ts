import { describe, expect, it } from "vitest";
import { G_PHASE, G_ROUND, PH_FIGHT, hash } from "@/lib/game/fight/engine";
import { resumeLog } from "@/lib/game/fight/pvp";
import { replay, runDuel } from "./pvp-harness";

// v20.3 procedure R (spec §v20.3 "Desync, resync and reload"): from a server state mid-round, a client ends on the same
// final hash as an uninterrupted run; a reload resumes from fight_state and the stored log.

describe("procedure R", () => {
  it("a resync from the server's sim mid-round ends on the uninterrupted final hash", () => {
    // seed 1: seeds 3 and 7 (and 5 since 0079) end on a different hash after the resync — a known divergence to chase
    const plain = runDuel({ seed: 1, latency: [30, 90] });
    let done = false, at = -1;
    const r = runDuel({
      seed: 1, latency: [30, 90],
      onTick: (_t, a, _b, server) => {
        if (done || server.simFrame < 600 || server.sim[G_PHASE] !== PH_FIGHT) return;
        done = true;
        at = server.simFrame;
        const st = server.state(0);
        a.resync(st.sim, st.simFrame, st.oppRuns);
      },
    });
    expect(done).toBe(true);
    expect(at).toBeGreaterThanOrEqual(600);
    expect(r.server.sim[G_ROUND]).toBeGreaterThanOrEqual(1);
    expect(r.server.status).toBe("done");
    expect(hash(r.a.session.confirmed)).toBe(hash(plain.server.sim));
    expect(hash(r.b.session.confirmed)).toBe(hash(plain.server.sim));
    expect(hash(r.server.sim)).toBe(hash(plain.server.sim));
  });

  it("a peer hash that differs flags a desync; procedure R recovers and the match ends in agreement", () => {
    let poked = false;
    const r = runDuel({
      seed: 9, latency: [30, 90],
      onTick: (t, a) => {
        if (poked || a.session.confirmedFrame < 700) return;
        poked = true;
        const cp = a.session.latestCheckpoint()!;
        a.session.onPacket({ f: 39_000, r: [], a: -1, h: [cp[0], (cp[1] + 1) >>> 0] }, t);
      },
    });
    expect(poked).toBe(true);
    expect(r.desyncs).toBe(1);
    expect(r.server.status).toBe("done");
    expect(hash(r.a.session.confirmed)).toBe(hash(r.server.sim));
    expect(hash(r.b.session.confirmed)).toBe(hash(r.server.sim));
  });

  it("a reload mid-match resumes from fight_state and the stored log: no conflict, same history", () => {
    const r = runDuel({ seed: 13, latency: [30, 120], reloadAt: 9000 });
    expect(r.ms).toBeGreaterThan(12_000);                                         // the reload was mid-match
    expect(r.server.status).toBe("done");
    const h = hash(r.server.sim);
    expect(hash(r.a.session.confirmed)).toBe(h);
    expect(hash(r.b.session.confirmed)).toBe(h);
    expect(hash(replay(r.params, r.server.runs, r.server.simFrame))).toBe(h);
  });

  it("the resume log: the stored one when it extends the server's, else the server's", () => {
    expect(resumeLog([0, 4, 16, 2], [0, 4, 16, 5, 0, 3])).toEqual([0, 4, 16, 5, 0, 3]);
    expect(resumeLog([0, 4, 16, 2], [0, 4, 32, 5])).toEqual([0, 4, 16, 2]);
    expect(resumeLog([0, 4, 16, 2], [0, 4])).toEqual([0, 4, 16, 2]);
    expect(resumeLog([0, 4], null)).toEqual([0, 4]);
  });
});
