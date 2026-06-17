const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Extract the 11-char YouTube video id from any common URL form, or null. */
export function parseYouTubeId(input: string): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (YT_ID_RE.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const isYouTube =
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtube-nocookie.com" ||
    host === "youtu.be";
  if (!isYouTube) return null;

  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id && YT_ID_RE.test(id) ? id : null;
  }

  const v = url.searchParams.get("v");
  if (v && YT_ID_RE.test(v)) return v;

  const segs = url.pathname.split("/").filter(Boolean);
  if (segs.length >= 2 && ["shorts", "embed", "live", "v"].includes(segs[0])) {
    return YT_ID_RE.test(segs[1]) ? segs[1] : null;
  }
  return null;
}

/** Start time (seconds) from ?t=90 / ?t=1m30s / ?start=90. Defaults to 0. */
export function parseYouTubeStart(input: string): number {
  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    const t = url.searchParams.get("t") ?? url.searchParams.get("start") ?? "";
    if (!t) return 0;
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    const m = t.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i);
    if (!m) return 0;
    const [, h, mi, s] = m;
    return (+(h || 0)) * 3600 + (+(mi || 0)) * 60 + (+(s || 0));
  } catch {
    return 0;
  }
}

const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]+$/;

/** Extract the `list` playlist id from any common YouTube URL form, or null. */
export function parsePlaylistId(input: string): string | null {
  if (!input) return null;
  const raw = input.trim();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const isYouTube =
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtube-nocookie.com" ||
    host === "youtu.be";
  if (!isYouTube) return null;
  const list = url.searchParams.get("list");
  return list && PLAYLIST_ID_RE.test(list) ? list : null;
}
