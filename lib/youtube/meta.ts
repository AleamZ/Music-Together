import { parseYouTubeId } from "@/lib/youtube/parse";

export interface VideoMeta { id: string; title: string; author: string; thumbnail: string; }

export function youTubeThumbnail(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

/** Keyless title + thumbnail. Order: same-origin proxy -> noembed -> thumbnail-only. */
export async function fetchVideoMeta(videoIdOrUrl: string, signal?: AbortSignal): Promise<VideoMeta | null> {
  const id = parseYouTubeId(videoIdOrUrl);
  if (!id) return null;

  try {
    const res = await fetch(`/api/oembed?id=${id}`, { signal });
    if (res.ok) {
      const d = (await res.json()) as Partial<VideoMeta>;
      if (d.title) return { id, title: d.title, author: d.author ?? "", thumbnail: d.thumbnail ?? youTubeThumbnail(id) };
    }
  } catch { /* fall through */ }

  try {
    const url = `https://noembed.com/embed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`;
    const res = await fetch(url, { signal });
    if (res.ok) {
      const d = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string; error?: string };
      if (d.title && !d.error) return { id, title: d.title, author: d.author_name ?? "", thumbnail: d.thumbnail_url ?? youTubeThumbnail(id) };
    }
  } catch { /* fall through */ }

  return { id, title: "", author: "", thumbnail: youTubeThumbnail(id) };
}
