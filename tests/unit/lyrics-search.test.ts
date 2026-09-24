import { describe, it, expect } from "vitest";
import { sortSearchResults, type LyricSearchItem } from "@/app/api/lyrics/search/route";

describe("sortSearchResults", () => {
  it("prioritizes tracks with syncedLyrics over plainLyrics", () => {
    const items: LyricSearchItem[] = [
      {
        id: 1,
        trackName: "Song A",
        artistName: "Artist A",
        duration: 200,
        hasSynced: false,
        plainLyrics: "Plain text lyrics",
      },
      {
        id: 2,
        trackName: "Song A (Synced)",
        artistName: "Artist A",
        duration: 200,
        hasSynced: true,
        syncedLyrics: "[00:01.00] Hello world",
      },
    ];

    const sorted = sortSearchResults(items, 200);
    expect(sorted[0].id).toBe(2);
    expect(sorted[1].id).toBe(1);
  });

  it("prioritizes tracks with closest duration when targetDuration is specified", () => {
    const targetDuration = 210;
    const items: LyricSearchItem[] = [
      {
        id: 1,
        trackName: "Track 1",
        artistName: "Artist",
        duration: 240, // delta = 30s
        hasSynced: true,
        syncedLyrics: "[00:01.00] Hi",
      },
      {
        id: 2,
        trackName: "Track 2",
        artistName: "Artist",
        duration: 212, // delta = 2s
        hasSynced: true,
        syncedLyrics: "[00:01.00] Hi",
      },
      {
        id: 3,
        trackName: "Track 3",
        artistName: "Artist",
        duration: 215, // delta = 5s
        hasSynced: true,
        syncedLyrics: "[00:01.00] Hi",
      },
    ];

    const sorted = sortSearchResults(items, targetDuration);
    expect(sorted[0].id).toBe(2); // delta 2s
    expect(sorted[1].id).toBe(3); // delta 5s
    expect(sorted[2].id).toBe(1); // delta 30s
  });

  it("handles items without duration gracefully", () => {
    const items: LyricSearchItem[] = [
      {
        id: 1,
        trackName: "Track 1",
        artistName: "Artist",
        hasSynced: true,
        syncedLyrics: "[00:01.00] Hi",
      },
      {
        id: 2,
        trackName: "Track 2",
        artistName: "Artist",
        duration: 210,
        hasSynced: true,
        syncedLyrics: "[00:01.00] Hi",
      },
    ];

    const sorted = sortSearchResults(items, 210);
    expect(sorted).toHaveLength(2);
  });
});
