export interface PlaylistItem { videoId: string; title: string; thumb: string; }

function sliceBalancedJson(s: string, start: number): string | null {
  if (s[start] !== "{") return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}

function extractYtInitialData(html: string): unknown {
  const markers = ['var ytInitialData = ', 'window["ytInitialData"] = ', "ytInitialData = "];
  for (const marker of markers) {
    const i = html.indexOf(marker);
    if (i === -1) continue;
    const json = sliceBalancedJson(html, i + marker.length);
    if (!json) continue;
    try { return JSON.parse(json); } catch { /* try next marker */ }
  }
  return null;
}

// Legacy playlist layout entry.
type VideoRenderer = {
  videoId?: unknown;
  title?: { runs?: Array<{ text?: unknown }>; simpleText?: unknown };
};
// Current playlist layout entry (the "lockup" component).
type LockupViewModel = {
  contentId?: unknown;
  contentType?: unknown;
  metadata?: { lockupMetadataViewModel?: { title?: { content?: unknown } } };
};

/** Pure: parse a YouTube playlist page's HTML into queue items (in order, deduped, capped).
 *  Handles BOTH the legacy `playlistVideoRenderer` and the current `lockupViewModel`
 *  layouts (YouTube migrated playlist videos to lockups). Thumb is derived from the
 *  videoId (hqdefault always exists). Fails soft to []. */
export function extractPlaylistItems(html: string, cap = 50): PlaylistItem[] {
  const data = extractYtInitialData(html);
  if (!data) return [];
  const out: PlaylistItem[] = [];
  const seen = new Set<string>();
  const add = (videoId: string, title: string): void => {
    if (!videoId || seen.has(videoId)) return;
    seen.add(videoId);
    out.push({ videoId, title, thumb: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` });
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
      add(videoId, title);
      return;
    }
    const lvm = obj.lockupViewModel as LockupViewModel | undefined;
    if (lvm && typeof lvm === "object" && lvm.contentType === "LOCKUP_CONTENT_TYPE_VIDEO") {
      const videoId = typeof lvm.contentId === "string" ? lvm.contentId : "";
      const content = lvm.metadata?.lockupMetadataViewModel?.title?.content;
      const title = typeof content === "string" ? content : "";
      add(videoId, title);
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
