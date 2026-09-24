import { supabase, type RealtimeChannel } from "@/lib/supabase";
import { markLeaving, whenTopicFree } from "@/lib/channel-lifecycle";
import type { GameMap } from "@/lib/game/maps/types";
import { createSendGate, GAME_EVENTS, parseGameMessage, toPayload, type GameMessage } from "@/lib/game/net/protocol";

export interface GameChannelHandlers {
  onMessage: (msg: GameMessage) => void;
  /** true once subscribed (again, after a reconnect); false on error/close. */
  onStatus: (connected: boolean) => void;
}

export interface GameChannelHandle {
  /** Rate-limited send (3 msgs/s, movement coalesced). Waits in the gate until the channel is subscribed. */
  send(msg: GameMessage): void;
  /** Leave the channel. `last` (usually `bye`) is sent directly, bypassing the gate, if the channel is subscribed. */
  leave(last?: GameMessage): void;
}

/** Broadcast channel `game:{roomId}:{mapId}` — one per map (v14 spec §9.1). Browser only. */
export function joinGameChannel(
  roomId: string,
  map: Pick<GameMap, "id" | "width" | "height">,
  handlers: GameChannelHandlers,
): GameChannelHandle {
  const topic = `game:${roomId}:${map.id}`;
  let channel: RealtimeChannel | null = null;
  let subscribed = false;
  let left = false;
  // Only a subscribed channel sends over the socket; before that realtime-js would fall back to REST (with a warning).
  const post = (msg: GameMessage) => {
    if (!channel || !subscribed) return;
    const { event, payload } = toPayload(msg);
    channel.send({ type: "broadcast", event, payload }).catch(() => {});
  };
  const gate = createSendGate(post, { ready: () => subscribed });

  const joined = whenTopicFree(topic).then(() => {
    if (left) return;
    const ch = supabase.channel(topic, { config: { broadcast: { self: false } } });
    for (const ev of GAME_EVENTS) {
      ch.on("broadcast", { event: ev }, (m: { payload?: unknown }) => {
        const msg = parseGameMessage(ev, m.payload, map);
        if (msg) handlers.onMessage(msg);
      });
    }
    channel = ch;
    ch.subscribe((status) => {
      subscribed = status === "SUBSCRIBED";
      handlers.onStatus(subscribed);
      if (subscribed) gate.kick();
    });
  });

  return {
    send: (msg) => gate.push(msg),
    leave: (last) => {
      if (left) return;
      left = true;
      gate.dispose();
      markLeaving(topic, joined.then(() => {
        if (!channel) return;
        if (last) post(last);
        subscribed = false;
        return supabase.removeChannel(channel);
      }));
    },
  };
}
