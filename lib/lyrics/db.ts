import { supabase } from "@/lib/supabase";

export interface VideoLyricsRecord {
  youtube_video_id: string;
  track_name?: string | null;
  artist_name?: string | null;
  synced_lyrics?: string | null;
  plain_lyrics?: string | null;
  offset_ms: number;
  timing_source?: string | null;
  updated_by_name?: string | null;
  updated_at?: string;
}

/**
 * Fetch cached lyrics and timing configuration for a YouTube video from Supabase.
 * Returns null if not found or on network/database error.
 */
export async function fetchVideoLyrics(videoId: string): Promise<VideoLyricsRecord | null> {
  if (!videoId) return null;
  try {
    const { data, error } = await supabase
      .from("video_lyrics")
      .select("*")
      .eq("youtube_video_id", videoId)
      .maybeSingle();

    if (error || !data) return null;
    return data as VideoLyricsRecord;
  } catch {
    return null;
  }
}

/**
 * Upsert lyrics and timing configuration for a YouTube video into Supabase.
 */
export async function saveVideoLyrics(record: {
  videoId: string;
  trackName?: string | null;
  artistName?: string | null;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  offsetMs?: number;
  timingSource?: string | null;
  updatedByName?: string | null;
}): Promise<void> {
  if (!record.videoId) return;
  try {
    const { error } = await supabase.rpc("upsert_video_lyrics", {
      p_video_id: record.videoId,
      p_track_name: record.trackName ?? null,
      p_artist_name: record.artistName ?? null,
      p_synced_lyrics: record.syncedLyrics ?? null,
      p_plain_lyrics: record.plainLyrics ?? null,
      p_offset_ms: record.offsetMs ?? 0,
      p_timing_source: record.timingSource ?? null,
      p_updated_by: record.updatedByName ?? null,
    });

    if (error) {
      // Fallback to direct upsert if RPC is unavailable
      await supabase.from("video_lyrics").upsert({
        youtube_video_id: record.videoId,
        track_name: record.trackName,
        artist_name: record.artistName,
        synced_lyrics: record.syncedLyrics,
        plain_lyrics: record.plainLyrics,
        offset_ms: record.offsetMs ?? 0,
        timing_source: record.timingSource,
        updated_by_name: record.updatedByName,
        updated_at: new Date().toISOString(),
      });
    }
  } catch {
    // Non-fatal: caching failure should not disrupt playback
  }
}

/**
 * Update only the offset (timing configuration) for a YouTube video in Supabase.
 */
export async function updateVideoLyricOffset(
  videoId: string,
  offsetMs: number,
  updatedByName?: string | null
): Promise<void> {
  if (!videoId) return;
  try {
    const { error } = await supabase.rpc("update_video_lyric_offset", {
      p_video_id: videoId,
      p_offset_ms: offsetMs,
      p_updated_by: updatedByName ?? null,
    });

    if (error) {
      // Fallback to direct update
      await supabase
        .from("video_lyrics")
        .update({
          offset_ms: offsetMs,
          updated_by_name: updatedByName,
          updated_at: new Date().toISOString(),
        })
        .eq("youtube_video_id", videoId);
    }
  } catch {
    // Non-fatal
  }
}
