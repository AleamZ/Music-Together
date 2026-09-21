export interface Suggestion {
  text: string;
  videoId?: string;
  thumb?: string;
}

const CALLBACK = "window.google.ac.h";

/** Pure: parse YouTube's suggest JSONP (`window.google.ac.h([q, [[text, type, flags, meta?], …], …])`)
 *  into deduped, capped suggestions. `meta.zal` = video id, `meta.zai` = thumbnail. Fails soft to []. */
export function parseSuggestJsonp(text: string, cap = 10): Suggestion[] {
  const at = text.indexOf(CALLBACK);
  if (at === -1) return [];
  const open = text.indexOf("(", at + CALLBACK.length);
  const close = text.lastIndexOf(")");
  if (open === -1 || close <= open) return [];
  let payload: unknown;
  try { payload = JSON.parse(text.slice(open + 1, close)); } catch { return []; }
  if (!Array.isArray(payload) || !Array.isArray(payload[1])) return [];

  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (const entry of payload[1] as unknown[]) {
    if (out.length >= cap) break;
    if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
    const t = entry[0].trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const s: Suggestion = { text: t };
    const meta = entry[3];
    if (meta && typeof meta === "object") {
      const { zal, zai } = meta as { zal?: unknown; zai?: unknown };
      if (typeof zal === "string" && zal) s.videoId = zal;
      if (typeof zai === "string" && zai) s.thumb = zai;
    }
    out.push(s);
  }
  return out;
}

/** Client: suggestions via the same-origin route. Never throws except AbortError; failures → []. */
export async function fetchSuggestions(q: string, signal?: AbortSignal): Promise<Suggestion[]> {
  try {
    const res = await fetch(`/api/yt/suggest?q=${encodeURIComponent(q)}`, { signal });
    if (!res.ok) return [];
    const d = (await res.json()) as { suggestions?: Suggestion[] };
    return d.suggestions ?? [];
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return [];
  }
}
