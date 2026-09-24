import { supabase, type RealtimeChannel } from "@/lib/supabase";
import { markLeaving, whenTopicFree } from "@/lib/channel-lifecycle";

export const REACTION_EMOJIS = ["❤️", "😂", "🔥", "👏", "🎉"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export interface ReactionData {
  emoji: ReactionEmoji;
  username?: string;
  /** v13: lets game mode float the emoji from the sender's character. Absent from older clients. */
  accountId?: string;
}

export interface ReactionsHandle {
  send: (data: ReactionEmoji | ReactionData) => void;
  unsubscribe: () => void;
}

const isEmoji = (v: unknown): v is ReactionEmoji =>
  typeof v === "string" && (REACTION_EMOJIS as readonly string[]).includes(v);
const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** A broadcast message (or its payload, or a bare emoji string from old clients) → ReactionData; null if unusable. */
export function parseReaction(message: unknown): ReactionData | null {
  const outer = message !== null && typeof message === "object" ? (message as Record<string, unknown>) : null;
  const raw = outer && "payload" in outer ? outer.payload : message;
  if (isEmoji(raw)) return { emoji: raw };
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const emoji = r.emoji ?? outer?.emoji;
  if (!isEmoji(emoji)) return null;
  const data: ReactionData = { emoji };
  const username = text(r.username ?? outer?.username);
  const accountId = text(r.accountId);
  if (username) data.username = username;
  if (accountId) data.accountId = accountId;
  return data;
}

/** Ephemeral floating reactions over a dedicated Broadcast channel (no DB). self:false → no echo. */
export function joinReactions(
  roomId: string,
  onReact: (data: ReactionData) => void,
): ReactionsHandle {
  const topic = `reactions:${roomId}`;
  let channel: RealtimeChannel | null = null;
  let closed = false;
  // classic ↔ game switches unmount one subscriber and mount another in the same commit
  const ready = whenTopicFree(topic).then(() => {
    if (closed) return;
    channel = supabase
      .channel(topic, { config: { broadcast: { ack: true, self: false } } })
      .on("broadcast", { event: "react" }, (message) => {
        const data = parseReaction(message);
        if (data) onReact(data);
      })
      .subscribe();
  });

  return {
    send: (data) => {
      const payload: ReactionData = typeof data === "string" ? { emoji: data } : data;
      // a reaction sent during a classic ↔ game switch waits for the channel instead of being dropped
      void ready.then(() => channel?.send({ type: "broadcast", event: "react", payload }).catch(() => {}));
    },
    unsubscribe: () => {
      closed = true;
      markLeaving(topic, ready.then(() => (channel ? supabase.removeChannel(channel) : undefined)));
    },
  };
}

/** Pure: true if a new send should be dropped (within minGapMs of the last). */
export function throttled(lastAt: number | null, now: number, minGapMs = 250): boolean {
  return lastAt !== null && now - lastAt < minGapMs;
}
