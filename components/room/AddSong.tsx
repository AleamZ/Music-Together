"use client";

import { useState } from "react";
import { addQueueItem } from "@/lib/supabase";
import { parseYouTubeId } from "@/lib/youtube/parse";
import { fetchVideoMeta } from "@/lib/youtube/meta";
import type { Identity } from "@/lib/identity";

export default function AddSong({ identity }: { identity: Identity }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const id = parseYouTubeId(url);
    if (!id) { setError("Link YouTube không hợp lệ."); return; }
    setBusy(true);
    try {
      const meta = await fetchVideoMeta(id);
      await addQueueItem(identity, {
        videoId: id,
        title: meta?.title || id,
        thumb: meta?.thumbnail ?? null,
        duration: null,
      });
      setUrl("");
    } catch (err) {
      setError((err as { message?: string }).message ?? "Không thêm được bài.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={add} className="mb-1 flex gap-2">
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Dán link YouTube để thêm bài…"
        className="flex-1 rounded-lg border border-gold bg-cream px-3 py-2 text-sm text-ink" />
      <button disabled={busy} className="rounded-lg bg-burgundy px-3 py-2 font-cormorant font-bold text-cream disabled:opacity-60">
        {busy ? "…" : "+ Thêm"}
      </button>
      {error && <p className="w-full text-xs text-burgundy-accent">{error}</p>}
    </form>
  );
}
