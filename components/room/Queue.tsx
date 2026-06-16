"use client";

import { useState } from "react";
import { bumpToTop, deleteItem, reorderItem, type QueueItem } from "@/lib/supabase";
import { positionBetween } from "@/lib/queue";
import type { Identity } from "@/lib/identity";

export default function Queue({ queue, currentId, canManage, identity }: {
  queue: QueueItem[]; currentId: string | null; canManage: boolean; identity: Identity;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const upcoming = queue.filter((q) => q.id !== currentId);

  async function dropOn(target: QueueItem) {
    if (!dragId || dragId === target.id) return;
    const idx = upcoming.findIndex((q) => q.id === target.id);
    const before = upcoming[idx - 1]?.position ?? null;
    const newPos = positionBetween(before, target.position);
    setDragId(null);
    try { await reorderItem(identity, dragId, newPos); } catch { /* ignore */ }
  }

  return (
    <div>
      <h3 className="mb-2 flex items-center justify-between font-cormorant text-lg text-burgundy">
        Hàng đợi <span className="text-xs text-ink/60">{upcoming.length} bài</span>
      </h3>
      {upcoming.length === 0 && <p className="text-sm text-ink/60">Chưa có bài nào trong hàng đợi.</p>}
      <ul>
        {upcoming.map((q) => (
          <li key={q.id}
            draggable={canManage}
            onDragStart={() => setDragId(q.id)}
            onDragOver={(e) => canManage && e.preventDefault()}
            onDrop={() => dropOn(q)}
            className="flex items-center gap-2 border-b border-dotted border-gold-200 py-2">
            {canManage && <span className="cursor-grab text-gold">⠿</span>}
            {q.thumbnail_url
              ? <img src={q.thumbnail_url} alt="" className="h-9 w-12 rounded object-cover" />
              : <span className="flex h-9 w-12 items-center justify-center rounded bg-burgundy text-cream">▶</span>}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-ink">{q.title || q.youtube_video_id}</div>
              <div className="text-[11px] text-gold">do {q.added_by_name}
                <span className="ml-2 rounded-full border border-gold-200 bg-cream px-1.5 text-[9px] uppercase text-[#8a6d2f]">like · sắp ra mắt</span>
              </div>
            </div>
            {canManage && (
              <div className="flex gap-1">
                <button title="Kéo lên đầu" onClick={() => bumpToTop(identity, q.id)}
                  className="rounded border border-gold-200 bg-cream px-1.5 text-sm text-burgundy">⬆</button>
                <button title="Xóa" onClick={() => deleteItem(identity, q.id)}
                  className="rounded border border-gold-200 bg-cream px-1.5 text-sm text-burgundy">✕</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
