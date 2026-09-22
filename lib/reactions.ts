import { supabase, type RealtimeChannel } from "@/lib/supabase";

export const REACTION_EMOJIS = ["❤️", "😂", "🔥", "👏", "🎉"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export interface ReactionData {
  emoji: ReactionEmoji;
  username?: string;
}

export interface ReactionsHandle {
  send: (data: ReactionEmoji | ReactionData) => void;
  unsubscribe: () => void;
}

/** Ephemeral floating reactions over a dedicated Broadcast channel (no DB). self:false → no echo. */
export function joinReactions(
  roomId: string,
  onReact: (data: ReactionData) => void,
): ReactionsHandle {
  const channel: RealtimeChannel = supabase
    .channel(`reactions:${roomId}`, {
      config: { broadcast: { ack: true, self: false } },
    })
    .on("broadcast", { event: "react" }, (payload) => {
      const raw = ((payload as any)?.payload ?? payload) as any;
      if (!raw) return;
      if (typeof raw === "string") {
        onReact({ emoji: raw as ReactionEmoji });
      } else {
        const emoji = raw.emoji ?? (payload as any)?.emoji;
        const username = raw.username ?? (payload as any)?.username;
        if (emoji) {
          onReact({
            emoji,
            username: typeof username === "string" && username.trim() ? username.trim() : undefined,
          });
        }
      }
    })
    .subscribe();

  return {
    send: (data) => {
      const payload: ReactionData = typeof data === "string" ? { emoji: data } : data;
      channel.send({ type: "broadcast", event: "react", payload }).catch(() => {});
    },
    unsubscribe: () => {
      void supabase.removeChannel(channel);
    },
  };
}

/** Pure: true if a new send should be dropped (within minGapMs of the last). */
export function throttled(lastAt: number | null, now: number, minGapMs = 250): boolean {
  return lastAt !== null && now - lastAt < minGapMs;
}
