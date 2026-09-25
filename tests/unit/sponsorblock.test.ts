import { describe, it, expect } from "vitest";
import {
  findActiveSkipSegment,
  getCategoryLabel,
  getIntroOffsetSuggestion,
  isEndOfTrackSegment,
  type SponsorSegment,
} from "@/lib/sponsorblock";

describe("lib/sponsorblock", () => {
  const sampleSegments: SponsorSegment[] = [
    {
      segmentId: "seg-1",
      category: "sponsor",
      start: 45.0,
      end: 75.0,
      duration: 30.0,
    },
    {
      segmentId: "seg-2",
      category: "music_offtopic",
      start: 120.0,
      end: 150.0,
      duration: 30.0,
    },
  ];

  it("translates category labels to friendly Vietnamese", () => {
    expect(getCategoryLabel("sponsor")).toBe("Quảng cáo tài trợ");
    expect(getCategoryLabel("selfpromo")).toBe("Quảng bá / Hội viên");
    expect(getCategoryLabel("music_offtopic")).toBe("Đoạn thoại ngoài lề");
    expect(getCategoryLabel("unknown_cat")).toBe("Quảng cáo");
  });

  it("returns null when current time is before any segment", () => {
    const skipped = new Set<string>();
    const res = findActiveSkipSegment(30.0, sampleSegments, skipped);
    expect(res).toBeNull();
  });

  it("detects segment when playback enters the range", () => {
    const skipped = new Set<string>();
    const res = findActiveSkipSegment(45.5, sampleSegments, skipped);
    expect(res).not.toBeNull();
    expect(res?.segmentId).toBe("seg-1");
    expect(res?.end).toBe(75.0);
  });

  it("ignores segment if it has already been skipped (skip guard)", () => {
    const skipped = new Set<string>(["seg-1"]);
    const res = findActiveSkipSegment(46.0, sampleSegments, skipped);
    expect(res).toBeNull();
  });

  it("detects second segment after first segment has passed", () => {
    const skipped = new Set<string>(["seg-1"]);
    const res = findActiveSkipSegment(125.0, sampleSegments, skipped);
    expect(res).not.toBeNull();
    expect(res?.segmentId).toBe("seg-2");
  });

  it("does not trigger when already past the segment end", () => {
    const skipped = new Set<string>();
    const res = findActiveSkipSegment(76.0, sampleSegments, skipped);
    expect(res).toBeNull();
  });

  describe("isEndOfTrackSegment", () => {
    it("returns true for outro category regardless of duration", () => {
      const seg: SponsorSegment = {
        segmentId: "outro-1",
        category: "outro",
        start: 180,
        end: 200,
        duration: 20,
      };
      expect(isEndOfTrackSegment(seg, 0)).toBe(true);
      expect(isEndOfTrackSegment(seg, 200)).toBe(true);
    });

    it("returns true when segment extends to or near the end (user scenario: skip at 3:24 in 3:25 clip)", () => {
      const seg: SponsorSegment = {
        segmentId: "end-sponsor",
        category: "sponsor",
        start: 190.0,
        end: 204.0, // 3:24
        duration: 14.0,
      };
      // Video is 205s (3:25). 204 >= 205 - 3 (202) -> true
      expect(isEndOfTrackSegment(seg, 205.0)).toBe(true);
    });

    it("returns true when segment end equals or exceeds video duration", () => {
      const seg: SponsorSegment = {
        segmentId: "overflow-seg",
        category: "sponsor",
        start: 204.0,
        end: 215.0,
        duration: 11.0,
      };
      expect(isEndOfTrackSegment(seg, 210.0)).toBe(true);
    });

    it("returns true when segment starts within threshold of the end", () => {
      const seg: SponsorSegment = {
        segmentId: "late-start-seg",
        category: "selfpromo",
        start: 208.0,
        end: 209.5,
        duration: 1.5,
      };
      expect(isEndOfTrackSegment(seg, 210.0)).toBe(true);
    });

    it("returns false for mid-track segments", () => {
      const midSeg: SponsorSegment = {
        segmentId: "mid-1",
        category: "sponsor",
        start: 60.0,
        end: 90.0,
        duration: 30.0,
      };
      expect(isEndOfTrackSegment(midSeg, 240.0)).toBe(false);
    });

    it("returns false when total duration is 0 and category is not outro and no videoDuration", () => {
      const midSeg: SponsorSegment = {
        segmentId: "mid-1",
        category: "sponsor",
        start: 60.0,
        end: 90.0,
        duration: 30.0,
      };
      expect(isEndOfTrackSegment(midSeg, 0)).toBe(false);
    });

    it("uses seg.videoDuration when totalDurationSec is 0 and recognizes end of track", () => {
      const endSeg: SponsorSegment = {
        segmentId: "end-sponsor",
        category: "sponsor",
        start: 306.865,
        end: 322.961,
        duration: 16.096,
        videoDuration: 323.201,
      };
      expect(isEndOfTrackSegment(endSeg, 0)).toBe(true);
    });
  });

  describe("getIntroOffsetSuggestion", () => {
    it("returns negative offset when music_offtopic starts near 0s", () => {
      const segs: SponsorSegment[] = [
        {
          segmentId: "offtopic-1",
          category: "music_offtopic",
          start: 0.0,
          end: 18.5,
          duration: 18.5,
        },
      ];
      expect(getIntroOffsetSuggestion(segs)).toBe(-18500);
    });

    it("returns negative offset when intro starts within tolerance (e.g. 1.2s)", () => {
      const segs: SponsorSegment[] = [
        {
          segmentId: "intro-1",
          category: "intro",
          start: 1.2,
          end: 12.0,
          duration: 10.8,
        },
      ];
      expect(getIntroOffsetSuggestion(segs)).toBe(-12000);
    });

    it("returns null when segments only contain mid-track sponsor", () => {
      const segs: SponsorSegment[] = [
        {
          segmentId: "mid-sponsor",
          category: "sponsor",
          start: 60.0,
          end: 90.0,
          duration: 30.0,
        },
      ];
      expect(getIntroOffsetSuggestion(segs)).toBeNull();
    });

    it("returns null when segments is undefined or empty", () => {
      expect(getIntroOffsetSuggestion(undefined)).toBeNull();
      expect(getIntroOffsetSuggestion([])).toBeNull();
    });

    it("returns null when intro duration is too short (< 2s)", () => {
      const segs: SponsorSegment[] = [
        {
          segmentId: "short-intro",
          category: "intro",
          start: 0.0,
          end: 1.0,
          duration: 1.0,
        },
      ];
      expect(getIntroOffsetSuggestion(segs)).toBeNull();
    });
  });
});

