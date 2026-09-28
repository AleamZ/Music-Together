import { describe, expect, it } from "vitest";
import { hash, isOver, type State } from "@/lib/game/fight/engine";
import type { FiBody } from "@/lib/game/fight/rollback";
import { SpectatorFeed } from "@/lib/game/fight/spectate";
import { SPECTATE_BUFFER } from "@/lib/game/fight/underground";
import { mulberry, replay, runDuel } from "./pvp-harness";

const encode = (masks: readonly number[]): number[] => {
  const r: number[] = [];
  for (const m of masks) {
    const l = r.length;
    if (l > 0 && r[l - 2] === m) r[l - 1]++;
    else r.push(m, 1);
  }
  return r;
};

// v20.4 spectating the cage (spec §v20.4 "Spectating the cage", plan ruling U13): the spectator hears both fighters'
// `fi` packets receive-only, runs the engine on confirmed inputs only, 30 frames behind, and never rolls back; a late
// joiner starts from fight_state (the server's sim and both runs up to min(frontiers)).
describe("SpectatorFeed", () => {
  function watch(seed: number, joinAt: number, dropEvery: number) {
    const rnd = mulberry(seed * 13);
    const heard: Array<{ at: number; side: 0 | 1; p: FiBody }> = [];
    let feed: SpectatorFeed | null = null;
    let shownMax = -1, rolledBack = false, early = false, last: State | null = null;
    const r = runDuel({
      seed, latency: [30, 140], rounds: 1,
      tap: (t, side, p) => { if (rnd() * dropEvery >= 1) heard.push({ at: t + 60 + Math.floor(rnd() * 90), side, p }); },
      onTick: (t, _a, _b, server) => {
        if (!feed && t >= joinAt) {
          feed = new SpectatorFeed(server.params);
          feed.seed(server.sim, server.simFrame, encode(server.runs[0]), encode(server.runs[1]));
        }
        if (!feed) return;
        for (let i = 0; i < heard.length; i++) {
          if (heard[i].at <= t) { feed.onPacket(heard[i].side, heard[i].p); heard.splice(i--, 1); }
        }
        // the backstop: fight_state every 5 s
        if (t % 5000 === 0) feed.seed(server.sim, server.simFrame, encode(server.runs[0]), encode(server.runs[1]));
        if (t % 16 !== 0) return;
        const s = feed.tick();
        if (s[0] < shownMax) rolledBack = true;
        shownMax = Math.max(shownMax, s[0]);
        if (!isOver(feed.lead) && s[0] > feed.confirmedFrame - SPECTATE_BUFFER) early = true;
        last = s;
      },
    });
    // after the fighters are gone: the spectator plays out to the end
    const f = feed as SpectatorFeed | null;
    expect(f).not.toBeNull();
    f!.seed(r.server.sim, r.server.simFrame, encode(r.server.runs[0]), encode(r.server.runs[1]));
    for (let k = 0; k < 400 && !isOver(f!.tick()); k++) { /* play out */ }
    last = f!.tick();
    return { r, last: last as State, rolledBack, early };
  }

  it("ends on the players' final hash, never shows a frame inside the 30-frame buffer, never rolls back", () => {
    const { r, last, rolledBack, early } = watch(3, 2000, 50);
    const want = replay(r.params, r.server.runs, r.server.simFrame);
    expect(isOver(last)).toBe(true);
    expect(hash(last)).toBe(hash(want));
    expect(rolledBack).toBe(false);
    expect(early).toBe(false);
  }, 60_000);

  it("a late joiner (mid-round) with lost packets catches up from fight_state", () => {
    const { r, last, rolledBack } = watch(7, 10_000, 4);
    expect(hash(last)).toBe(hash(replay(r.params, r.server.runs, r.server.simFrame)));
    expect(rolledBack).toBe(false);
  }, 60_000);

  it("ignores a packet that leaves a gap until the gap is filled", () => {
    const feed = new SpectatorFeed(runDuel({ seed: 1, latency: [10, 10], rounds: 1, maxMs: 1 }).params);
    feed.onPacket(0, { f: 10, r: [16, 5], a: -1 });
    expect(feed.known).toEqual([0, 0]);
    feed.onPacket(0, { f: 0, r: [0, 10], a: -1 });
    feed.onPacket(0, { f: 10, r: [16, 5], a: -1 });
    expect(feed.known).toEqual([15, 0]);
  });
});