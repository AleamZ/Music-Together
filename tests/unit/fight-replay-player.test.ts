import { describe, expect, it } from "vitest";
import { hash, isOver } from "@/lib/game/fight/engine";
import { ReplayPlayer } from "@/lib/game/fight/replay";
import { replay, runDuel } from "./pvp-harness";

// v20.3 admin "Xem lại trận": the player steps both stored logs exactly like the server's replay.

describe("ReplayPlayer", () => {
  const r = runDuel({ seed: 3, latency: [20, 60] });
  const n = r.server.simFrame;
  // the harness server keeps one mask per frame; the stored logs are RLE runs `[mask, count, …]`
  const rle = (masks: readonly number[]): number[] => {
    const out: number[] = [];
    for (const m of masks) {
      if (out.length > 0 && out[out.length - 2] === m) out[out.length - 1]++;
      else out.push(m, 1);
    }
    return out;
  };
  const [runs1, runs2] = [rle(r.server.runs[0]), rle(r.server.runs[1])];

  it("reaches the server's settled state frame for frame", () => {
    const p = new ReplayPlayer(r.params, runs1, runs2, n);
    expect(hash(p.advanceTo(300))).toBe(hash(replay(r.params, r.server.runs, 300)));
    expect(p.at).toBe(300);
    expect(hash(p.advanceTo(n + 1000))).toBe(hash(r.server.sim));
    expect(p.at).toBe(n);
    expect(isOver(p.state)).toBe(true);
    expect(hash(p.seek(120))).toBe(hash(replay(r.params, r.server.runs, 120)));
  });

  it("plays at 60 Hz × speed from the first tick and holds while paused", () => {
    const p = new ReplayPlayer(r.params, runs1, runs2, n);
    p.tick(1000, false);
    p.tick(2000, false);
    expect(p.at).toBe(60);
    p.tick(3000, true);
    p.tick(9000, true);
    expect(p.at).toBe(60);
    p.tick(9000, false);
    p.speed = 2;
    p.tick(9000, false);
    p.tick(10000, false);
    expect(p.at).toBe(180);
  });
});
