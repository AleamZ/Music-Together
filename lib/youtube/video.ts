import { extractEmbeddedJson } from "@/lib/youtube/embedded-json";

export interface VideoDetails {
  id: string;
  title: string;
  author: string;
  durationSeconds: number | null;
  isLive: boolean;
}

type PlayerResponse = {
  videoDetails?: { videoId?: unknown; title?: unknown; author?: unknown; lengthSeconds?: unknown; isLive?: unknown };
  microformat?: { playerMicroformatRenderer?: { liveBroadcastDetails?: { isLiveNow?: unknown } } };
};

const MARKERS = ["var ytInitialPlayerResponse = ", 'window["ytInitialPlayerResponse"] = ', "ytInitialPlayerResponse = "];

/** Pure: read `videoDetails` out of a watch page. A currently-live stream (or a zero length) has no duration.
 *  "Live" = `videoDetails.isLive` OR `microformat.…liveBroadcastDetails.isLiveNow` — YouTube often sets only the latter
 *  (and reports the stream's elapsed time as `lengthSeconds`). `isLiveContent` is deliberately ignored: a finished
 *  stream is a normal VOD with a real length. Fails soft to null. */
export function extractVideoDetails(html: string): VideoDetails | null {
  const data = extractEmbeddedJson(html, MARKERS) as PlayerResponse | null;
  const vd = data?.videoDetails;
  if (!vd || typeof vd.videoId !== "string" || !vd.videoId) return null;
  const isLive = vd.isLive === true || data?.microformat?.playerMicroformatRenderer?.liveBroadcastDetails?.isLiveNow === true;
  const raw = vd.lengthSeconds;
  const len = typeof raw === "string" ? parseInt(raw, 10) : typeof raw === "number" ? raw : NaN;
  const durationSeconds = !isLive && Number.isFinite(len) && len > 0 ? len : null;
  return {
    id: vd.videoId,
    title: typeof vd.title === "string" ? vd.title : "",
    author: typeof vd.author === "string" ? vd.author : "",
    durationSeconds,
    isLive,
  };
}

/** Client: video details via the same-origin route. Resolves null on any failure (AbortError passes through). */
export async function fetchVideoDetails(id: string, signal?: AbortSignal): Promise<VideoDetails | null> {
  try {
    const res = await fetch(`/api/yt/video?id=${encodeURIComponent(id)}`, { signal });
    if (!res.ok) return null;
    return (await res.json()) as VideoDetails;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return null;
  }
}
