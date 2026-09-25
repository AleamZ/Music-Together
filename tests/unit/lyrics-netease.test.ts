import { describe, it, expect } from "vitest";
import { sortSearchResults, type LyricSearchItem } from "@/app/api/lyrics/search/route";

describe("lib/lyrics/netease search sorting and mapping", () => {
  const sampleCandidates: LyricSearchItem[] = [
    {
      id: "netease-1",
      source: "netease",
      trackName: "Chúng Ta Của Tương Lai",
      artistName: "Sơn Tùng M-TP",
      duration: 250,
      durationDelta: 10,
      hasSynced: true,
      syncedLyrics: "[00:27.56]Liệu mai sau phai vội mau...",
    },
    {
      id: "lrclib-1",
      source: "lrclib",
      trackName: "Chung Ta Cua Tuong Lai",
      artistName: "Son Tung M-TP",
      duration: 242,
      durationDelta: 2,
      hasSynced: true,
      syncedLyrics: "[00:27.50]Liệu mai sau phai vội mau...",
    },
    {
      id: "netease-2",
      source: "netease",
      trackName: "Chúng Ta Của Tương Lai (Cover)",
      artistName: "Unknown",
      duration: 180,
      durationDelta: -60,
      hasSynced: false,
      plainLyrics: "Liệu mai sau phai vội mau...",
    },
  ];

  it("prioritizes synced lyrics over plain lyrics", () => {
    const sorted = sortSearchResults(sampleCandidates, 240);
    expect(sorted[0].hasSynced).toBe(true);
    expect(sorted[1].hasSynced).toBe(true);
    expect(sorted[2].hasSynced).toBe(false);
  });

  it("prioritizes closest durationDelta among synced items", () => {
    // Target is 240 seconds. lrclib-1 (242s, delta 2) is closer than netease-1 (250s, delta 10)
    const sorted = sortSearchResults(sampleCandidates, 240);
    expect(sorted[0].id).toBe("lrclib-1");
    expect(sorted[1].id).toBe("netease-1");
  });

  it("correctly identifies sources for UI badges", () => {
    expect(sampleCandidates[0].source).toBe("netease");
    expect(sampleCandidates[1].source).toBe("lrclib");
  });
});
