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
