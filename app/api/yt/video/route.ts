import { parseYouTubeId } from "@/lib/youtube/parse";
import { extractVideoDetails } from "@/lib/youtube/video";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Key-free video details (title, author, duration) read from the public watch page. */
export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const id = parseYouTubeId(searchParams.get("id") ?? "");
  if (!id) return Response.json({ error: "Invalid YouTube id" }, { status: 400 });
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, {
      // CONSENT cookie skips YouTube's consent interstitial that a cookieless datacenter request may get.
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Cookie: "CONSENT=YES+1" },
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return Response.json({ error: "Video fetch failed" }, { status: 502 });
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > 5_000_000) return Response.json({ error: "Page too large" }, { status: 502 });
    const details = extractVideoDetails(await res.text());
    if (!details || details.id !== id) return Response.json({ error: "Video not found" }, { status: 404 });
    return Response.json(details);
  } catch {
    return Response.json({ error: "Video request error" }, { status: 502 });
  }
}
