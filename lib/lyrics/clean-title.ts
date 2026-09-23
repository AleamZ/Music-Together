/**
 * Normalizes YouTube video titles for lyrics lookups by stripping bracketed metadata,
 * common video qualifiers, and extracting artist/track names when separated by delimiters.
 */

export interface CleanedTitleResult {
  trackName: string;
  artistName?: string;
  cleanQuery: string;
}

// Common patterns in brackets or standalone qualifiers
const BRACKETED_KEYWORDS = [
  "official",
  "music video",
  "audio",
  "mv",
  "lyric video",
  "lyrics video",
  "lyrics",
  "visualizer",
  "teaser",
  "live",
  "full album",
  "vietsub",
  "karaoke",
  "beat",
  "instrumental",
  "hd",
  "4k",
  "remastered",
];

export function cleanYouTubeTitle(rawTitle: string): CleanedTitleResult {
  if (!rawTitle || typeof rawTitle !== "string") {
    return { trackName: "", cleanQuery: "" };
  }

  let cleaned = rawTitle;

  // 1. Remove bracketed content containing music video qualifiers
  cleaned = cleaned.replace(/[[({][^\])}]*[\])}]/g, (match) => {
    const lower = match.toLowerCase();
    const isJunk = BRACKETED_KEYWORDS.some((kw) => lower.includes(kw));
    return isJunk ? " " : match;
  });

  // 2. Remove trailing pipe expressions e.g. "| OFFICIAL MUSIC VIDEO"
  cleaned = cleaned.replace(/\|\s*.*$/g, " ");

  // 3. Remove standalone keywords
  cleaned = cleaned.replace(/\b(official\s*(music|lyric(s)?)?\s*(video|mv|audio)?|visualizer|vietsub)\b/gi, " ");

  // 4. Remove leftover quote marks and extra spaces
  cleaned = cleaned
    .replace(/["“”'‘’]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  // 5. Look for standard artist-track delimiter (requires whitespace around dashes so intra-word dashes like "M-TP" or "Jay-Z" are preserved)
  const delimiterMatch = cleaned.match(/\s+[-–—]\s+|\s*:\s+/);

  if (delimiterMatch && delimiterMatch.index !== undefined) {
    const idx = delimiterMatch.index;
    const delimLength = delimiterMatch[0].length;
    const candidateArtist = cleaned.slice(0, idx).trim();
    let candidateTrack = cleaned.slice(idx + delimLength).trim();

    candidateTrack = candidateTrack.replace(/\|\s*.*$/, "").trim();

    if (candidateArtist && candidateTrack) {
      const cleanQuery = `${candidateArtist} ${candidateTrack}`.trim();
      return {
        artistName: candidateArtist,
        trackName: candidateTrack,
        cleanQuery: cleanQuery || cleaned,
      };
    }
  }

  return {
    trackName: cleaned,
    cleanQuery: cleaned,
  };
}
