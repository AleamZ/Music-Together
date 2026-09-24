import { supabase, type RealtimeChannel } from "@/lib/supabase";
import { markLeaving, whenTopicFree } from "@/lib/channel-lifecycle";
import { createSendGate, GAME_EVENTS, parseGameMessage, toPayload, type GameMessage } from "@/lib/game/net/protocol";

export interface GameChannelHandlers {
  onMessage: (msg: GameMessage) => void;
  /** true once subscribed (again, after a reconnect); false on error/close. */
  onStatus: (connected: boolean) => void;
}

export interface GameChannelHandle {
  /** Rate-limited send (3 msgs/s, movement coalesced). Dropped until the channel exists. */
  send(msg: GameMessage): void;
  /** Leave the channel. `last` (usually `bye`) is sent directly, bypassing the gate. */
  leave(last?: GameMessage): void;
}

/** Broadcast channel `game:{roomId}` (spec §8). Browser only. */
export function joinGameChannel(
  roomId: string,
  bounds: { width: number; height: number },
  handlers: GameChannelHandlers,
): GameChannelHandle {
  const topic = `game:${roomId}`;
  let channel: RealtimeChannel | null = null;
  let left = false;
  const post = (msg: GameMessage) => {
    if (!channel) return;
    const { event, payload } = toPayload(msg);
    channel.send({ type: "broadcast", event, payload }).catch(() => {});
  };
  const gate = createSendGate(post);

  const joined = whenTopicFree(topic).then(() => {
    if (left) return;
    const ch = supabase.channel(topic, { config: { broadcast: { self: false } } });
    for (const ev of GAME_EVENTS) {
      ch.on("broadcast", { event: ev }, (m: { payload?: unknown }) => {
        const msg = parseGameMessage(ev, m.payload, bounds);
        if (msg) handlers.onMessage(msg);
      });
    }
    ch.subscribe((status) => handlers.onStatus(status === "SUBSCRIBED"));
    channel = ch;
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
        return supabase.removeChannel(channel);
      }));
    },
  };
}
