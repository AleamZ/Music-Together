import { supabase, type RealtimeChannel } from "@/lib/supabase";

/**
 * The DJ's "lyrics changed" hint: which track and video to refetch from video_lyrics.
 * It carries no lyrics and no offset: anyone holding the public key can broadcast on this topic,
 * so receivers read the database (which only the room's DJ can write) instead of the payload.
 */
export interface LyricHint {
  trackId: string;
  videoId: string;
}

export interface LyricSyncHandle {
  send: (hint: LyricHint) => void;
  unsubscribe: () => void;
}

/** Keeps the hint fields only; anything else in a payload (an older client's lyrics or offset) is dropped. */
function parseHint(raw: unknown): LyricHint | null {
  if (!raw || typeof raw !== "object") return null;
  const { trackId, videoId } = raw as Record<string, unknown>;
  return typeof trackId === "string" && typeof videoId === "string" ? { trackId, videoId } : null;
}

/**
 * Join room-scoped broadcast channel for synchronized lyric changes.
 * self: false ensures the sender does not receive an echo.
 */
export function joinLyricSync(roomId: string, onHint: (hint: LyricHint) => void): LyricSyncHandle {
  const channel: RealtimeChannel = supabase
    .channel(`lyrics:${roomId}`, {
      config: { broadcast: { ack: true, self: false } },
    })
    .on("broadcast", { event: "lyric_change" }, (msg) => {
      const hint = parseHint((msg as { payload?: unknown })?.payload ?? msg);
      if (hint) onHint(hint);
    })
    .subscribe();

  return {
    send: (hint: LyricHint) => {
      const payload: LyricHint = { trackId: hint.trackId, videoId: hint.videoId };
      channel.send({ type: "broadcast", event: "lyric_change", payload }).catch(() => {});
    },
    unsubscribe: () => {
      void supabase.removeChannel(channel);
    },
  };
}
