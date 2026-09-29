import { describe, expect, it, vi } from "vitest";
import type { GameChannelHandlers } from "@/lib/game/net/channel";
import { GridChannels } from "@/lib/game/net/grid-channels";
import type { GameMessage } from "@/lib/game/net/protocol";
import { aggregatePresenceModes, presenceCell } from "@/lib/presence-modes";
import {
  cellAt, cellNeighbourhood, cellStep, cellTopic, cellTopicId, cellZones, CELL_COUNT, CELL_HYSTERESIS, GRID_H, GRID_W,
  plausibleInCell,
} from "@/lib/game/world/grid";

// P4 (spec §4): the AOI grid — cell math, hysteresis, subscribe ordering, the legacy fallback copies, presence `c`.

const mv = (id: string, x: number, y: number): GameMessage => ({ t: "mv", id, x, y, d: "d", mv: true, vx: 0, vy: 1 });

describe("grid cell math", () => {
  it("is 7 × 4 cells of 640 × 560 over the 4160 × 2240 world", () => {
    expect([GRID_W, GRID_H, CELL_COUNT]).toEqual([7, 4, 28]);
    expect(cellAt({ x: 0, y: 0 })).toBe(0);
    expect(cellAt({ x: 639, y: 559 })).toBe(0);
    expect(cellAt({ x: 640, y: 560 })).toBe(8);
    expect(cellAt({ x: 4159, y: 2239 })).toBe(27);
    expect(cellAt({ x: 5000, y: -10 })).toBe(6);                                   // clamped onto the world
    expect(cellTopicId(8)).toBe("c1_1");
    expect(cellTopic("r1", 27)).toBe("game:r1:c6_3");
  });

  it("listens to its own cell first and up to 8 neighbours", () => {
    expect(cellNeighbourhood(0)).toEqual([0, 1, 7, 8]);
    expect(cellNeighbourhood(8)).toEqual([8, 0, 1, 2, 7, 9, 14, 15, 16]);
    for (let c = 0; c < CELL_COUNT; c++) expect(cellNeighbourhood(c).length).toBeLessThanOrEqual(9);
  });

  it("keeps its own cell within the 64 px hysteresis", () => {
    const c = cellStep(null, { x: 600, y: 300 });
    expect(c).toBe(0);
    expect(cellStep(c, { x: 640 + CELL_HYSTERESIS, y: 300 })).toBe(0);           // just across: still mine
    expect(cellStep(c, { x: 640 + CELL_HYSTERESIS + 1, y: 300 })).toBe(1);       // past the band: switch
    expect(cellStep(1, { x: 600, y: 300 })).toBe(1);                               // and back: no flapping
    expect(cellStep(1, { x: 640 - CELL_HYSTERESIS - 1, y: 300 })).toBe(0);
  });

  it("names the zones the listened cells overlap (and the wild)", () => {
    const zs = cellZones(cellNeighbourhood(cellAt({ x: 1200, y: 600 })));
    expect(zs).toContain("hall");
    expect(zs).toContain("wild");
    expect(zs).not.toContain("khu_nha");
  });

  it("finds a move implausible far from its topic's cell", () => {
    expect(plausibleInCell(0, { x: 700, y: 100 })).toBe(true);
    expect(plausibleInCell(0, { x: 1000, y: 100 })).toBe(false);
    expect(plausibleInCell(0, { x: -1, y: 0 })).toBe(false);
  });
});

/** A channel factory that records joins and leaves and lets a test subscribe them. */
function fakeJoin() {
  const log: string[] = [];
  const chans = new Map<string, { h: GameChannelHandlers; sent: GameMessage[]; left: boolean }>();
  const join = (_room: string, map: { id: string }, h: GameChannelHandlers) => {
    log.push(`join ${map.id}`);
    const c = { h, sent: [] as GameMessage[], left: false };
    chans.set(map.id, c);
    return {
      send: (m: GameMessage) => { c.sent.push(m); },
      leave: (last?: GameMessage) => { if (last) c.sent.push(last); c.left = true; log.push(`leave ${map.id}`); },
    };
  };
  return { log, chans, join: join as never };
}

