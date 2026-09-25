"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { findActiveLyricIndex, parseLrc, type LyricLine } from "@/lib/lyrics/parse-lrc";
import { joinLyricSync, type LyricHint, type LyricSyncHandle } from "@/lib/lyrics/channel";
import { fetchVideoLyrics, saveVideoLyrics, updateVideoLyricOffset, type VideoLyricsRecord } from "@/lib/lyrics/db";

export interface LyricsData {
  trackName?: string;
  artistName?: string;
  syncedLyrics?: string;
  plainLyrics?: string;
}

export interface UseLyricsProps {
  title?: string | null;
  durationSeconds?: number | null;
  elapsedMs: number;
  roomId?: string | null;
  trackId?: string | null;
  youtubeVideoId?: string | null;
  /** The signed-in account's session token: the cache-writing RPCs check it (the room's DJ only). */
  sessionToken: string | null;
  canControl?: boolean;
}

const lyricsCache = new Map<string, { lines: LyricLine[]; meta: LyricsData }>();
const lyricsCacheKey = (title: string, durationSec: number) => `${title.trim().toLowerCase()}_${durationSec}`;
const OFFSET_STORAGE_PREFIX = "music-together:lyric-offset:";

export function getSavedLyricOffset(videoId?: string | null): number {
  if (typeof window === "undefined" || !videoId) return 0;
  try {
    const val = localStorage.getItem(`${OFFSET_STORAGE_PREFIX}${videoId}`);
    if (val !== null) {
      const num = Number(val);
      if (Number.isFinite(num)) return num;
    }
  } catch {
    // Ignore storage errors
  }
  return 0;
}

export function saveLyricOffset(videoId: string | null | undefined, offsetMs: number) {
  if (typeof window === "undefined" || !videoId) return;
  try {
    if (offsetMs === 0) {
      localStorage.removeItem(`${OFFSET_STORAGE_PREFIX}${videoId}`);
    } else {
      localStorage.setItem(`${OFFSET_STORAGE_PREFIX}${videoId}`, String(offsetMs));
    }
  } catch {
    // Ignore storage errors
  }
}

