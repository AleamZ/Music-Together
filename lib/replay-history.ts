import type { PlayHistoryItem } from "@/lib/room-stats";
import type { PlayMode } from "@/lib/supabase";

/**
 * Selects a candidate track from play history to replay when the queue is empty.
 * - Prioritizes tracks with a different video ID from the current track (unless history has no alternatives).
 * - For 'shuffle' mode, picks randomly.
 * - For 'order' mode, picks the least recently played track (oldest played_at).
 */
export function pickReplayCandidate(
  history: PlayHistoryItem[],
  currentVideoId?: string | null,
  playMode: PlayMode = "order",
  randomFn: () => number = Math.random,
): PlayHistoryItem | null {
  if (!history || history.length === 0) return null;

  // 1. Try to exclude the track that just finished (if alternative video IDs exist)
  let eligible = history;
  if (currentVideoId) {
    const alternatives = history.filter((item) => item.youtube_video_id !== currentVideoId);
    if (alternatives.length > 0) {
      eligible = alternatives;
    }
  }

  // 2. Select by mode
  if (playMode === "shuffle") {
    const idx = Math.floor(randomFn() * eligible.length);
    return eligible[idx] ?? null;
  }

  // 'order' mode: least recently played (played_at asc)
  return [...eligible].sort((a, b) => new Date(a.played_at).getTime() - new Date(b.played_at).getTime())[0] ?? null;
}
