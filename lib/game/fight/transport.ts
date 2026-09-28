// v20.3 PvP transport (spec §v20.3 "Realtime budget": the FightTransport seam). Today it is Supabase Broadcast on the
// topic `fight:{roomId}:r{ring}`, which only the two fighters join (plan ruling P25); a WebRTC data channel can replace it
// later with no engine change. Incoming packets are parsed, kept only from the opponent, and budgeted per kind
// (FIGHT_LIMITS). Browser only.

import { supabase, type RealtimeChannel } from "@/lib/supabase";
import { markLeaving, whenTopicFree } from "@/lib/channel-lifecycle";
import { FIGHT_LIMITS, createBudget } from "@/lib/game/net/budget";
import { FIGHT_EVENTS, parseFi, parseFr, parsePing, type FiPacket, type FightEvent, type FrPacket, type PingPacket } from "./packets";

export type FightPacket =
  | ({ t: "fi" } & FiPacket)
  | ({ t: "fp" | "fq" } & PingPacket)
  | ({ t: "fr" } & FrPacket);

export interface FightTransport {
  /** Sends a packet (dropped while the channel is not subscribed: the inputs are resent until acknowledged). */
  send(packet: FightPacket): void;
  /** The opponent's packets, validated and budgeted. */
  onPacket(cb: (packet: FightPacket) => void): void;
  close(): void;
}

export const fightTopic = (roomId: string, ring: number): string => `fight:${roomId}:r${ring}`;

/** Parse one incoming packet of `event`; null when malformed. */
export function parseFightPacket(event: FightEvent, payload: unknown): FightPacket | null {
  if (event === "fi") {
    const p = parseFi(payload);
    return p ? { t: "fi", ...p } : null;
  }
  if (event === "fr") {
    const p = parseFr(payload);
    return p ? { t: "fr", ...p } : null;
  }
  const p = parsePing(payload);
  return p ? { t: event, ...p } : null;
}

/** A filter for the opponent's packets: from `foe` only, within its budget. */
export function packetGate(foe: string): (p: FightPacket, now: number) => boolean {
  const budget = createBudget(FIGHT_LIMITS, 16);
  return (p, now) => p.id === foe && budget.take(p.id, p.t, now);
}

export function broadcastTransport(roomId: string, ring: number, foe: string, onStatus?: (connected: boolean) => void): FightTransport {
  const topic = fightTopic(roomId, ring);
  let channel: RealtimeChannel | null = null;
  let subscribed = false;
  let closed = false;
  let handler: ((p: FightPacket) => void) | null = null;
  const pass = packetGate(foe);
  const joined = whenTopicFree(topic).then(() => {
    if (closed) return;
    const ch = supabase.channel(topic, { config: { broadcast: { self: false } } });
    for (const ev of FIGHT_EVENTS) {
      ch.on("broadcast", { event: ev }, (m: { payload?: unknown }) => {
        const p = parseFightPacket(ev, m.payload);
        if (p && pass(p, performance.now())) handler?.(p);
      });
    }
    channel = ch;
    ch.subscribe((status) => {
      subscribed = status === "SUBSCRIBED";
      onStatus?.(subscribed);
    });
  });
  return {
    send(packet) {
      if (!channel || !subscribed || closed) return;
      const { t, ...payload } = packet;
      channel.send({ type: "broadcast", event: t, payload }).catch(() => {});
    },
    onPacket(cb) {
      handler = cb;
    },
    close() {
      if (closed) return;
      closed = true;
      handler = null;
      markLeaving(topic, joined.then(() => {
        if (!channel) return;
        subscribed = false;
        return supabase.removeChannel(channel);
      }));
    },
  };
}
