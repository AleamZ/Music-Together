import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export const REACTION_EMOJIS = ["❤️", "😂", "🔥", "👏", "🎉"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export interface ReactionsHandle { send: (emoji: ReactionEmoji) => void; unsubscribe: () => void; }

/** Ephemeral floating reactions over a dedicated Broadcast channel (no DB). self:false → no echo. */
export function joinReactions(roomId: string, onReact: (emoji: ReactionEmoji) => void): ReactionsHandle {
  const channel: RealtimeChannel = supabase
    .channel(`reactions:${roomId}`)
    .on("broadcast", { event: "react" }, (payload) => {
      const emoji = (payload.payload as { emoji?: ReactionEmoji })?.emoji;
      if (emoji) onReact(emoji);
    })
    .subscribe();
  return {
    send: (emoji) => { void channel.send({ type: "broadcast", event: "react", payload: { emoji } }); },
    unsubscribe: () => { void supabase.removeChannel(channel); },
  };
}

/** Pure: true if a new send should be dropped (within minGapMs of the last). */
export function throttled(lastAt: number | null, now: number, minGapMs = 250): boolean {
  return lastAt !== null && now - lastAt < minGapMs;
}
