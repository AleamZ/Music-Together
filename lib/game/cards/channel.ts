import { markLeaving, whenTopicFree } from "@/lib/channel-lifecycle";
import { supabase, type RealtimeChannel } from "@/lib/supabase";
import type { CardGame } from "./deck";

// The card table's broadcast channel (spec §12): `cards:{roomId}:{game}`, one hint `cv {id, v}` — "the table changed,
// version v" — sent once by the client whose RPC changed it. A hint carries no state: receivers fetch card_state.
// Browser only.

/** A hint: who changed the table, and its version after the change. */
export interface CardHint { id: string; v: number }

/** A `cv` payload, or null for anything else. */
export function parseCardHint(payload: unknown): CardHint | null {
  const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  const id = p?.id, v = p?.v;
  return typeof id === "string" && id.length > 0 && id.length <= 64 && typeof v === "number" && Number.isInteger(v) && v >= 0
    ? { id, v } : null;
}

export interface CardChannelHandle {
  /** Send a hint once the channel is subscribed (dropped before: the others poll). */
  send(h: CardHint): void;
  leave(): void;
}

export function cardTopic(roomId: string, game: CardGame): string {
  return `cards:${roomId}:${game}`;
}

export function joinCardChannel(roomId: string, game: CardGame, onHint: (h: CardHint) => void): CardChannelHandle {
  const topic = cardTopic(roomId, game);
  let channel: RealtimeChannel | null = null;
  let subscribed = false;
  let left = false;
  const joined = whenTopicFree(topic).then(() => {
    if (left) return;
    const ch = supabase.channel(topic, { config: { broadcast: { self: false } } });
    ch.on("broadcast", { event: "cv" }, (m: { payload?: unknown }) => {
      const h = parseCardHint(m.payload);
      if (h) onHint(h);
    });
    channel = ch;
    ch.subscribe((status) => {
      subscribed = status === "SUBSCRIBED";
    });
  });
  return {
    send: (h) => {
      if (channel && subscribed) channel.send({ type: "broadcast", event: "cv", payload: { id: h.id, v: h.v } }).catch(() => {});
    },
    leave: () => {
      if (left) return;
      left = true;
      markLeaving(topic, joined.then(() => {
        if (!channel) return;
        subscribed = false;
        return supabase.removeChannel(channel);
      }));
    },
  };
}
