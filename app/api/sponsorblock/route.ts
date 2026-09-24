import { NextResponse } from "next/server";
import {
  DEFAULT_SKIPPABLE_CATEGORIES,
  type SponsorSegment,
} from "@/lib/sponsorblock";

interface CacheEntry {
  segments: SponsorSegment[];
  expiresAt: number;
}

// In-memory cache for fast subsequent lookups
const segmentCache = new Map<string, CacheEntry>();
const POSITIVE_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const EMPTY_CACHE_TTL = 10 * 60 * 1000; // 10 minutes for 404 (no segments submitted)

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get("videoId");

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return NextResponse.json(
      { error: "Invalid YouTube videoId" },
      { status: 400 }
    );
  }

  // Check in-memory cache
  const cached = segmentCache.get(videoId);
  if (cached && Date.now() < cached.expiresAt) {
    return NextResponse.json(
      { segments: cached.segments, cached: true },
      {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        },
      }
    );
  }

  try {
    const categoriesParam = encodeURIComponent(
      JSON.stringify(DEFAULT_SKIPPABLE_CATEGORIES)
    );
    const targetUrl = `https://sponsor.ajay.app/api/skipSegments?videoID=${videoId}&categories=${categoriesParam}`;

    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent": "MusicTogether/1.0 (https://github.com/MusicTogether)",
      },
      next: { revalidate: 3600 },
    });

    if (res.status === 404) {
      // 404 from SponsorBlock means no skippable segments exist for this video
      const emptyResult: SponsorSegment[] = [];
      segmentCache.set(videoId, {
        segments: emptyResult,
        expiresAt: Date.now() + EMPTY_CACHE_TTL,
      });

      return NextResponse.json(
        { segments: emptyResult },
        {
          headers: {
            "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1800",
          },
        }
      );
    }

    if (!res.ok) {
      return NextResponse.json(
        { segments: [], error: `SponsorBlock API returned ${res.status}` },
        { status: 200 }
      );
    }

    const rawData = await res.json();
    if (!Array.isArray(rawData)) {
      return NextResponse.json({ segments: [] }, { status: 200 });
    }

    const segments: SponsorSegment[] = rawData
      .filter((item: any) => Array.isArray(item.segment) && item.segment.length === 2)
      .map((item: any) => {
        const start = Math.max(0, Number(item.segment[0]));
        const end = Math.max(start, Number(item.segment[1]));
        return {
          segmentId: String(item.UUID || item.segmentID || `${start}-${end}`),
          category: String(item.category || "sponsor"),
          start,
          end,
          duration: Math.max(0, end - start),
          videoDuration:
            typeof item.videoDuration === "number" && item.videoDuration > 0
              ? item.videoDuration
              : undefined,
        };
      })
      .sort((a, b) => a.start - b.start);

    // Save to cache
    segmentCache.set(videoId, {
      segments,
      expiresAt: Date.now() + POSITIVE_CACHE_TTL,
    });

    return NextResponse.json(
      { segments, cached: false },
      {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        },
      }
    );
  } catch (err: any) {
    console.error("[SponsorBlock API error]", err);
    return NextResponse.json(
      { segments: [], error: err.message || "Failed to query SponsorBlock" },
      { status: 200 }
    );
  }
}
