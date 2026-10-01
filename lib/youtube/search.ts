export interface SearchResult {
  videoId: string;
  title: string;
  channel: string;
  durationText: string | null;
  durationSeconds: number | null;
  thumb: string;
}

/** "4:32" → 272, "1:02:15" → 3735; anything else (LIVE, "", undefined) → null. */
export function parseDurationText(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(s.trim());
  if (!m) return null;
  const [, a, b, c] = m;
  return c === undefined ? +a * 60 + +b : +a * 3600 + +b * 60 + +c;
}

type Runs = { runs?: Array<{ text?: unknown }>; simpleText?: unknown };
type VideoRenderer = {
  videoId?: unknown;
  title?: Runs;
  ownerText?: Runs;
  longBylineText?: Runs;
  lengthText?: { simpleText?: unknown };
};

function firstRun(r: Runs | undefined): string {
  const t = r?.runs?.[0]?.text;
  if (typeof t === "string") return t;
  return typeof r?.simpleText === "string" ? r.simpleText : "";
}

/** Pure: walk an InnerTube search response and collect every `videoRenderer`
 *  (in document order, deduped, capped). Thumb is derived from the id so we never
 *  depend on YouTube's signed thumbnail URLs. Fails soft to []. */
export function extractSearchResults(data: unknown, cap = 20): SearchResult[] {
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown): void => {
    if (out.length >= cap || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const v of node) { if (out.length >= cap) return; walk(v); }
      return;
    }
    const obj = node as Record<string, unknown>;
    const vr = obj.videoRenderer as VideoRenderer | undefined;
    if (vr && typeof vr === "object") {
      const videoId = typeof vr.videoId === "string" ? vr.videoId : "";
      if (videoId && !seen.has(videoId)) {
        seen.add(videoId);
        const lt = vr.lengthText?.simpleText;
        const durationText = typeof lt === "string" && lt ? lt : null;
        out.push({
          videoId,
          title: firstRun(vr.title),
          channel: firstRun(vr.ownerText) || firstRun(vr.longBylineText),
          durationText,
          durationSeconds: parseDurationText(durationText),
          thumb: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
        });
      }
      return; // a videoRenderer is a leaf for our purposes — don't descend
    }
    for (const v of Object.values(obj)) { if (out.length >= cap) return; walk(v); }
  };
  try { walk(data); } catch { return []; }
  return out;
}

/** Pure: find the next-page continuation token inside an InnerTube search response. */
export function extractContinuationToken(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  const cir = obj.continuationItemRenderer as
    | {
        token?: unknown;
        continuationEndpoint?: { continuationCommand?: { token?: unknown } };
      }
    | undefined;
  if (cir && typeof cir === "object") {
    const token =
      (typeof cir.token === "string" && cir.token) ||
      (typeof cir.continuationEndpoint?.continuationCommand?.token === "string" &&
        cir.continuationEndpoint.continuationCommand.token);
    if (token) return token;
  }
  if (Array.isArray(data)) {
    for (const v of data) {
      const found = extractContinuationToken(v);
      if (found) return found;
    }
    return null;
  }
  for (const v of Object.values(obj)) {
    const found = extractContinuationToken(v);
    if (found) return found;
  }
  return null;
}

export interface SearchResponse {
  results: SearchResult[];
  continuation: string | null;
}

/** Client: search via the same-origin route. Throws on failure (AbortError passes through). */
export async function fetchSearchResults(
  q: string,
  signal?: AbortSignal,
  continuation?: string | null,
): Promise<SearchResponse> {
  const url = continuation
    ? `/api/yt/search?continuation=${encodeURIComponent(continuation)}`
    : `/api/yt/search?q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(d.error ?? "Không tìm được");
  }
  const d = (await res.json()) as { results?: SearchResult[]; continuation?: string | null };
  return {
    results: d.results ?? [],
    continuation: d.continuation ?? null,
  };
}
