import { cleanYouTubeTitle } from "@/lib/lyrics/clean-title";
import { searchNetEaseCandidates } from "@/lib/lyrics/netease";

const LRCLIB_UA = "MusicTogether/1.0 (https://github.com/AleamZ/Music-Together)";

export interface LyricSearchItem {
  id: number | string;
  source?: "lrclib" | "netease";
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  durationDelta?: number | null;
  hasSynced: boolean;
  syncedLyrics?: string;
  plainLyrics?: string;
}

interface LrcLibItem {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  syncedLyrics?: string;
  plainLyrics?: string;
}

export function sortSearchResults(
  items: LyricSearchItem[],
  targetDuration = 0
): LyricSearchItem[] {
  return [...items].sort((a, b) => {
    // 1. Synced lyrics priority
    if (a.hasSynced !== b.hasSynced) {
      return a.hasSynced ? -1 : 1;
    }
    // 2. Duration delta priority if target duration exists
    if (
      targetDuration > 0 &&
      typeof a.duration === "number" &&
      typeof b.duration === "number"
    ) {
      const deltaA = Math.abs(a.duration - targetDuration);
      const deltaB = Math.abs(b.duration - targetDuration);
      if (deltaA !== deltaB) {
        return deltaA - deltaB;
      }
    }
    return 0;
  });
}

async function searchLrcLib(
  query: string,
  paramDuration = 0
): Promise<LyricSearchItem[]> {
  try {
    const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": LRCLIB_UA },
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 3600 },
    });

    if (!res.ok) return [];

    const data = (await res.json()) as LrcLibItem[];
    if (!Array.isArray(data)) return [];

    return data
      .filter((item) => item.syncedLyrics || item.plainLyrics)
      .map((item) => {
        const hasSynced = !!item.syncedLyrics;
        const durationDelta =
          paramDuration > 0 && typeof item.duration === "number"
            ? Math.round(item.duration - paramDuration)
            : null;
        return {
          id: item.id,
          source: "lrclib",
          trackName: item.trackName,
          artistName: item.artistName,
          albumName: item.albumName,
          duration: item.duration,
          durationDelta,
          hasSynced,
          syncedLyrics: item.syncedLyrics,
          plainLyrics: item.plainLyrics,
        };
      });
  } catch {
    return [];
  }
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const rawQuery = searchParams.get("q")?.trim() || "";
  const paramDuration = Number(searchParams.get("duration")) || 0;

  if (!rawQuery) {
    return Response.json(
      { error: "Query parameter 'q' is required" },
      { status: 400 }
    );
  }

  // Also clean query if it resembles a raw youtube title
  const cleaned = cleanYouTubeTitle(rawQuery);
  const query = cleaned.cleanQuery || rawQuery;

  try {
    // Run LRCLIB and NetEase searches in parallel
    const [lrcResult, neteaseResult] = await Promise.allSettled([
      searchLrcLib(query, paramDuration),
      searchNetEaseCandidates(query, paramDuration, 5),
    ]);

    const lrcItems: LyricSearchItem[] =
      lrcResult.status === "fulfilled" ? lrcResult.value : [];
    const neteaseItems: LyricSearchItem[] =
      neteaseResult.status === "fulfilled" ? neteaseResult.value : [];

    // Combine items
    const combined = [...lrcItems, ...neteaseItems];
    const sorted = sortSearchResults(combined, paramDuration);

    return Response.json({ items: sorted });
  } catch {
    return Response.json(
      { error: "Search request failed", items: [] },
      { status: 502 }
    );
  }
}
