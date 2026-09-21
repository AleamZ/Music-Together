import { extractEmbeddedJson } from "@/lib/youtube/embedded-json";
import { parseDurationText } from "@/lib/youtube/search";

export interface PlaylistItem { videoId: string; title: string; thumb: string; durationSeconds: number | null; }

const YT_INITIAL_DATA_MARKERS = ['var ytInitialData = ', 'window["ytInitialData"] = ', "ytInitialData = "];

// Legacy playlist layout entry.
type VideoRenderer = {
  videoId?: unknown;
  title?: { runs?: Array<{ text?: unknown }>; simpleText?: unknown };
  lengthSeconds?: unknown;
  lengthText?: { simpleText?: unknown };
};
// Current playlist layout entry (the "lockup" component).
type LockupViewModel = {
  contentId?: unknown;
  contentType?: unknown;
  contentImage?: unknown;
  metadata?: { lockupMetadataViewModel?: { title?: { content?: unknown } } };
};

const CLOCK_RE = /^\d{1,2}(?::\d{2}){1,2}$/;

/** Depth-limited search for the first "m:ss" / "h:mm:ss" string under a node (the lockup's duration badge). */
function findClockText(node: unknown, depth = 8): string | null {
  if (depth < 0 || node === null || typeof node !== "object") return null;
  for (const v of Object.values(node as Record<string, unknown>)) {
    if (typeof v === "string") { if (CLOCK_RE.test(v)) return v; }
    else if (typeof v === "object") { const hit = findClockText(v, depth - 1); if (hit) return hit; }
  }
  return null;
}

/** Pure: parse a YouTube playlist page's HTML into queue items (in order, deduped, capped).
 *  Handles BOTH the legacy `playlistVideoRenderer` and the current `lockupViewModel`
 *  layouts (YouTube migrated playlist videos to lockups). Thumb is derived from the
 *  videoId (hqdefault always exists). Fails soft to []. */
export function extractPlaylistItems(html: string, cap = 50): PlaylistItem[] {
  const data = extractEmbeddedJson(html, YT_INITIAL_DATA_MARKERS);
  if (!data) return [];
  const out: PlaylistItem[] = [];
  const seen = new Set<string>();
  const add = (videoId: string, title: string, durationSeconds: number | null): void => {
    if (!videoId || seen.has(videoId)) return;
    seen.add(videoId);
    out.push({ videoId, title, thumb: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, durationSeconds });
  };
  const walk = (node: unknown): void => {
    if (out.length >= cap || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const v of node) { if (out.length >= cap) return; walk(v); }
      return;
    }
    const obj = node as Record<string, unknown>;
    const pvr = obj.playlistVideoRenderer as VideoRenderer | undefined;
    if (pvr && typeof pvr === "object") {
      const videoId = typeof pvr.videoId === "string" ? pvr.videoId : "";
      const runText = pvr.title?.runs?.[0]?.text;
      const title = typeof runText === "string" ? runText
        : typeof pvr.title?.simpleText === "string" ? pvr.title.simpleText : "";
      const secs = typeof pvr.lengthSeconds === "string" ? parseInt(pvr.lengthSeconds, 10) : NaN;
      const lt = pvr.lengthText?.simpleText;
      const durationSeconds = Number.isFinite(secs) && secs > 0 ? secs : parseDurationText(typeof lt === "string" ? lt : null);
      add(videoId, title, durationSeconds);
      return;
    }
    const lvm = obj.lockupViewModel as LockupViewModel | undefined;
    if (lvm && typeof lvm === "object" && lvm.contentType === "LOCKUP_CONTENT_TYPE_VIDEO") {
      const videoId = typeof lvm.contentId === "string" ? lvm.contentId : "";
      const content = lvm.metadata?.lockupMetadataViewModel?.title?.content;
      const title = typeof content === "string" ? content : "";
      add(videoId, title, parseDurationText(findClockText(lvm.contentImage)));
      return;
    }
    for (const v of Object.values(obj)) { if (out.length >= cap) return; walk(v); }
  };
  walk(data);
  return out;
}

/** Client: fetch + enumerate a playlist via the same-origin route. Throws on failure. */
export async function fetchPlaylistItems(listId: string): Promise<PlaylistItem[]> {
  const res = await fetch(`/api/playlist?list=${encodeURIComponent(listId)}`);
  if (!res.ok) {
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(d.error ?? "Không đọc được playlist");
  }
  const d = (await res.json()) as { items?: PlaylistItem[] };
  return d.items ?? [];
}