function manualTimers() {
  let t = 0;
  const q: Array<{ at: number; fn: () => void; id: number }> = [];
  let ids = 0;
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => { const id = ++ids; q.push({ at: t + ms, fn, id }); return id; },
    clearTimer: (h: unknown) => { const i = q.findIndex((e) => e.id === h); if (i >= 0) q.splice(i, 1); },
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        q.sort((a, b) => a.at - b.at);
        const e = q[0];
        if (!e || e.at > end) break;
        q.shift();
        t = e.at;
        e.fn();
      }
      t = end;
    },
  };
}

describe("GridChannels", () => {
  it("joins the new cells before it leaves the old ones (once they are subscribed)", () => {
    const f = fakeJoin(), tm = manualTimers();
    const g = new GridChannels("r", { onMessage: () => {}, onStatus: () => {} }, f.join, { zones: false, ...tm });
    g.update({ x: 1000, y: 800 }, "wild");                                         // cell 8
    for (const c of f.chans.values()) c.h.onStatus(true);
    f.log.length = 0;
    const s = g.update({ x: 1930, y: 800 }, "wild");                               // → cell 10 (x 1920..2560)
    expect(s.cellChanged).toBe(true);
    expect(s.cell).toBe(10);
    expect(f.log.every((l) => l.startsWith("join"))).toBe(true);                  // nothing left yet
    expect(g.cells().length).toBeGreaterThan(9);                                   // old + new, for a moment
    for (const c of s.added) f.chans.get(cellTopicId(c))!.h.onStatus(true);
    const firstLeave = f.log.findIndex((l) => l.startsWith("leave"));
    expect(firstLeave).toBeGreaterThan(f.log.findLastIndex((l) => l.startsWith("join")));
    expect(g.cells().length).toBe(9);
    expect(g.cells()[0]).toBe(10);
  });

  it("leaves the old cells after a timeout when a new one never subscribes", () => {
    const f = fakeJoin(), tm = manualTimers();
    const g = new GridChannels("r", { onMessage: () => {}, onStatus: () => {} }, f.join, { zones: false, switchTimeoutMs: 3000, ...tm });
    g.update({ x: 1000, y: 800 }, "wild");
    g.update({ x: 2000, y: 800 }, "wild");
    expect(g.cells().length).toBeGreaterThan(9);
    tm.advance(3000);
    expect(g.cells().length).toBe(9);
  });

  it("keeps a retiring cell that is wanted again, and holds its own cell on a border", () => {
    const f = fakeJoin(), tm = manualTimers();
    const g = new GridChannels("r", { onMessage: () => {}, onStatus: () => {} }, f.join, { zones: false, ...tm });
    g.update({ x: 1000, y: 800 }, "wild");
    const joins = () => f.log.filter((l) => l.startsWith("join")).length;
    const before = joins();
    expect(g.update({ x: 1280 + 20, y: 800 }, "wild").cellChanged).toBe(false);    // inside the band
    g.update({ x: 1280 + 100, y: 800 }, "wild");                                   // switch to 9
    g.update({ x: 1280 - 100, y: 800 }, "wild");                                   // straight back to 8
    expect(g.cell()).toBe(8);
    tm.advance(5000);
    expect(g.cells().sort((a, b) => a - b)).toEqual(cellNeighbourhood(8).sort((a, b) => a - b));
    expect(joins() - before).toBe(3);                                              // only cell 9's new column
  });

  it("broadcasts on its own cell only, with a flagged zone-local copy on the legacy zone topic", () => {
    const f = fakeJoin(), tm = manualTimers();
    const g = new GridChannels("r", { onMessage: () => {}, onStatus: () => {} }, f.join, tm);
    g.update({ x: 1100, y: 600 }, "hall");                                         // cell 8, in the hall
    g.send(mv("me", 1100, 600));
    const own = f.chans.get("c1_1")!;
    own.h.onStatus(true);
    expect(own.sent).toHaveLength(1);
    for (const [id, c] of f.chans) if (id !== "c1_1" && id !== "hall") expect(c.sent).toHaveLength(0);
    const hall = f.chans.get("hall")!.sent;
    expect(hall).toHaveLength(1);
    expect(hall[0]).toMatchObject({ t: "mv", x: 140, y: 120, fb: 1 });              // zone-local
    g.send({ t: "hello", id: "me" });
    expect(f.chans.get("hall")!.sent.at(-1)).toEqual({ t: "hello", id: "me" });   // not a move: as it is, to both
    expect(own.sent.at(-1)).toEqual({ t: "hello", id: "me" });
    // other zone topics my cells overlap are listened to, not sent to
    expect(g.zones()[0]).toBe("hall");
    expect(g.zones().length).toBeGreaterThan(1);
    for (const z of g.zones().slice(1)) expect(f.chans.get(z)!.sent).toHaveLength(0);
  });

  it("sends the zone copy at most 2 a second", () => {
    const f = fakeJoin(), tm = manualTimers();
    const g = new GridChannels("r", { onMessage: () => {}, onStatus: () => {} }, f.join, tm);
    g.update({ x: 1100, y: 600 }, "hall");
    for (let i = 0; i < 30; i++) { g.send(mv("me", 1100, 600 + i)); tm.advance(333); }
    tm.advance(1000);
    expect(f.chans.get("c1_1")!.sent.length).toBe(30);
    const copies = f.chans.get("hall")!.sent.length;
    expect(copies).toBeLessThanOrEqual(22);                                        // ~11 s at 2/s
    expect(copies).toBeGreaterThanOrEqual(18);
  });

  it("dedupes a 3D sender's message heard on a cell and a zone topic", () => {
    const f = fakeJoin(), tm = manualTimers();
    const got: GameMessage[] = [];
    const g = new GridChannels("r", { onMessage: (m) => got.push(m), onStatus: () => {} }, f.join, tm);
    g.update({ x: 1100, y: 600 }, "hall");
    f.chans.get("c1_1")!.h.onMessage({ t: "lk", id: "p" });
    f.chans.get("hall")!.h.onMessage({ t: "lk", id: "p" });
    f.chans.get("hall")!.h.onMessage(mv("p", 10, 20));                              // an older world client's unflagged copy
    expect(got).toEqual([{ t: "lk", id: "p" }]);
    tm.advance(2500);
    f.chans.get("hall")!.h.onMessage({ t: "lk", id: "p" });                        // later: a new one
    expect(got).toHaveLength(2);
  });

  it("from the wild, the copy goes to the nearest zone (the 2D clients see me at its edge)", () => {
    const f = fakeJoin(), tm = manualTimers();
    const g = new GridChannels("r", { onMessage: () => {}, onStatus: () => {} }, f.join, tm);
    g.update({ x: 900, y: 700 }, "wild");
    expect(g.zoneOut()).toBe("hall");
    g.send(mv("me", 900, 700));
    expect(f.chans.get("hall")!.sent[0]).toMatchObject({ fb: 1, x: 0 });
  });

  it("takes in the 2D clients' messages in world px and drops copies and implausible cell moves", () => {
    const f = fakeJoin(), tm = manualTimers();
    const got: GameMessage[] = [];
    const g = new GridChannels("r", { onMessage: (m) => got.push(m), onStatus: () => {} }, f.join, tm);
    g.update({ x: 1100, y: 600 }, "hall");
    f.chans.get("hall")!.h.onMessage(mv("old", 10, 20));
    f.chans.get("hall")!.h.onMessage({ ...mv("world", 10, 20), fb: 1 } as GameMessage);
    f.chans.get("c1_1")!.h.onMessage(mv("peer", 1000, 700));
    f.chans.get("c1_1")!.h.onMessage({ ...mv("copy", 1000, 700), fb: 1 } as GameMessage);
    f.chans.get("c1_1")!.h.onMessage(mv("far", 3000, 2000));
    expect(got.map((m) => m.id)).toEqual(["old", "peer"]);
    expect(got[0]).toMatchObject({ x: 970, y: 500 });
  });

  it("degrades to 2 movement messages a second past 30 visible players", () => {
    const f = fakeJoin(), tm = manualTimers();
    const g = new GridChannels("r", { onMessage: () => {}, onStatus: () => {} }, f.join, { zones: false, ...tm });
    g.update({ x: 1100, y: 600 }, "hall");
    const own = f.chans.get("c1_1")!;
    for (let i = 0; i < 30; i++) { g.send(mv("me", 1100, 600 + i)); tm.advance(100); }
    expect(own.sent.length).toBe(30);                                              // not degraded: the gate's job
    own.sent.length = 0;
    g.setVisible(31);
    for (let i = 0; i < 30; i++) { g.send(mv("me", 1100, 600 + i)); tm.advance(100); }
    tm.advance(1000);
    expect(own.sent.length).toBeLessThanOrEqual(7);                                // 3 s at 2/s (+ the trailing one)
    expect(own.sent.at(-1)).toMatchObject({ y: 629 });                             // the latest wins
    g.send({ t: "hello", id: "me" });
    expect(own.sent.at(-1)).toMatchObject({ t: "hello" });                         // not a move: straight out
  });

  it("sends the bye to its own cell and my send zone on leave", () => {
    const f = fakeJoin(), tm = manualTimers();
    const g = new GridChannels("r", { onMessage: () => {}, onStatus: () => {} }, f.join, tm);
    g.update({ x: 1100, y: 600 }, "hall");
    g.leave({ t: "bye", id: "me" });
    expect(f.chans.get("c1_1")!.sent).toEqual([{ t: "bye", id: "me" }]);
    expect(f.chans.get("hall")!.sent).toEqual([{ t: "bye", id: "me" }]);
    expect(f.chans.get("c0_0")!.sent).toEqual([]);
    expect([...f.chans.values()].every((c) => c.left)).toBe(true);
  });
});

