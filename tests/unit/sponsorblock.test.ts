import { describe, it, expect } from "vitest";
import {
  findActiveSkipSegment,
  getCategoryLabel,
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
});
