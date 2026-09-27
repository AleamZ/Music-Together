"use client";

import { useEffect, useState } from "react";
import { adminEstateFlags, type EstateFlag } from "@/lib/admin";
import { formatXu } from "@/lib/game/fishing/catalog";

// /admin, anti-cheat tab (v19.4): real-estate sales between two accounts that had already traded within 30 days — a
// possible coin laundering between alts. Trades within 7 days are refused by the server; these went through.
export default function EstateFlags({ token }: { token: string }) {
  const [flags, setFlags] = useState<EstateFlag[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    adminEstateFlags(token).then((f) => { if (live) setFlags(f); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [token]);
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-gold-200 bg-cream p-3" data-testid="estate-flags">
      <p className="font-bold text-burgundy">🏘️ Mua bán nhà qua lại (30 ngày)</p>
      {failed ? <p>Chưa tải được (chưa chạy 0043?).</p> : flags === null ? <p>Đang xem sổ mua bán…</p> : flags.length === 0 ? <p>Không có giao dịch đáng ngờ.</p> : (
        <ul className="flex flex-col gap-1">
          {flags.map((f) => (
            <li key={f.id}>
              {`${new Date(f.sold_at).toLocaleString("vi-VN")} · ${f.kind === "apt" ? "Căn hộ" : "Lô đất"} ${f.no} · ${f.seller_name ?? "?"} → ${f.buyer_name ?? "?"} · ${formatXu(f.price)} (thẩm định ${formatXu(f.appraisal)})`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}