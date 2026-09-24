import { cleanYouTubeTitle } from "@/lib/lyrics/clean-title";
import { findBestNetEaseLyric } from "@/lib/lyrics/netease";

const LRCLIB_UA = "MusicTogether/1.0 (https://github.com/AleamZ/Music-Together)";

interface LrcLibTrack {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  syncedLyrics?: string;
  plainLyrics?: string;
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const rawTitle = searchParams.get("title")?.trim() || "";
  const paramArtist = searchParams.get("artist")?.trim() || "";
  const paramDuration = Number(searchParams.get("duration")) || 0;

  if (!rawTitle) {
    return Response.json({ error: "Title parameter is required" }, { status: 400 });
  }

  const cleaned = cleanYouTubeTitle(rawTitle);
  const artist = paramArtist || cleaned.artistName;
  const track = cleaned.trackName || rawTitle;

  const headers = {
    "User-Agent": LRCLIB_UA,
  };

  try {
    // 1. If both artist and track are known, try the precise /api/get endpoint first
    if (artist && track) {
      let getUrl = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(track)}`;
      if (paramDuration > 0) {
        getUrl += `&duration=${Math.round(paramDuration)}`;
      }

      const res = await fetch(getUrl, {
        headers,
        signal: AbortSignal.timeout(6000),
        next: { revalidate: 86400 },
      });

      if (res.ok) {
        const data = (await res.json()) as LrcLibTrack;
        if (data.syncedLyrics || data.plainLyrics) {
          return Response.json(data, {
            headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=43200" },
          });
        }
      }
    }

    // 2. Fallback to /api/search?q= using clean query
    const searchQuery = cleaned.cleanQuery || rawTitle;
    const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(searchQuery)}`;

    const searchRes = await fetch(searchUrl, {
      headers,
      signal: AbortSignal.timeout(6000),
      next: { revalidate: 86400 },
    });

    if (searchRes.ok) {
      const items = (await searchRes.json()) as LrcLibTrack[];
      if (Array.isArray(items) && items.length > 0) {
        // Pick best matching candidate: prefer synced lyrics & matching duration
        let bestCandidate: LrcLibTrack | null = null;

        // Pass 1: synced lyrics + close duration (+/- 5 seconds)
        if (paramDuration > 0) {
          bestCandidate =
            items.find(
              (item) => item.syncedLyrics && item.duration && Math.abs(item.duration - paramDuration) <= 5
            ) ?? null;
        }

        // Pass 2: any track with synced lyrics
        if (!bestCandidate) {
          bestCandidate = items.find((item) => !!item.syncedLyrics) ?? null;
        }

        // Pass 3: first item with plain lyrics
        if (!bestCandidate) {
          bestCandidate = items.find((item) => !!item.plainLyrics) ?? items[0];
        }

        if (bestCandidate && bestCandidate.syncedLyrics) {
          return Response.json(bestCandidate, {
            headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=43200" },
          });
        }
      }
    }

    // 3. Fallback to NetEase Cloud Music
    const neteaseCandidate = await findBestNetEaseLyric(searchQuery, paramDuration);
    if (neteaseCandidate && (neteaseCandidate.syncedLyrics || neteaseCandidate.plainLyrics)) {
      return Response.json(neteaseCandidate, {
        headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=43200" },
      });
    }

    return Response.json({ error: "Lyrics not found" }, { status: 404 });
  } catch {
    return Response.json({ error: "Lyrics fetch request failed" }, { status: 502 });
  }
}
