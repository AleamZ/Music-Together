import { extractPlaylistItems } from "@/lib/youtube/playlist";

const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]+$/;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const list = (searchParams.get("list") ?? "").trim();
  if (!list || !PLAYLIST_ID_RE.test(list)) {
    return Response.json({ error: "Invalid playlist id" }, { status: 400 });
  }
  const url = `https://www.youtube.com/playlist?list=${encodeURIComponent(list)}&hl=en`;
  try {
    const res = await fetch(url, {
      // CONSENT cookie skips YouTube's EU/consent interstitial that a cookieless
      // datacenter (e.g. Vercel) request otherwise gets instead of the playlist.
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Cookie: "CONSENT=YES+1" },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return Response.json({ error: "Playlist fetch failed" }, { status: 502 });
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > 5_000_000) return Response.json({ error: "Playlist too large" }, { status: 502 });
    const html = await res.text();
    const items = extractPlaylistItems(html, 50);
    if (items.length === 0) return Response.json({ error: "Playlist trống hoặc không đọc được" }, { status: 404 });
    return Response.json({ items });
  } catch {
    return Response.json({ error: "Playlist request error" }, { status: 502 });
  }
}
