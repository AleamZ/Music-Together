"use client";

import { useState } from "react";
import { bumpToTop, deleteItem, reorderItem, type QueueItem } from "@/lib/supabase";
import { positionBetween } from "@/lib/queue";

function Spinner() {
  return <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-burgundy border-t-transparent align-middle" />;
}

export default function Queue({ queue, currentId, canManage, roomId, token }: {
  queue: QueueItem[]; currentId: string | null; canManage: boolean; roomId: string; token: string;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const upcoming = queue.filter((q) => q.id !== currentId);

  async function run(id: string, fn: () => Promise<void>) {
    setBusyId(id);
    setError(null);
    try { await fn(); }
    catch { setError("Thao tác không thành công, thử lại nhé."); }
    finally { setBusyId(null); }
  }

  async function dropOn(target: QueueItem) {
    if (!dragId || dragId === target.id) return;
    const idx = upcoming.findIndex((q) => q.id === target.id);
    const before = upcoming[idx - 1]?.position ?? null;
    const newPos = positionBetween(before, target.position);
    const id = dragId;
    setDragId(null);
    await run(id, () => reorderItem(roomId, token, id, newPos));
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-1">
        <h3 className="font-cormorant text-lg text-burgundy">
          Hàng đợi <span className="text-xs text-ink/60">({upcoming.length} bài)</span>
        </h3>
        {canManage ? (
          <span className="text-[10px] text-gold/90 font-medium">⠿ Kéo thả để xếp bài</span>
        ) : (
          <span className="text-[10px] text-ink/50 italic" title="Chỉ DJ hoặc Admin mới có quyền đổi thứ tự hoặc xóa bài trong hàng đợi">
            🔒 DJ / Admin quản lý
          </span>
        )}
      </div>
      {upcoming.length === 0 && <p className="text-sm text-ink/60">Chưa có bài nào trong hàng đợi.</p>}
      {error && <p className="mb-1 text-xs text-burgundy-accent">{error}</p>}
      <ul className="max-h-[65vh] overflow-y-auto pr-1">
        {upcoming.map((q) => {
          const busy = busyId === q.id;
          return (
            <li key={q.id}
              draggable={canManage && !busy}
              onDragStart={() => setDragId(q.id)}
              onDragOver={(e) => canManage && e.preventDefault()}
              onDrop={() => dropOn(q)}
              className={`flex items-center gap-2 border-b border-dotted border-gold-200/50 py-2.5 transition-colors hover:bg-gold-200/5 ${busy ? "opacity-60" : ""}`}>
              {canManage && <span className={`text-gold shrink-0 ${busy ? "cursor-progress" : "cursor-grab"}`}>⠿</span>}
              {q.thumbnail_url
                ? <img src={q.thumbnail_url} alt="" className="h-9 w-12 shrink-0 rounded border border-gold-200/30 object-cover shadow-2xs" />
                : <span className="flex h-9 w-12 shrink-0 items-center justify-center rounded bg-burgundy text-cream">▶</span>}
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-sm font-medium leading-snug text-ink" title={q.title || q.youtube_video_id}>
                  {q.title || q.youtube_video_id}
                </div>
                <div className="mt-1 truncate text-xs text-gold flex items-center gap-1.5">
                  <span>do <b className="font-semibold text-ink">{q.added_by_name}</b></span>
                  {q.is_replay && (
                    <span className="inline-flex items-center rounded bg-gold-200/50 px-1 py-0.5 text-[10px] font-semibold text-burgundy" title="Tự động phát lại từ lịch sử">
                      🔁 Replay
                    </span>
                  )}
                </div>
              </div>
              {canManage ? (
                <div className="flex w-14 shrink-0 items-center justify-end gap-1">
                  {busy ? <Spinner /> : (
                    <>
                      <button title="Kéo lên đầu" onClick={() => run(q.id, () => bumpToTop(roomId, token, q.id))}
                        className="rounded border border-gold-200 bg-cream px-1.5 py-0.5 text-sm text-burgundy transition-transform hover:scale-105 active:scale-95">⬆</button>
                      <button title="Xóa" onClick={() => run(q.id, () => deleteItem(roomId, token, q.id))}
                        className="rounded border border-gold-200 bg-cream px-1.5 py-0.5 text-sm text-burgundy transition-transform hover:scale-105 active:scale-95">✕</button>
                    </>
                  )}
                </div>
              ) : (
                <span className="text-xs text-ink/30 px-1" title="Chỉ DJ hoặc Admin mới có quyền đổi thứ tự hoặc xóa bài">
                  🔒
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
