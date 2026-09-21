"use client";

import { useState } from "react";
import { approveAllPending, approveQueueItem, rejectQueueItem, type QueueItem } from "@/lib/supabase";

const FAIL = "Thao tác không thành công, thử lại nhé.";

function Spinner() {
  return <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-burgundy border-t-transparent align-middle" />;
}

/** Admin/DJ panel: songs waiting for approval. */
export default function PendingQueue({ pending, roomId, token }: { pending: QueueItem[]; roomId: string; token: string }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try { await fn(); } catch { setError(FAIL); } finally { setBusyId(null); }
  }
  async function approveAll() {
    setBusyAll(true);
    setError(null);
    try { await approveAllPending(roomId, token); } catch { setError(FAIL); } finally { setBusyAll(false); }
  }

  return (
    <div className="mb-3 rounded-lg border border-gold-200 bg-cream/60 p-2">
      <div className="mb-1 flex items-center justify-between gap-2 font-cormorant text-burgundy">
        <span>⏳ Chờ duyệt <span className="text-xs text-ink/60">· {pending.length}</span></span>
        <button type="button" disabled={pending.length === 0 || busyAll} onClick={approveAll}
          className="rounded border border-gold-200 bg-cream px-2 text-xs text-burgundy disabled:opacity-60">
          {busyAll ? "…" : "Duyệt tất cả"}
        </button>
      </div>
      {error && <p className="mb-1 text-xs text-burgundy-accent">{error}</p>}
      {pending.length === 0 && <p className="text-sm text-ink/60">Không có bài chờ duyệt.</p>}
      <ul className="max-h-[35vh] overflow-y-auto pr-1">
        {pending.map((q) => {
          const busy = busyId === q.id || busyAll;
          return (
            <li key={q.id} className={`flex items-center gap-2 border-b border-dotted border-gold-200 py-2 ${busy ? "opacity-60" : ""}`}>
              {q.thumbnail_url
                // eslint-disable-next-line @next/next/no-img-element -- YouTube CDN thumb; next/image optimization isn't worth its cost here
                ? <img src={q.thumbnail_url} alt="" className="h-9 w-12 rounded object-cover" />
                : <span className="flex h-9 w-12 items-center justify-center rounded bg-burgundy text-cream">▶</span>}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink">{q.title || q.youtube_video_id}</div>
                <div className="text-[11px] text-gold">do {q.added_by_name}</div>
              </div>
              <div className="flex w-14 items-center justify-end gap-1">
                {busy ? <Spinner /> : (
                  <>
                    <button title="Duyệt" onClick={() => run(q.id, () => approveQueueItem(roomId, token, q.id))}
                      className="rounded border border-gold-200 bg-cream px-1.5 text-sm text-burgundy">✓</button>
                    <button title="Từ chối" onClick={() => run(q.id, () => rejectQueueItem(roomId, token, q.id))}
                      className="rounded border border-gold-200 bg-cream px-1.5 text-sm text-burgundy-accent">✕</button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
