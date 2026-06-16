"use client";

import { useEffect, useState } from "react";
import { adminStats, type AdminStats } from "@/lib/admin";

export default function StatsTab({ token }: { token: string }) {
  const [s, setS] = useState<AdminStats | null>(null);
  useEffect(() => { adminStats(token).then(setS).catch(() => {}); }, [token]);
  if (!s) return <p className="text-ink/60">Đang tải…</p>;
  const items = [
    ["Tổng phòng", s.total_rooms], ["Tổng tài khoản", s.total_accounts],
    ["Feedback chưa xử lý", s.feedback_new], ["Tổng feedback", s.feedback_total],
  ] as const;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map(([label, n]) => (
        <div key={label} className="rounded-xl border border-gold-200 bg-cream p-4 text-center">
          <div className="font-playfair text-3xl text-burgundy">{n}</div>
          <div className="text-xs text-ink/70">{label}</div>
        </div>
      ))}
    </div>
  );
}
