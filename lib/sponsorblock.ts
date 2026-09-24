export type SponsorCategory =
  | "sponsor"
  | "selfpromo"
  | "music_offtopic"
  | "interaction"
  | "intro"
  | "outro"
  | "preview"
  | "filler";

export const DEFAULT_SKIPPABLE_CATEGORIES: SponsorCategory[] = [
  "sponsor",
  "selfpromo",
  "music_offtopic",
];

export interface SponsorSegment {
  segmentId: string;
  category: string;
  start: number; // in seconds
  end: number; // in seconds
  duration: number; // in seconds
}

export interface SponsorBlockApiResponse {
  segments: SponsorSegment[];
  cached?: boolean;
}

/**
 * Returns a human-friendly Vietnamese label for a SponsorBlock category.
 */
export function getCategoryLabel(category: string): string {
  switch (category) {
    case "sponsor":
      return "Quảng cáo tài trợ";
    case "selfpromo":
      return "Quảng bá / Hội viên";
    case "music_offtopic":
      return "Đoạn thoại ngoài lề";
    case "interaction":
      return "Kêu gọi tương tác";
    default:
      return "Quảng cáo";
  }
}

/**
 * Finds a skippable segment that covers the current playback position.
 * Uses a small tolerance margin and checks against already skipped segment IDs to prevent repeat seeks.
 */
export function findActiveSkipSegment(
  currentSec: number,
  segments: SponsorSegment[],
  skippedIds: ReadonlySet<string>,
  toleranceSec = 0.2
): SponsorSegment | null {
  if (!segments || segments.length === 0) return null;

  for (const seg of segments) {
    if (skippedIds.has(seg.segmentId)) continue;

    // Check if the current time is within [start - tolerance, end - tolerance]
    // We stop skipping when close to the end (within 0.5s) to avoid micro-seeks
    if (currentSec >= seg.start - toleranceSec && currentSec < seg.end - 0.5) {
      return seg;
    }
  }

  return null;
}

/**
 * Determines if a sponsor segment extends to or near the end of the track.
 * If true, playback should advance to the next track instead of seeking within the current track.
 */
export function isEndOfTrackSegment(
  seg: SponsorSegment,
  totalDurationSec: number,
  thresholdSec = 3
): boolean {
  if (seg.category === "outro") return true;
  if (totalDurationSec <= 0) return false;
  return (
    seg.end >= totalDurationSec - thresholdSec ||
    seg.start >= totalDurationSec - thresholdSec
  );
}

/**
 * Detects if there is an intro or offtopic dialogue segment at the beginning of the video.
 * Returns the suggested negative offset in milliseconds if found (e.g. -18500 for an 18.5s intro).
 */
export function getIntroOffsetSuggestion(
  segments?: SponsorSegment[],
  toleranceStartSec = 3.0,
  minDurationSec = 2.0
): number | null {
  if (!segments || segments.length === 0) return null;

  for (const seg of segments) {
    if (
      seg.start <= toleranceStartSec &&
      (seg.category === "music_offtopic" ||
        seg.category === "intro" ||
        seg.category === "sponsor" ||
        seg.category === "selfpromo") &&
      seg.end >= minDurationSec
    ) {
      return -Math.round(seg.end * 1000);
    }
  }

  return null;
}