describe("presence cell", () => {
  it("parses `c` as a cell index 0–27 only", () => {
    expect(presenceCell(5)).toEqual({ cell: 5 });
    expect(presenceCell(28)).toEqual({});
    expect(presenceCell("5")).toEqual({});
    expect(presenceCell(1.5)).toEqual({});
  });

  it("carries a world member's cell (and nothing for an older client)", () => {
    const at = new Date().toISOString();
    const out = aggregatePresenceModes({
      a: [{ name: "A", online_at: at, mode: "game", map: "hall", w: 1, c: 9 }],
      b: [{ name: "B", online_at: at, mode: "game", map: "pond" }],
    });
    expect(out[0]).toMatchObject({ map: "wild", cell: 9 });
    expect(out[1].cell).toBeUndefined();
  });
});

describe("presence publishes the cell only with a zone change", () => {
  it("setMap with only a new cell sends nothing", async () => {
    vi.resetModules();
    const track = vi.fn<(p: Record<string, unknown>) => Promise<string>>(async () => "ok");
    let subscribe: ((s: string) => void) | null = null;
    const channel = {
      on() { return channel; },
      subscribe(cb: (s: string) => void) { subscribe = cb; return channel; },
      track,
      presenceState: () => ({}),
    };
    vi.doMock("@/lib/supabase", () => ({ supabase: { channel: () => channel, removeChannel: async () => {} } }));
    vi.useFakeTimers();
    try {
      const { trackPresence } = await import("@/lib/realtime");
      const h = trackPresence("r", { memberId: "m", name: "M", mode: "game", map: "hall" }, () => {});
      subscribe!("SUBSCRIBED");
      await vi.advanceTimersByTimeAsync(100);
      expect(track).toHaveBeenCalledTimes(1);
      h.setMap("hall", undefined, 9);                                              // same zone, a new cell
      await vi.advanceTimersByTimeAsync(40_000);
      expect(track).toHaveBeenCalledTimes(1);
      h.setMap("wild", "hall", 10);                                                // a zone change: the cell goes along
      await vi.advanceTimersByTimeAsync(40_000);
      expect(track).toHaveBeenCalledTimes(2);
      expect(track.mock.calls[1][0]).toMatchObject({ map: "hall", w: 1, c: 10 });
      h.unsubscribe();
    } finally {
      vi.useRealTimers();
      vi.doUnmock("@/lib/supabase");
    }
  });
});
