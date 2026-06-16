"use client";

import { useState } from "react";
import { submitFeedback, type FeedbackCategory } from "@/lib/feedback";
import { useAuth } from "@/hooks/useAuth";

const CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: "bug", label: "Lỗi" }, { value: "suggestion", label: "Góp ý" }, { value: "other", label: "Khác" },
];

export default function FeedbackModal({ onClose }: { onClose: () => void }) {
  const { token } = useAuth();
  const [category, setCategory] = useState<FeedbackCategory>("suggestion");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!token || !message.trim()) return;
    setBusy(true);
    try { await submitFeedback(token, category, message.trim()); setDone(true); }
    catch (err) {
      const m = (err as { message?: string }).message ?? "Không gửi được";
      setError(m.includes("too many feedback") ? "Bạn gửi quá nhiều góp ý, thử lại sau nhé." : m);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-gold bg-parchment p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 font-playfair text-xl text-burgundy">💬 Góp ý</h3>
        {done ? (
          <div className="flex flex-col gap-3">
            <p className="text-ink">Đã gửi góp ý, cảm ơn bạn! 🎩</p>
            <button onClick={onClose} className="rounded-lg bg-burgundy px-4 py-2 text-cream">Đóng</button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <select value={category} onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
              className="rounded-lg border border-gold bg-cream px-3 py-2 text-ink">
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <textarea required value={message} onChange={(e) => setMessage(e.target.value)} rows={4}
              placeholder="Nội dung góp ý…" className="rounded-lg border border-gold bg-cream px-3 py-2 text-ink" />
            {error && <p className="text-sm text-burgundy-accent">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-gold py-2 text-burgundy">Hủy</button>
              <button type="submit" disabled={busy} className="flex-1 rounded-lg bg-burgundy py-2 font-cormorant font-bold text-cream disabled:opacity-60">
                {busy ? "Đang gửi…" : "Gửi"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
