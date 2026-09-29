import type { GameChannelHandle, GameChannelHandlers } from "./channel";
import type { GameMessage } from "./protocol";

// An in-memory realtime for /dev/world-game and the P4 load simulator (tests/unit/world-p4-load.test.ts): topics by
// their "map id" (a zone, or a grid cell's `c{cx}_{cy}`); a send reaches every other listener of that topic, never the
// sender. No network, no parsing. It counts what it carries.

interface Sub extends GameChannelHandlers { topic: string; live: boolean; ready: boolean }

export interface FakeBusOptions {
  /** How a subscription's "SUBSCRIBED" is delayed (default: 40 ms on a window timer). */
  schedule?: (fn: () => void) => unknown;
  cancel?: (h: unknown) => void;
}

export class FakeBus {
  private subs = new Set<Sub>();
  /** Messages handed to a listener, and sends made (a broadcast counts once). */
  deliveries = 0;
  sends = 0;
  private readonly schedule: (fn: () => void) => unknown;
  private readonly cancel: (h: unknown) => void;

  constructor(opts: FakeBusOptions = {}) {
    this.schedule = opts.schedule ?? ((fn) => setTimeout(fn, 40));
    this.cancel = opts.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** A joinGameChannel stand-in. */
  join = (_room: string, map: { id: string; width: number; height: number }, h: GameChannelHandlers): GameChannelHandle => {
    const me: Sub = { ...h, topic: map.id, live: true, ready: false };
    this.subs.add(me);
    // like realtime: nothing arrives before the channel is subscribed
    const t = this.schedule(() => { if (me.live) { me.ready = true; h.onStatus(true); } });
    return {
      send: (msg) => this.deliver(map.id, msg, me),
      leave: (last) => {
        this.cancel(t);
        me.live = false;
        this.subs.delete(me);
        if (last) this.deliver(map.id, last, me);
      },
    };
  };

  /** A broadcast on `topic` from outside (a bot). */
  emit(topic: string, msg: GameMessage): void {
    this.deliver(topic, msg, null);
  }

  /** How many listeners a topic has. */
  listeners(topic: string): number {
    let n = 0;
    for (const s of this.subs) if (s.topic === topic) n++;
    return n;
  }

  private deliver(topic: string, msg: GameMessage, from: Sub | null): void {
    this.sends++;
    for (const s of [...this.subs]) {
      if (s === from || s.topic !== topic || !s.ready) continue;
      this.deliveries++;
      s.onMessage(msg);
    }
  }
}
