"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findActiveLyricIndex, parseLrc, type LyricLine } from "@/lib/lyrics/parse-lrc";
import { joinLyricSync, type LyricSyncHandle } from "@/lib/lyrics/channel";

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
  username?: string | null;
}

const lyricsCache = new Map<string, { lines: LyricLine[]; meta: LyricsData }>();

export function useLyrics({
  title,
  durationSeconds,
  elapsedMs,
  roomId,
  trackId,
  username,
}: UseLyricsProps) {
  const [lines, setLines] = useState<LyricLine[]>([]);
  const [meta, setMeta] = useState<LyricsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentTitleRef = useRef<string | null>(null);
  const lyricSyncHandleRef = useRef<LyricSyncHandle | null>(null);

  // Subscribe to real-time lyric change broadcasts across room members
  useEffect(() => {
    if (!roomId) return;

    const handle = joinLyricSync(roomId, (payload) => {
      // Validate that this lyric update is meant for the currently active track
      if (trackId && payload.trackId === trackId) {
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
    });

    lyricSyncHandleRef.current = handle;
    return () => {
      handle.unsubscribe();
      lyricSyncHandleRef.current = null;
    };
  }, [roomId, trackId, title, durationSeconds]);

  const fetchLyrics = useCallback(async (searchTitle: string, durationSec = 0) => {
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
    } catch {
      setError("Lỗi kết nối khi tải lời bài hát.");
      setLines([]);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch automatically when song title changes
  useEffect(() => {
    if (!title) {
      currentTitleRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- title changed / reset
      setLines([]);
      setMeta(null);
      setError(null);
      setLoading(false);
      return;
    }

    if (currentTitleRef.current === title) return;
    currentTitleRef.current = title;

    void fetchLyrics(title, durationSeconds || 0);
  }, [title, durationSeconds, fetchLyrics]);

  const activeLineIndex = useMemo(() => {
    return findActiveLyricIndex(lines, elapsedMs);
  }, [lines, elapsedMs]);

  const hasSynced = useMemo(() => {
    return lines.length > 0 && lines[0].timeMs >= 0;
  }, [lines]);

  const searchManual = useCallback(
    async (customQuery: string) => {
      if (!customQuery.trim()) return;
      await fetchLyrics(customQuery.trim(), durationSeconds || 0);
    },
    [durationSeconds, fetchLyrics]
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

      if (syncToRoom && lyricSyncHandleRef.current && trackId) {
        lyricSyncHandleRef.current.send({
          trackId,
          syncedLyrics: data.syncedLyrics,
          plainLyrics: data.plainLyrics,
          trackName: data.trackName,
          artistName: data.artistName,
          appliedByName: username || undefined,
        });
      }
    },
    [title, durationSeconds, trackId, username]
  );

  return {
    lines,
    meta,
    loading,
    error,
    hasSynced,
    activeLineIndex,
    searchManual,
    applyCustomLyric,
  };
}
