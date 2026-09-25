import { describe, it, expect, vi, beforeEach } from "vitest";

// A fake Realtime channel: records the topic, the broadcast handlers, every send() and the removal.
const h = vi.hoisted(() => {
  const state = {
    topics: [] as string[],
    handlers: new Map<string, (m: { payload?: unknown }) => void>(),
    subscribeCb: null as ((s: string) => void) | null,
    sent: [] as Array<{ event: string; payload: Record<string, unknown> }>,
    removed: 0,
  };
  const channel = {
    on(_type: string, filter: { event: string }, cb: (m: { payload?: unknown }) => void) {
      state.handlers.set(filter.event, cb);
      return channel;
    },
    subscribe(cb: (s: string) => void) { state.subscribeCb = cb; return channel; },
    send(msg: { event: string; payload: Record<string, unknown> }) { state.sent.push({ event: msg.event, payload: msg.payload }); return Promise.resolve("ok"); },
  };
  return { state, channel };
});
vi.mock("@/lib/supabase", () => ({
  supabase: {
    channel: (topic: string) => { h.state.topics.push(topic); return h.channel; },
    removeChannel: async () => { h.state.removed++; return "ok"; },
  },
}));

import { joinGameChannel } from "@/lib/game/net/channel";
import type { GameMessage } from "@/lib/game/net/protocol";

const MAP = { id: "pond" as const, width: 640, height: 400 };
const flush = () => new Promise((r) => setTimeout(r, 0));
const mv = (x: number): GameMessage => ({ t: "mv", id: "me", x, y: 10, d: "r", mv: true, vx: 1, vy: 0 });

beforeEach(() => {
  h.state.topics = []; h.state.handlers.clear(); h.state.subscribeCb = null; h.state.sent = []; h.state.removed = 0;
});

describe("joinGameChannel", () => {
  it("joins one topic per room and map", async () => {
    const ch = joinGameChannel("room1", MAP, { onMessage: () => {}, onStatus: () => {} });
    await flush();
    expect(h.state.topics).toEqual(["game:room1:pond"]);
    ch.leave();
    await flush();
  });

  it("holds sends until SUBSCRIBED: control messages in order, movement coalesced to the latest", async () => {
    const status: boolean[] = [];
    const ch = joinGameChannel("room2", MAP, { onMessage: () => {}, onStatus: (c) => status.push(c) });
    ch.send({ t: "hello", id: "me" });
    ch.send(mv(1));
    ch.send({ t: "fs", id: "me", f: 1, h: null });
    ch.send(mv(2));
    await flush();
    expect(h.state.sent).toEqual([]);
    h.state.subscribeCb!("SUBSCRIBED");
    expect(status).toEqual([true]);
    expect(h.state.sent.map((m) => m.event)).toEqual(["hello", "fs", "mv"]);
    expect(h.state.sent[2].payload.x).toBe(2);
    h.state.subscribeCb!("CHANNEL_ERROR");
    ch.send({ t: "lk", id: "me" });
    expect(h.state.sent).toHaveLength(3);
    expect(status).toEqual([true, false]);
    ch.leave();
    await flush();
  });

  it("passes valid broadcasts on and drops malformed ones", async () => {
    const got: GameMessage[] = [];
    const ch = joinGameChannel("room3", MAP, { onMessage: (m) => got.push(m), onStatus: () => {} });
    await flush();
    h.state.handlers.get("fs")!({ payload: { id: "ann", f: 2, h: "ca_ro" } });
    h.state.handlers.get("fs")!({ payload: { id: "ann", f: 7, h: null } });
    h.state.handlers.get("mv")!({ payload: { id: "ann", x: 900, y: 1, d: "l", mv: true, vx: -1, vy: 0 } });
    expect(got).toEqual([{ t: "fs", id: "ann", f: 2, h: "ca_ro" }]);
    ch.leave();
    await flush();
  });

  it("says bye directly on leave, then removes the channel", async () => {
    const ch = joinGameChannel("room4", MAP, { onMessage: () => {}, onStatus: () => {} });
    await flush();
    h.state.subscribeCb!("SUBSCRIBED");
    ch.leave({ t: "bye", id: "me" });
    await flush();
    expect(h.state.sent.map((m) => m.event)).toEqual(["bye"]);
    expect(h.state.removed).toBe(1);
    ch.send({ t: "hello", id: "me" });
    expect(h.state.sent).toHaveLength(1);
  });

  it("never creates the channel when left before the join resolved", async () => {
    const ch = joinGameChannel("room5", MAP, { onMessage: () => {}, onStatus: () => {} });
    ch.leave({ t: "bye", id: "me" });
    await flush();
    expect(h.state.topics).toEqual([]);
    expect(h.state.removed).toBe(0);
  });
});
