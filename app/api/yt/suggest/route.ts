import { parseSuggestJsonp } from "@/lib/youtube/suggest";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MAX_Q = 100;
const CAP = 10;

/** Suggestions are a convenience: every failure path answers 200 with an empty list. */
export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (!q || q.length > MAX_Q) return Response.json({ suggestions: [] });
  const url =
    "https://suggestqueries-clients6.youtube.com/complete/search" +
    `?client=youtube&ds=yt&hl=vi&gl=vn&gs_ri=youtube&q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "vi,en;q=0.8" },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return Response.json({ suggestions: [] });
    return Response.json({ suggestions: parseSuggestJsonp(await res.text(), CAP) });
  } catch {
    return Response.json({ suggestions: [] });
  }
}
