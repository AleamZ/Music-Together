"use client";

import { useState } from "react";
import { addQueueItem, addQueueItems } from "@/lib/supabase";
import { parseYouTubeId, parsePlaylistId } from "@/lib/youtube/parse";
import { fetchVideoMeta } from "@/lib/youtube/meta";
import { fetchPlaylistItems } from "@/lib/youtube/playlist";

export default function AddSong({ roomId, token }: { roomId: string; token: string }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const videoId = parseYouTubeId(url);
    const playlistId = parsePlaylistId(url);
    if (!videoId && !playlistId) { setError("Link YouTube không hợp lệ."); return; }
    setBusy(true);
    try {
      if (!videoId && playlistId) {
        const items = await fetchPlaylistItems(playlistId);
        if (items.length === 0) { setError("Playlist trống hoặc không đọc được."); return; }
        const added = await addQueueItems(roomId, token, items);
        setNotice(`Đã thêm ${added} bài từ playlist.`);
        setUrl("");
      } else if (videoId) {
        const meta = await fetchVideoMeta(videoId);
        await addQueueItem(roomId, token, {
          videoId,
          title: meta?.title || videoId,
          thumb: meta?.thumbnail ?? null,
          duration: null,
        });
        setUrl("");
      }
    } catch (err) {
      setError((err as { message?: string }).message ?? "Không thêm được bài.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={add} className="mb-1 flex flex-wrap gap-2">
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Dán link YouTube (video hoặc playlist)…"
        className="flex-1 rounded-lg border border-gold bg-cream px-3 py-2 text-sm text-ink" />
      <button disabled={busy} className="rounded-lg bg-burgundy px-3 py-2 font-cormorant font-bold text-cream disabled:opacity-60">
        {busy ? "…" : "+ Thêm"}
      </button>
      {error && <p className="w-full text-xs text-burgundy-accent">{error}</p>}
      {notice && <p className="w-full text-xs text-burgundy">{notice}</p>}
    </form>
  );
}
