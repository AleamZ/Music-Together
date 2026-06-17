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

type Renderer = {
  videoId?: unknown;
  title?: { runs?: Array<{ text?: unknown }>; simpleText?: unknown };
  thumbnail?: { thumbnails?: Array<{ url?: unknown }> };
};

function collectRenderers(node: unknown, out: Renderer[]): void {
  if (Array.isArray(node)) { for (const v of node) collectRenderers(v, out); return; }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "playlistVideoRenderer" && v && typeof v === "object") out.push(v as Renderer);
      else collectRenderers(v, out);
    }
  }
}

/** Pure: parse a YouTube playlist page's HTML into queue items (in order, capped). Fails soft to []. */
export function extractPlaylistItems(html: string, cap = 50): PlaylistItem[] {
  const data = extractYtInitialData(html);
  if (!data) return [];
  const renderers: Renderer[] = [];
  collectRenderers(data, renderers);
  const out: PlaylistItem[] = [];
  for (const r of renderers) {
    const videoId = typeof r.videoId === "string" ? r.videoId : "";
    if (!videoId) continue;
    const runText = r.title?.runs?.[0]?.text;
    const title = typeof runText === "string" ? runText
      : typeof r.title?.simpleText === "string" ? r.title.simpleText : "";
    const thumbs = r.thumbnail?.thumbnails;
    const lastUrl = Array.isArray(thumbs) && thumbs.length ? thumbs[thumbs.length - 1]?.url : undefined;
    const thumb = typeof lastUrl === "string" ? lastUrl : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    out.push({ videoId, title, thumb });
    if (out.length >= cap) break;
  }
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
