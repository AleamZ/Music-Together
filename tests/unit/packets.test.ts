import { describe, expect, it } from "vitest";
import { MAX_LAG, inputDelay, lagFrames, lagRefusal, p90 } from "@/lib/game/fight/net";
import { MAX_PACKET_RUNS, parseFi, parseFr, parsePing } from "@/lib/game/fight/packets";
import { fighterParams, makeParams } from "@/lib/game/fight/engine";
import { RollbackSession } from "@/lib/game/fight/rollback";

const PARAMS = makeParams(fighterParams(3, 2), fighterParams(4, 1), { seed: 7, delay: 3 });

describe("the lag and the input delay (spec §v20.3 'The numbers')", () => {
  it("L and N follow the spec's examples", () => {
    expect(lagFrames(80)).toBe(9);
    expect(inputDelay(lagFrames(80))).toBe(5);
    expect(lagFrames(160)).toBe(11);
    expect(inputDelay(lagFrames(160))).toBe(6);
    expect(inputDelay(lagFrames(0))).toBe(3);
    expect(inputDelay(1)).toBe(2);
    expect(inputDelay(40)).toBe(6);
  });

  it("refuses above L = 18", () => {
    expect(lagFrames(400)).toBe(MAX_LAG);
    expect(lagRefusal(400)).toBeNull();
    expect(lagRefusal(420)).toBe("Mạng hai bên chậm quá để đấu (≈ 420 ms)");
  });

  it("p90 of the samples", () => {
    expect(p90([])).toBe(0);
    expect(p90([50])).toBe(50);
    expect(p90([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])).toBe(90);
    expect(p90([100, 10, 90, 20, 80, 30, 70, 40, 60, 50, 500])).toBe(100);
  });
});

describe("packets on the wire", () => {
  it("parses a valid fi and keeps its hash", () => {
    expect(parseFi({ id: "a", f: 0, r: [0, 3, 16, 2], a: -1 })).toEqual({ id: "a", f: 0, r: [0, 3, 16, 2], a: -1 });
    expect(parseFi({ id: "a", f: 12, r: [], a: 5, h: [60, 4294967295] })).toEqual({ id: "a", f: 12, r: [], a: 5, h: [60, 4294967295] });
  });

  it("drops malformed and oversized fi", () => {
    const bad: unknown[] = [
      null, "x", { f: 0, r: [], a: 0 }, { id: "", f: 0, r: [], a: 0 }, { id: "a", f: -1, r: [], a: 0 },
      { id: "a", f: 0, r: [1], a: 0 }, { id: "a", f: 0, r: [1024, 1], a: 0 }, { id: "a", f: 0, r: [1, 0], a: 0 },
      { id: "a", f: 0, r: [1, 1.5], a: 0 }, { id: "a", f: 0, r: [], a: -2 }, { id: "a", f: 0, r: [], a: 0, h: [1] },
      { id: "a", f: 0, r: [], a: 0, h: [1, -1] }, { id: "a", f: 39_999, r: [0, 5], a: 0 },
      { id: "a", f: 0, r: Array.from({ length: (MAX_PACKET_RUNS + 1) * 2 }, (_, i) => (i % 2 ? 1 : i % 4 ? 1 : 0)), a: 0 },
    ];
    for (const b of bad) expect(parseFi(b), JSON.stringify(b)?.slice(0, 80)).toBeNull();
    const ok = Array.from({ length: MAX_PACKET_RUNS * 2 }, (_, i) => (i % 2 ? 1 : (i / 2) % 2));
    expect(parseFi({ id: "a", f: 0, r: ok, a: 0 })).not.toBeNull();
  });

  it("parses pings and resyncs", () => {
    expect(parsePing({ id: "b", n: 3, ms: 1234.5 })).toEqual({ id: "b", n: 3, ms: 1234.5 });
    expect(parsePing({ id: "b", n: -1, ms: 1 })).toBeNull();
    expect(parsePing({ id: "b", n: 1, ms: "1" })).toBeNull();
    expect(parseFr({ id: "b", f: 600 })).toEqual({ id: "b", f: 600 });
    expect(parseFr({ id: "b", f: 1e9 })).toBeNull();
  });
});

