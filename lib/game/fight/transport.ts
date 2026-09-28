// v20.3 PvP transport (spec §v20.3 "Realtime budget": the FightTransport seam). Today it is Supabase Broadcast on the
// topic `fight:{roomId}:r{ring}`, which only the two fighters join (plan ruling P25); a WebRTC data channel can replace it
// later with no engine change. Incoming packets are parsed, kept only from the opponent, and budgeted per kind
// (FIGHT_LIMITS). Browser only.

import { supabase, type RealtimeChannel } from "@/lib/supabase";
import { markLeaving, whenTopicFree } from "@/lib/channel-lifecycle";
import { FIGHT_LIMITS, createBudget } from "@/lib/game/net/budget";
import { FIGHT_EVENTS, parseFi, parseFr, parsePing, type FiPacket, type FightEvent, type FrPacket, type PingPacket } from "./packets";
import type { FiBody } from "./rollback";
import { SPECTATOR_CAP } from "./underground";

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
/** v20.4 an underground match's topic (spec §v20.4 'Kèo ngầm'): its id's first 8 hex. */
export const matchTopic = (roomId: string, matchId: string): string => `fight:${roomId}:m${matchId.slice(0, 8)}`;

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
  return topicTransport(fightTopic(roomId, ring), foe, onStatus);
}

/** The transport on any fight topic (a ring's, or an underground match's: v20.4). */
export function topicTransport(topic: string, foe: string, onStatus?: (connected: boolean) => void): FightTransport {
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

/** v20.4 a spectator's side of a match topic (plan ruling U13): receive-only (it sends nothing but its presence), the
 *  two fighters' `fi` packets by side, budgeted per sender. It counts the spectators already there on joining and stays
 *  out (`onFull`) when the soft cap is reached, which keeps the delivery count low. */
export interface SpectatorHandle { close(): void }
export function spectatorTransport(topic: string, me: string, fighters: readonly [string, string], cb: {
  onPacket: (side: 0 | 1, p: FiBody) => void;
  onFull: () => void;
  onStatus?: (connected: boolean) => void;
}): SpectatorHandle {
  let channel: RealtimeChannel | null = null;
  let closed = false;
  let decided = false;
  const gates = [packetGate(fighters[0]), packetGate(fighters[1])] as const;
  const joined = whenTopicFree(topic).then(() => {
    if (closed) return;
    const ch = supabase.channel(topic, { config: { presence: { key: me }, broadcast: { self: false } } });
    ch.on("broadcast", { event: "fi" }, (m: { payload?: unknown }) => {
      const p = parseFightPacket("fi", m.payload);
      if (!p || p.t !== "fi") return;
      const side: 0 | 1 | null = p.id === fighters[0] ? 0 : p.id === fighters[1] ? 1 : null;
      if (side === null || !gates[side](p, performance.now())) return;
      const { id: _id, t: _t, ...body } = p;
      void _id;
      void _t;
      cb.onPacket(side, body);
    });
    ch.on("presence", { event: "sync" }, () => {
      if (decided) return;
      decided = true;
      const others = Object.entries(ch.presenceState<{ spectator?: unknown }>())
        .filter(([id, metas]) => id !== me && (metas ?? []).some((x) => x.spectator === true)).length;
      if (others >= SPECTATOR_CAP) cb.onFull();
      else void ch.track({ spectator: true });
    });
    channel = ch;
    ch.subscribe((status) => cb.onStatus?.(status === "SUBSCRIBED"));
  });
  return {
    close() {
      if (closed) return;
      closed = true;
      markLeaving(topic, joined.then(() => (channel ? supabase.removeChannel(channel) : undefined)));
    },
  };
}