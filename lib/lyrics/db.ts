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

/** The timing sources upsert_video_lyrics accepts (0014_lyrics_lockdown.sql). */
export type LyricsTimingSource = "auto" | "custom";

/** The full record the DJ applied: the row becomes exactly this, so every field is required (absent text is null). */
export interface VideoLyricsWrite {
  videoId: string;
  trackName: string | null | undefined;
  artistName: string | null | undefined;
  syncedLyrics: string | null | undefined;
  plainLyrics: string | null | undefined;
  /** The DJ's current offset: stored as sent, 0 included. */
  offsetMs: number;
  timingSource: LyricsTimingSource;
}

/**
 * Runs one cache-writing RPC. The table itself is read-only for clients, so there is no fallback.
 * Never throws: a failure is logged once and reported as false — lyrics caching must never break the player.
 */
async function writeRpc(fn: string, args: Record<string, unknown>): Promise<boolean> {
  try {
    const { error } = await supabase.rpc(fn, args);
    if (!error) return true;
    console.warn(`[lyrics] ${fn} failed: ${error.message}`);
  } catch (e) {
    console.warn(`[lyrics] ${fn} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return false;
}

/**
 * Replace the cached lyrics and timing of a YouTube video with the record the DJ applied. Only the room's DJ may:
 * the RPC checks the session, the DJ role and that the video is the room's current or queued song, and takes
 * "updated by" from the account. Resolves true once saved, false when skipped or refused.
 */
export async function saveVideoLyrics(roomId: string, sessionToken: string, record: VideoLyricsWrite): Promise<boolean> {
  if (!roomId || !sessionToken || !record.videoId) return false;
  // Every argument is sent, absent text as null: JSON drops undefined, and the RPC has no defaults.
  return writeRpc("upsert_video_lyrics", {
    p_room_id: roomId,
    p_session_token: sessionToken,
    p_video_id: record.videoId,
    p_track_name: record.trackName ?? null,
    p_artist_name: record.artistName ?? null,
    p_synced_lyrics: record.syncedLyrics ?? null,
    p_plain_lyrics: record.plainLyrics ?? null,
    p_offset_ms: record.offsetMs,
    p_timing_source: record.timingSource,
  });
}

/**
 * Update only the cached offset of a YouTube video (same DJ-only checks as saveVideoLyrics).
 * Resolves true once saved, false when skipped or refused.
 */
export async function updateVideoLyricOffset(
  roomId: string,
  sessionToken: string,
  videoId: string,
  offsetMs: number
): Promise<boolean> {
  if (!roomId || !sessionToken || !videoId) return false;
  return writeRpc("update_video_lyric_offset", {
    p_room_id: roomId,
    p_session_token: sessionToken,
    p_video_id: videoId,
    p_offset_ms: offsetMs,
  });
}
