import type { LyricSearchItem } from "@/app/api/lyrics/search/route";

const NETEASE_HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://music.163.com",
};

export interface NetEaseSong {
  id: number;
  name: string;
  artistName: string;
  albumName?: string;
  durationSeconds?: number;
}

/**
 * Searches NetEase Cloud Music for songs matching the query.
 */
export async function searchNetEaseSongs(query: string, limit = 5): Promise<NetEaseSong[]> {
  if (!query.trim()) return [];

  try {
    const body = new URLSearchParams({
      s: query.trim(),
      type: "1",
      offset: "0",
      limit: String(limit),
    });

    const res = await fetch("https://music.163.com/api/cloudsearch/pc", {
      method: "POST",
      headers: NETEASE_HEADERS,
      body: body.toString(),
      signal: AbortSignal.timeout(6000),
      next: { revalidate: 3600 },
    });

    if (!res.ok) return [];

    const data = await res.json();
    const rawSongs = data?.result?.songs;
    if (!Array.isArray(rawSongs)) return [];

    return rawSongs.map((song: any) => {
      const artists = Array.isArray(song.ar)
        ? song.ar.map((a: any) => a?.name).filter(Boolean).join(", ")
        : "";
      const durationSeconds =
        typeof song.dt === "number" && song.dt > 0 ? Math.round(song.dt / 1000) : undefined;

      return {
        id: song.id,
        name: song.name || "",
        artistName: artists || "Unknown Artist",
        albumName: song.al?.name || undefined,
        durationSeconds,
      };
    });
  } catch (err) {
    console.warn("[NetEase Search Error]:", err);
    return [];
  }
}

/**
 * Fetches the synchronized LRC lyric for a specific NetEase song ID.
 */
export async function fetchNetEaseLyric(
  songId: number | string
): Promise<{ syncedLyrics?: string; plainLyrics?: string } | null> {
  if (!songId) return null;

  try {
    const res = await fetch(
      `https://music.163.com/api/song/lyric?os=pc&id=${songId}&lv=-1&kv=-1&tv=-1`,
      {
        headers: {
          "User-Agent": NETEASE_HEADERS["User-Agent"],
          Referer: NETEASE_HEADERS.Referer,
        },
        signal: AbortSignal.timeout(6000),
        next: { revalidate: 86400 },
      }
    );

    if (!res.ok) return null;

    const data = await res.json();
    const rawLyric: string = data?.lrc?.lyric || "";
    if (!rawLyric.trim()) return null;

    // Check if the lyric contains timestamps
    const hasTimestamps = /\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/.test(rawLyric);

    if (hasTimestamps) {
      return { syncedLyrics: rawLyric.trim() };
    }
    return { plainLyrics: rawLyric.trim() };
  } catch (err) {
    console.warn("[NetEase Lyric Error]:", err);
    return null;
  }
}

/**
 * High-level helper: Searches NetEase and fetches lyrics in parallel for search candidates.
 */
export async function searchNetEaseCandidates(
  query: string,
  targetDuration = 0,
  limit = 5
): Promise<LyricSearchItem[]> {
  const songs = await searchNetEaseSongs(query, limit);
  if (songs.length === 0) return [];

  const promises = songs.map(async (song) => {
    const lyricData = await fetchNetEaseLyric(song.id);
    if (!lyricData || (!lyricData.syncedLyrics && !lyricData.plainLyrics)) {
      return null;
    }

    const durationDelta =
      targetDuration > 0 && typeof song.durationSeconds === "number"
        ? Math.round(song.durationSeconds - targetDuration)
        : null;

    const item: LyricSearchItem = {
      id: song.id,
      source: "netease",
      trackName: song.name,
      artistName: song.artistName,
      albumName: song.albumName,
      duration: song.durationSeconds,
      durationDelta,
      hasSynced: !!lyricData.syncedLyrics,
      syncedLyrics: lyricData.syncedLyrics,
      plainLyrics: lyricData.plainLyrics,
    };
    return item;
  });

  const settled = await Promise.allSettled(promises);
  const items: LyricSearchItem[] = [];

  for (const s of settled) {
    if (s.status === "fulfilled" && s.value) {
      items.push(s.value);
    }
  }

  return items;
}

/**
 * Searches NetEase and finds the single best lyric candidate for automatic fallback.
 */
export async function findBestNetEaseLyric(
  query: string,
  targetDuration = 0
): Promise<{
  syncedLyrics?: string;
  plainLyrics?: string;
  trackName?: string;
  artistName?: string;
} | null> {
  const candidates = await searchNetEaseCandidates(query, targetDuration, 3);
  if (candidates.length === 0) return null;

  // Pass 1: synced lyrics + close duration (+/- 6 seconds)
  if (targetDuration > 0) {
    const matched = candidates.find(
      (c) => c.hasSynced && c.duration && Math.abs(c.duration - targetDuration) <= 6
    );
    if (matched) {
      return {
        syncedLyrics: matched.syncedLyrics,
        plainLyrics: matched.plainLyrics,
        trackName: matched.trackName,
        artistName: matched.artistName,
      };
    }
  }

  // Pass 2: any synced lyrics
  const anySynced = candidates.find((c) => c.hasSynced);
  if (anySynced) {
    return {
      syncedLyrics: anySynced.syncedLyrics,
      plainLyrics: anySynced.plainLyrics,
      trackName: anySynced.trackName,
      artistName: anySynced.artistName,
    };
  }

  // Pass 3: first candidate with lyrics
  const first = candidates[0];
  return {
    syncedLyrics: first.syncedLyrics,
    plainLyrics: first.plainLyrics,
    trackName: first.trackName,
    artistName: first.artistName,
  };
}