describe("acks, resends, duplicates and order (through the session)", () => {
  const pair = () => [new RollbackSession(PARAMS, 0), new RollbackSession(PARAMS, 1)] as const;

  it("resends everything not acknowledged and moves on once acked", () => {
    const [a, b] = pair();
    a.advanceTo(10, 0, 16);
    const p1 = a.packet(0)!;
    expect(p1.f).toBe(0);
    expect(p1.r.reduce((s, _v, i) => (i % 2 ? s + p1.r[i] : s), 0)).toBe(13);        // frames 0 … 12 (10 + N)
    a.advanceTo(20, 200, 0);
    expect(a.frame).toBe(15);                                                      // W = 12 past the opponent's 3 known frames
    expect(a.stalled).toBe(true);
    const p2 = a.packet(200)!;
    expect(p2.f).toBe(0);                                                          // nothing acked yet: resend all
    b.onPacket(p2, 210);
    expect(b.remoteAck).toBe(17);
    b.advanceTo(5, 210, 0);
    a.onPacket(b.packet(220)!, 230);
    expect(a.acked).toBe(17);
    expect(a.remoteAck).toBe(7);
    a.advanceTo(30, 400, 0);
    expect(a.frame).toBe(20);
    expect(a.packet(400)!.f).toBe(18);
  });

  it("ignores duplicates and a packet that leaves a gap", () => {
    const [a, b] = pair();
    a.advanceTo(10, 0, 16);
    const p = a.packet(0)!;
    b.onPacket(p, 1);
    b.onPacket(p, 2);
    expect(b.remoteAck).toBe(12);
    const gap = { ...p, f: 20, r: [64, 5] };
    b.onPacket(gap, 3);
    expect(b.remoteAck).toBe(12);
    // an overlapping packet that says something else about a known frame changes nothing (first received wins)
    b.onPacket({ ...p, r: [0, 3, 32, 20] }, 4);
    expect(b.remoteAck).toBe(22);
    expect(b.remoteInput(5)).toBe(16);
    expect(b.remoteInput(13)).toBe(32);
  });

  it("paces sends: every 100 ms, early on an attack press after 50 ms, at most 12 a second", () => {
    const [a] = pair();
    a.advanceTo(1, 0, 0);
    expect(a.packet(0)).not.toBeNull();
    a.advanceTo(2, 16, 0);
    expect(a.packet(16)).toBeNull();
    a.advanceTo(3, 33, 16);                                                         // a press, but only 33 ms
    expect(a.packet(33)).toBeNull();
    a.advanceTo(4, 55, 16);
    expect(a.packet(55)).not.toBeNull();                                            // the press, 55 ms after the last
    let n = 0;
    for (let t = 60; t < 1060; t += 5) {
      a.advanceTo(a.frame + 1, t, (t / 5) % 2 ? 16 : 0);
      if (a.packet(t)) n++;
    }
    expect(n).toBeLessThanOrEqual(12);
  });
});

describe("the fight topic's gate", () => {
  it("keeps the opponent's valid packets within budget and drops the rest", async () => {
    const { packetGate, parseFightPacket, fightTopic } = await import("@/lib/game/fight/transport");
    expect(fightTopic("room-1", 3)).toBe("fight:room-1:r3");
    const fi = parseFightPacket("fi", { id: "foe", f: 0, r: [0, 2], a: -1 })!;
    expect(fi).toEqual({ t: "fi", id: "foe", f: 0, r: [0, 2], a: -1 });
    expect(parseFightPacket("fq", { id: "foe", n: 1, ms: 5 })).toEqual({ t: "fq", id: "foe", n: 1, ms: 5 });
    expect(parseFightPacket("fi", { id: "foe", f: 0, r: [0], a: -1 })).toBeNull();
    const pass = packetGate("foe");
    expect(pass({ ...fi, id: "someone" }, 0)).toBe(false);
    expect(Array.from({ length: 25 }, () => pass(fi, 0)).filter(Boolean)).toHaveLength(20);
    const fr = parseFightPacket("fr", { id: "foe", f: 60 })!;
    expect(Array.from({ length: 5 }, () => pass(fr, 0)).filter(Boolean)).toHaveLength(3);
  });
});

describe("the ready screen's ping meter", () => {
  it("sends 10 pings 500 ms apart and takes the p90 of the pongs", async () => {
    const { PingMeter } = await import("@/lib/game/fight/net");
    const m = new PingMeter();
    let t = 0;
    const rtts = [80, 60, 90, 70, 300, 75, 85, 65, 95, 88];
    for (let i = 0; i < 10; i++) {
      const p = m.ping(t)!;
      expect(p.n).toBe(i);
      expect(m.ping(t + 100)).toBeNull();
      m.pong(p.n, t + rtts[i]);
      m.pong(p.n, t + 400);                          // a duplicate pong changes nothing
      t += 500;
    }
    expect(m.ping(t + 1000)).toBeNull();
    expect(m.ready).toBe(true);
    expect(m.samples).toHaveLength(10);
    expect(m.rtt).toBe(95);
    m.reset();
    expect(m.ready).toBe(false);
  });
});