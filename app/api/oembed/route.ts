import { parseYouTubeId } from "@/lib/youtube/parse";

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const id = parseYouTubeId(searchParams.get("id") ?? searchParams.get("url") ?? "");
  if (!id) return Response.json({ error: "Invalid YouTube id/url" }, { status: 400 });

  const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${id}`,
  )}&format=json`;

  try {
    const res = await fetch(oembed, { headers: { Accept: "application/json" }, next: { revalidate: 86400 } });
    if (!res.ok) return Response.json({ error: "oEmbed lookup failed" }, { status: 502 });
    const data = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
    return Response.json({
      id,
      title: data.title ?? "",
      author: data.author_name ?? "",
      thumbnail: data.thumbnail_url ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    });
  } catch {
    return Response.json({ error: "oEmbed request error" }, { status: 502 });
  }
}
