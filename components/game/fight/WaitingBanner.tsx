"use client";

import { CLAIM_AFTER_MS, STALL_BANNER_MS } from "@/lib/game/fight/pvp";

/** v20.3 the stall banner (spec §v20.3 "Rollback window" and "Absence"): after 3 s "⏳ Đang chờ đối thủ…"; after 20 s the
 *  claim "Đối thủ mất kết nối · Xử thắng" (the server decides: the opponent's last push older than 20 s, mine fresh). */
export default function WaitingBanner({ stalledMs, claiming, onClaim }: { stalledMs: number; claiming: boolean; onClaim: () => void }) {
  if (stalledMs < STALL_BANNER_MS) return null;
  const left = Math.ceil((CLAIM_AFTER_MS - stalledMs) / 1000);
  return (
    <div className="pch flex flex-wrap items-center justify-center gap-2 px-3 py-1 font-vt text-xl" role="status" data-testid="pvp-waiting">
      <span>⏳ Đang chờ đối thủ…</span>
      {stalledMs >= CLAIM_AFTER_MS
        ? <button type="button" className="pch-btn pch-btn-primary" disabled={claiming} onClick={onClaim}>Đối thủ mất kết nối · Xử thắng</button>
        : <span className="text-base opacity-80">(xử thắng được sau {left} giây)</span>}
    </div>
  );
}
