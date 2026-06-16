"use client";

import { useCallback, useEffect, useState } from "react";
import { listFeedback, setFeedbackStatus, deleteFeedback, type FeedbackRow } from "@/lib/admin";

const LABEL: Record<string, string> = { bug: "Lỗi", suggestion: "Góp ý", other: "Khác" };

export default function FeedbackTab({ token }: { token: string }) {
  const [items, setItems] = useState<FeedbackRow[]>([]);
  const refresh = useCallback(() => { listFeedback(token).then(setItems).catch(() => {}); }, [token]);
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="flex flex-col gap-2">
      {items.length === 0 && <p className="text-ink/60">Chưa có góp ý nào.</p>}
      {items.map((f) => (
        <div key={f.id} className={`rounded-xl border p-3 ${f.status === "new" ? "border-burgundy bg-cream" : "border-gold-200 bg-cream/50"}`}>
          <div className="flex items-center justify-between text-xs text-ink/70">
            <span>{LABEL[f.category] ?? f.category} · <b>{f.username}</b> · {new Date(f.created_at).toLocaleString("vi-VN")}</span>
            <span className="flex gap-1">
              <button onClick={async () => { await setFeedbackStatus(token, f.id, f.status === "new" ? "handled" : "new"); refresh(); }}
                className="rounded border border-gold-200 px-2 text-burgundy">{f.status === "new" ? "Đã xử lý" : "Mở lại"}</button>
              <button onClick={async () => { if (confirm("Xóa góp ý?")) { await deleteFeedback(token, f.id); refresh(); } }}
                className="rounded border border-gold-200 px-2 text-burgundy-accent">Xóa</button>
            </span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-ink">{f.message}</p>
        </div>
      ))}
    </div>
  );
}
