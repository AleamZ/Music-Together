"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findActiveLyricIndex, parseLrc, type LyricLine } from "@/lib/lyrics/parse-lrc";
import { joinLyricSync, type LyricSyncHandle } from "@/lib/lyrics/channel";
import { fetchVideoLyrics, saveVideoLyrics, updateVideoLyricOffset } from "@/lib/lyrics/db";

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

  // Subscribe to real-time lyric change broadcasts across room members
  useEffect(() => {
    if (!roomId) return;

    const handle = joinLyricSync(roomId, (payload) => {
      // Validate that this lyric update is meant for the currently active track
      if (trackId && payload.trackId === trackId) {
        if (typeof payload.offsetMs === "number") {
          setOffsetMsState(payload.offsetMs);
          saveLyricOffset(youtubeVideoId, payload.offsetMs);
        }

        if (payload.syncedLyrics !== undefined || payload.plainLyrics !== undefined) {
          const rawText = payload.syncedLyrics || payload.plainLyrics || "";
          const parsedLines = parseLrc(rawText);
          const newMeta: LyricsData = {
            trackName: payload.trackName,
            artistName: payload.artistName,
            syncedLyrics: payload.syncedLyrics,
            plainLyrics: payload.plainLyrics,
          };

          setLines(parsedLines);
          setMeta(newMeta);
          setError(null);
          setLoading(false);

          if (title) {
            const cacheKey = `${title.trim().toLowerCase()}_${durationSeconds || 0}`;
            lyricsCache.set(cacheKey, { lines: parsedLines, meta: newMeta });
          }
        }
      }
    });

    lyricSyncHandleRef.current = handle;
    return () => {
      handle.unsubscribe();
      lyricSyncHandleRef.current = null;
    };
  }, [roomId, trackId, youtubeVideoId, title, durationSeconds]);

  const fetchLyrics = useCallback(
    async (searchTitle: string, durationSec = 0, videoId?: string | null) => {
      if (!searchTitle.trim()) {
        setLines([]);
        setMeta(null);
        setError(null);
        return;
      }

      const cacheKey = `${searchTitle.trim().toLowerCase()}_${durationSec}`;
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
          if (dbRecord && (dbRecord.synced_lyrics || dbRecord.plain_lyrics)) {
            const rawText = dbRecord.synced_lyrics || dbRecord.plain_lyrics || "";
            const parsedLines = parseLrc(rawText);
            const dbMeta: LyricsData = {
              trackName: dbRecord.track_name || undefined,
              artistName: dbRecord.artist_name || undefined,
              syncedLyrics: dbRecord.synced_lyrics || undefined,
              plainLyrics: dbRecord.plain_lyrics || undefined,
            };
            lyricsCache.set(cacheKey, { lines: parsedLines, meta: dbMeta });
            setLines(parsedLines);
            setMeta(dbMeta);
            if (typeof dbRecord.offset_ms === "number" && dbRecord.offset_ms !== 0) {
              setOffsetMsState(dbRecord.offset_ms);
              saveLyricOffset(videoId, dbRecord.offset_ms);
            }
            setLoading(false);
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
        // ONLY DJ / Controller writes the new song cache to DB to prevent duplicate writes and overwriting offset
        // (the RPC checks the session and the DJ role again).
        if (canControl && roomId && sessionToken && videoId && (data.syncedLyrics || data.plainLyrics)) {
          void saveVideoLyrics(roomId, sessionToken, {
            videoId,
            trackName: data.trackName,
            artistName: data.artistName,
            syncedLyrics: data.syncedLyrics,
            plainLyrics: data.plainLyrics,
            offsetMs: 0,
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
    [canControl, roomId, sessionToken]
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

      // ONLY DJ / Controller (canControl) with syncToRoom can broadcast and update DB
      if (canControl && syncToRoom && trackId) {
        lyricSyncHandleRef.current?.send({ trackId, offsetMs: next });
        if (youtubeVideoId && roomId && sessionToken) {
          void updateVideoLyricOffset(roomId, sessionToken, youtubeVideoId, next);
        }
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
        const cacheKey = `${title.trim().toLowerCase()}_${durationSeconds || 0}`;
        lyricsCache.set(cacheKey, { lines: parsedLines, meta: data });
      }

      // ONLY DJ / Controller (canControl) with syncToRoom can broadcast and update DB
      if (canControl && syncToRoom && trackId) {
        lyricSyncHandleRef.current?.send({
          trackId,
          syncedLyrics: data.syncedLyrics,
          plainLyrics: data.plainLyrics,
          trackName: data.trackName,
          artistName: data.artistName,
          offsetMs,
        });
        if (youtubeVideoId && roomId && sessionToken) {
          void saveVideoLyrics(roomId, sessionToken, {
            videoId: youtubeVideoId,
            trackName: data.trackName,
            artistName: data.artistName,
            syncedLyrics: data.syncedLyrics,
            plainLyrics: data.plainLyrics,
            offsetMs,
            timingSource: "custom",
          });
        }
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
