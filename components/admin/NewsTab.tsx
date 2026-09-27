"use client";

import { useCallback, useEffect, useState } from "react";
import { NewsBody } from "@/components/game/NewsModal";
import { newsErrorMessage, newsTime, type NewsPost } from "@/lib/game/news/news";
import { newsAdminList, newsPostDelete, newsPostUpsert, type NewsPostInput } from "@/lib/game/news/rpc";

const BLANK: NewsPostInput = { id: null, title: "", emoji: "📢", body: "", pinned: false };

/** Bản tin (v18.11): the dev blog of Báo Làng — every room's news stand shows these posts. */
export default function NewsTab({ token }: { token: string }) {
  const [items, setItems] = useState<NewsPost[]>([]);
  const [draft, setDraft] = useState<NewsPostInput>(BLANK);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => { newsAdminList(token).then(setItems).catch(() => {}); }, [token]);
  useEffect(() => { refresh(); }, [refresh]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setError(newsErrorMessage(e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? "")));
    } finally {
      setBusy(false);
    }
  };

  const save = () => run(async () => {
    await newsPostUpsert(token, draft);
    setDraft(BLANK);
    setPreview(false);
  });

  return (
    <div className="flex flex-col gap-3">
      <form className="flex flex-col gap-2 rounded-xl border border-gold bg-cream p-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <p className="font-playfair text-lg font-bold text-burgundy">{draft.id ? "Sửa bài" : "Bài mới"}</p>
        <div className="flex gap-2">
          <input aria-label="Biểu tượng" value={draft.emoji} maxLength={16} onChange={(e) => setDraft({ ...draft, emoji: e.target.value })}
            className="w-16 rounded border border-gold-200 px-2 text-center" />
          <input aria-label="Tiêu đề" placeholder="Tiêu đề" value={draft.title} maxLength={120}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="flex-1 rounded border border-gold-200 px-2" />
        </div>
        {preview
          ? <div className="min-h-32 rounded border border-gold-200 bg-white/60 p-2 text-ink"><NewsBody body={draft.body} /></div>
          : (
            <textarea aria-label="Nội dung" rows={8} maxLength={8000} value={draft.body}
              placeholder={"# Tiêu đề lớn\n**chữ đậm**, [liên kết](https://...)\n- gạch đầu dòng"}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })} className="rounded border border-gold-200 p-2 font-mono text-sm" />
          )}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1 text-burgundy">
            <input type="checkbox" checked={draft.pinned} onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })} /> Ghim lên đầu
          </label>
          <span className="flex-1" />
          <button type="button" onClick={() => setPreview((p) => !p)} className="rounded border border-gold-200 px-2 text-burgundy">
            {preview ? "Soạn" : "Xem trước"}
          </button>
          {draft.id && (
            <button type="button" onClick={() => { setDraft(BLANK); setPreview(false); }} className="rounded border border-gold-200 px-2 text-burgundy">Hủy sửa</button>
          )}
          <button type="submit" disabled={busy} className="rounded bg-burgundy px-3 py-0.5 text-cream disabled:opacity-50">
            {draft.id ? "Lưu" : "Đăng"}
          </button>
        </div>
        {error && <p className="text-sm text-burgundy-accent" role="alert">{error}</p>}
      </form>

      {items.length === 0 && <p className="text-ink/60">Chưa có bài nào.</p>}
      {items.map((p) => (
        <div key={p.id} className={`rounded-xl border p-3 ${p.pinned ? "border-burgundy bg-cream" : "border-gold-200 bg-cream/50"}`}>
          <div className="flex items-center justify-between gap-2 text-xs text-ink/70">
            <span>{p.pinned ? "📌 " : ""}{newsTime(p.createdAt)}{p.updatedAt !== p.createdAt ? ` · sửa ${newsTime(p.updatedAt)}` : ""}</span>
            <span className="flex gap-1">
              <button onClick={() => run(() => newsPostUpsert(token, { id: p.id, title: p.title, emoji: p.emoji, body: p.body, pinned: !p.pinned }))}
                disabled={busy} className="rounded border border-gold-200 px-2 text-burgundy">{p.pinned ? "Bỏ ghim" : "Ghim"}</button>
              <button onClick={() => { setDraft({ id: p.id, title: p.title, emoji: p.emoji, body: p.body, pinned: p.pinned }); setPreview(false); }}
                className="rounded border border-gold-200 px-2 text-burgundy">Sửa</button>
              <button onClick={() => { if (confirm("Xóa bài này?")) void run(() => newsPostDelete(token, p.id)); }}
                disabled={busy} className="rounded border border-gold-200 px-2 text-burgundy-accent">Xóa</button>
            </span>
          </div>
          <p className="mt-1 font-playfair text-lg font-bold text-burgundy">{p.emoji} {p.title}</p>
        </div>
      ))}
    </div>
  );
}
