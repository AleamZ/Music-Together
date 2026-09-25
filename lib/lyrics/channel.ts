import { supabase, type RealtimeChannel } from "@/lib/supabase";

export interface LyricBroadcastPayload {
  trackId: string;
  syncedLyrics?: string;
  plainLyrics?: string;
  trackName?: string;
  artistName?: string;
  appliedByName?: string;
  offsetMs?: number;
  timestamp?: number;
}

export interface LyricSyncHandle {
  send: (payload: LyricBroadcastPayload) => void;
  unsubscribe: () => void;
}

/**
 * Join room-scoped broadcast channel for synchronized lyric changes.
 * self: false ensures the sender does not receive an echo.
 */
export function joinLyricSync(
  roomId: string,
  onLyricChange: (payload: LyricBroadcastPayload) => void
): LyricSyncHandle {
  const channel: RealtimeChannel = supabase
    .channel(`lyrics:${roomId}`, {
      config: { broadcast: { ack: true, self: false } },
    })
    .on("broadcast", { event: "lyric_change" }, (msg) => {
      const raw = ((msg as { payload?: unknown })?.payload ?? msg) as Record<string, unknown>;
      if (!raw || typeof raw.trackId !== "string") return;

      onLyricChange({
        trackId: raw.trackId,
        syncedLyrics: typeof raw.syncedLyrics === "string" ? raw.syncedLyrics : undefined,
        plainLyrics: typeof raw.plainLyrics === "string" ? raw.plainLyrics : undefined,
        trackName: typeof raw.trackName === "string" ? raw.trackName : undefined,
        artistName: typeof raw.artistName === "string" ? raw.artistName : undefined,
        appliedByName: typeof raw.appliedByName === "string" ? raw.appliedByName : undefined,
        offsetMs: typeof raw.offsetMs === "number" ? raw.offsetMs : undefined,
        timestamp: typeof raw.timestamp === "number" ? raw.timestamp : Date.now(),
      });
    })
    .subscribe();

  return {
    send: (data: LyricBroadcastPayload) => {
      const payload: LyricBroadcastPayload = {
        ...data,
        timestamp: Date.now(),
      };
      channel.send({ type: "broadcast", event: "lyric_change", payload }).catch(() => {});
    },
    unsubscribe: () => {
      void supabase.removeChannel(channel);
    },
  };
}
