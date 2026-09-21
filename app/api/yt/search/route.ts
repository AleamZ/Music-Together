import { extractSearchResults } from "@/lib/youtube/search";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
// Bump here if YouTube starts rejecting the version.
const INNERTUBE_CLIENT_VERSION = "2.20260918.00.00";
// YouTube's "Type: Video" search filter — no channels / playlists / mixed shelves.
const VIDEO_FILTER = "EgIQAQ==";
const MAX_Q = 100;
const CAP = 20;

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (!q || q.length > MAX_Q) return Response.json({ error: "Invalid query" }, { status: 400 });
  try {
    const res = await fetch("https://www.youtube.com/youtubei/v1/search?prettyPrint=false", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": UA,
        "Accept-Language": "vi,en;q=0.8",
        "X-YouTube-Client-Name": "1",
        "X-YouTube-Client-Version": INNERTUBE_CLIENT_VERSION,
        Origin: "https://www.youtube.com",
        // CONSENT cookie skips YouTube's consent interstitial that a cookieless
        // datacenter (e.g. Vercel) request may otherwise get. Not a user credential.
        Cookie: "CONSENT=YES+1",
      },
      body: JSON.stringify({
        context: { client: { hl: "vi", gl: "VN", clientName: "WEB", clientVersion: INNERTUBE_CLIENT_VERSION } },
        query: q,
        params: VIDEO_FILTER,
      }),
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return Response.json({ error: "Search failed" }, { status: 502 });
    const data: unknown = await res.json();
    return Response.json({ results: extractSearchResults(data, CAP) });
  } catch {
    return Response.json({ error: "Search failed" }, { status: 502 });
  }
}