export function useLyrics({
  title,
  durationSeconds,
  elapsedMs,
  roomId,
  trackId,
  youtubeVideoId,
  sessionToken,
  canControl = false,
}: UseLyricsProps) {
  const [lines, setLines] = useState<LyricLine[]>([]);
  const [meta, setMeta] = useState<LyricsData | null>(null);
  const [offsetMs, setOffsetMsState] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentTitleRef = useRef<string | null>(null);
  const lyricSyncHandleRef = useRef<LyricSyncHandle | null>(null);
  const hintSeqRef = useRef(0); // numbers the hint refetches: only the newest one is shown

  // Load the saved offset (persistent cache) when the active track changes, or reset to 0.
  // Adjusted while rendering, so the new track never renders with the previous track's offset.
  const offsetTrackKey = `${trackId ?? ""}|${youtubeVideoId ?? ""}`;
  const [offsetLoadedFor, setOffsetLoadedFor] = useState<string | null>(null);
  if (offsetLoadedFor !== offsetTrackKey) {
    setOffsetLoadedFor(offsetTrackKey);
    setOffsetMsState(getSavedLyricOffset(youtubeVideoId));
  }

  // No song: clear the panel (also adjusted while rendering).
  const [shownTitle, setShownTitle] = useState(title);
  if (shownTitle !== title) {
    setShownTitle(title);
    if (!title) {
      setLines([]);
      setMeta(null);
      setError(null);
      setLoading(false);
    }
  }

  /**
   * Show the lyrics of a video_lyrics row: lines, meta and the in-memory cache.
   * The first load and a DJ's hint both go through here. Returns false for a row without lyrics.
   */
  const showDbLyrics = useCallback((record: VideoLyricsRecord, cacheKey: string): boolean => {
    if (!record.synced_lyrics && !record.plain_lyrics) return false;
    const parsedLines = parseLrc(record.synced_lyrics || record.plain_lyrics || "");
    const dbMeta: LyricsData = {
      trackName: record.track_name || undefined,
      artistName: record.artist_name || undefined,
      syncedLyrics: record.synced_lyrics || undefined,
      plainLyrics: record.plain_lyrics || undefined,
    };
    lyricsCache.set(cacheKey, { lines: parsedLines, meta: dbMeta });
    setLines(parsedLines);
    setMeta(dbMeta);
    setError(null);
    setLoading(false);
    return true;
  }, []);

  /** Use a video_lyrics row's offset and remember it in this browser (0 forgets the remembered one). */
  const adoptDbOffset = useCallback((record: VideoLyricsRecord, videoId: string) => {
    if (typeof record.offset_ms !== "number") return;
    setOffsetMsState(record.offset_ms);
    saveLyricOffset(videoId, record.offset_ms);
  }, []);

  // A DJ's hint names a track and a video, nothing else: refetch that row from the database (never the in-memory
  // cache, never the payload — anyone can broadcast on the topic) and show it as the first load does, except that
  // its offset applies even when it is 0: the hint follows a DJ change, which may be a reset.
  const showHintedRecord = useEffectEvent((hint: LyricHint, record: VideoLyricsRecord | null) => {
    // The room may have moved on while the row was loading.
    if (!record || !title || hint.trackId !== trackId || hint.videoId !== youtubeVideoId) return;
    showDbLyrics(record, lyricsCacheKey(title, durationSeconds || 0));
    adoptDbOffset(record, hint.videoId);
  });
  const onLyricHint = useEffectEvent((hint: LyricHint) => {
    if (!trackId || !youtubeVideoId || hint.trackId !== trackId || hint.videoId !== youtubeVideoId) return;
    const seq = ++hintSeqRef.current;
    void fetchVideoLyrics(hint.videoId).then((record) => {
      if (seq === hintSeqRef.current) showHintedRecord(hint, record); // an older refetch never overwrites a newer one
    });
  });

  // Subscribe to the room's lyric hints (one subscription per room; the handlers above read the current track)
  useEffect(() => {
    if (!roomId) return;
    const handle = joinLyricSync(roomId, (hint) => onLyricHint(hint));
    lyricSyncHandleRef.current = handle;
    return () => {
      handle.unsubscribe();
      lyricSyncHandleRef.current = null;
    };
  }, [roomId]);

  const fetchLyrics = useCallback(
    async (searchTitle: string, durationSec = 0, videoId?: string | null) => {
      if (!searchTitle.trim()) {
        setLines([]);
        setMeta(null);
        setError(null);
        return;
      }

      const cacheKey = lyricsCacheKey(searchTitle, durationSec);
      if (lyricsCache.has(cacheKey)) {
        const cached = lyricsCache.get(cacheKey)!;
        setLines(cached.lines);
        setMeta(cached.meta);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      // 1. First check Supabase video_lyrics cache for this specific YouTube video
      if (videoId) {
        try {
          const dbRecord = await fetchVideoLyrics(videoId);
          if (dbRecord && showDbLyrics(dbRecord, cacheKey)) {
            // First load: an offset of 0 means "not calibrated", so this browser keeps its own remembered offset.
            if (dbRecord.offset_ms !== 0) adoptDbOffset(dbRecord, videoId);
            return;
          }
        } catch {
          // Fall back to external API query
        }
      }

      // 2. Fetch from external lyrics search API (LRCLIB / Netease)
      try {
        let url = `/api/lyrics?title=${encodeURIComponent(searchTitle.trim())}`;
        if (durationSec > 0) {
          url += `&duration=${Math.round(durationSec)}`;
        }

        const res = await fetch(url);
        if (!res.ok) {
          if (res.status === 404) {
            setError("Chưa có lời cho bài hát này.");
          } else {
            setError("Không thể tải lời bài hát.");
          }
          setLines([]);
          setMeta(null);
          return;
        }

        const data = (await res.json()) as LyricsData;
        const rawText = data.syncedLyrics || data.plainLyrics || "";
        const parsedLines = parseLrc(rawText);

        lyricsCache.set(cacheKey, { lines: parsedLines, meta: data });
        setLines(parsedLines);
        setMeta(data);

        // 3. Asynchronously cache to database so future plays load instantly
        // ONLY DJ / Controller writes the new song cache to DB to prevent duplicate writes (the RPC checks the
        // session and the DJ role again). The row becomes this full record, with the DJ's current offset.
        if (canControl && roomId && sessionToken && videoId && (data.syncedLyrics || data.plainLyrics)) {
          void saveVideoLyrics(roomId, sessionToken, {
            videoId,
            trackName: data.trackName,
            artistName: data.artistName,
            syncedLyrics: data.syncedLyrics,
            plainLyrics: data.plainLyrics,
            offsetMs,
            timingSource: "auto",
          });
        }
      } catch {
        setError("Lỗi kết nối khi tải lời bài hát.");
        setLines([]);
        setMeta(null);
      } finally {
        setLoading(false);
      }
    },
    [showDbLyrics, adoptDbOffset, canControl, roomId, sessionToken, offsetMs]
  );

  // Fetch automatically when song title or YouTube video changes (no title: the panel is cleared above)
  useEffect(() => {
    if (!title) {
      currentTitleRef.current = null;
      return;
    }

    const key = `${title}_${youtubeVideoId ?? ""}`;
    if (currentTitleRef.current === key) return;
    currentTitleRef.current = key;

    void fetchLyrics(title, durationSeconds || 0, youtubeVideoId);
  }, [title, durationSeconds, youtubeVideoId, fetchLyrics]);

  const effectiveElapsedMs = useMemo(() => {
    return Math.max(0, elapsedMs + offsetMs);
  }, [elapsedMs, offsetMs]);

  const activeLineIndex = useMemo(() => {
    return findActiveLyricIndex(lines, effectiveElapsedMs);
  }, [lines, effectiveElapsedMs]);

  const hasSynced = useMemo(() => {
    return lines.length > 0 && lines[0].timeMs >= 0;
  }, [lines]);

  const setOffsetMs = useCallback(
    (newOffset: number | ((prev: number) => number), syncToRoom = false) => {
      // Side effects stay out of the state updater (StrictMode calls updaters twice).
      const next = typeof newOffset === "function" ? newOffset(offsetMs) : newOffset;
      setOffsetMsState(next);
      saveLyricOffset(youtubeVideoId, next);

      // ONLY DJ / Controller (canControl) with syncToRoom updates the DB, then hints the room to refetch it
      if (canControl && syncToRoom && trackId && youtubeVideoId && roomId && sessionToken) {
        const hint: LyricHint = { trackId, videoId: youtubeVideoId };
        void updateVideoLyricOffset(roomId, sessionToken, youtubeVideoId, next).then((saved) => {
          if (saved) lyricSyncHandleRef.current?.send(hint);
        });
      }
    },
    [offsetMs, youtubeVideoId, canControl, trackId, roomId, sessionToken]
  );

  const searchManual = useCallback(
    async (customQuery: string) => {
      if (!customQuery.trim()) return;
      await fetchLyrics(customQuery.trim(), durationSeconds || 0, youtubeVideoId);
    },
    [durationSeconds, fetchLyrics, youtubeVideoId]
  );

  const applyCustomLyric = useCallback(
    (data: LyricsData, syncToRoom = false) => {
      const rawText = data.syncedLyrics || data.plainLyrics || "";
      const parsedLines = parseLrc(rawText);
      setLines(parsedLines);
      setMeta(data);
      setError(null);
      setLoading(false);

      if (title) {
        lyricsCache.set(lyricsCacheKey(title, durationSeconds || 0), { lines: parsedLines, meta: data });
      }

      // ONLY DJ / Controller (canControl) with syncToRoom saves to the DB, then hints the room to refetch it
      if (canControl && syncToRoom && trackId && youtubeVideoId && roomId && sessionToken) {
        const hint: LyricHint = { trackId, videoId: youtubeVideoId };
        void saveVideoLyrics(roomId, sessionToken, {
          videoId: youtubeVideoId,
          trackName: data.trackName,
          artistName: data.artistName,
          syncedLyrics: data.syncedLyrics,
          plainLyrics: data.plainLyrics,
          offsetMs,
          timingSource: "custom",
        }).then((saved) => {
          if (saved) lyricSyncHandleRef.current?.send(hint);
        });
      }
    },
    [title, durationSeconds, canControl, trackId, roomId, sessionToken, offsetMs, youtubeVideoId]
  );

  return {
    lines,
    meta,
    loading,
    error,
    hasSynced,
    activeLineIndex,
    offsetMs,
    setOffsetMs,
    effectiveElapsedMs,
    searchManual,
    applyCustomLyric,
  };
}
