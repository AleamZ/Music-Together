"use client";

import { useState } from "react";
import { deleteItem, type QueueItem } from "@/lib/supabase";

function Spinner() {
  return <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-burgundy border-t-transparent align-middle" />;
}

/** A member's own songs still waiting for approval; each can be withdrawn. Renders nothing when empty. */
export default function MyPending({ items, roomId, token }: { items: QueueItem[]; roomId: string; token: string }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (items.length === 0) return null;

  async function withdraw(id: string) {
    setBusyId(id);
    setError(null);
    try { await deleteItem(roomId, token, id); } catch { setError("Thao tác không thành công, thử lại nhé."); } finally { setBusyId(null); }
  }

  return (
    <div className="mb-3 rounded-lg border border-gold-200 bg-cream/60 p-2">
      <div className="mb-1 font-cormorant text-burgundy">⏳ Đang chờ duyệt <span className="text-xs text-ink/60">· {items.length}</span></div>
      {error && <p className="mb-1 text-xs text-burgundy-accent">{error}</p>}
      <ul className="max-h-[30vh] overflow-y-auto pr-1">
        {items.map((q) => {
          const busy = busyId === q.id;
          return (
            <li key={q.id} className={`flex items-center gap-2 border-b border-dotted border-gold-200 py-2 ${busy ? "opacity-60" : ""}`}>
              {q.thumbnail_url
                // eslint-disable-next-line @next/next/no-img-element -- YouTube CDN thumb; next/image optimization isn't worth its cost here
                ? <img src={q.thumbnail_url} alt="" className="h-9 w-12 rounded object-cover" />
                : <span className="flex h-9 w-12 items-center justify-center rounded bg-burgundy text-cream">▶</span>}
              <div className="min-w-0 flex-1 truncate text-sm text-ink">{q.title || q.youtube_video_id}</div>
              {busy ? <Spinner /> : (
                <button title="Rút lại" onClick={() => withdraw(q.id)}
                  className="rounded border border-gold-200 bg-cream px-1.5 text-sm text-burgundy">✕</button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
