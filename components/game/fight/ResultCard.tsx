"use client";

import { formatXu } from "@/lib/game/fishing/catalog";
import { stakeText } from "@/lib/game/fight/rings";
import type { MatchResult } from "@/lib/game/fight/rpc";

const REASON: Record<string, string> = {
  ko: "Hạ đo ván", decision: "Tính điểm", forfeit: "Đầu hàng", timeout_claim: "Đối thủ mất kết nối", overtime: "Quá giờ (20 phút)",
  abandon: "Cả hai vắng mặt quá lâu", conflict: "Dữ liệu hai bên không khớp",
};

/** What the card says for my side of a settled ring match: the headline, the money line, the record. Pure. */
export function resultLines(r: MatchResult, side: 1 | 2): { title: string; money: string; reason: string; record: string | null } {
  const pvp = r.pvp;
  const stake = pvp?.stake ?? 0;
  const reason = REASON[r.endReason] ?? r.endReason;
  if (r.void) {
    return {
      title: r.endReason === "conflict" ? "⚠️ Trận đấu bị hủy do dữ liệu hai bên không khớp" : "⏹️ Trận đấu bị hủy",
      money: stake > 0 ? `Hoàn cược ${formatXu(stake)}` : "Giao hữu — không mất xu",
      reason, record: null,
    };
  }
  const rec = pvp?.records?.[side === 1 ? "1" : "2"] ?? null;
  const record = rec ? `${rec.wins} thắng · ${rec.losses} thua · ${rec.draws} hòa` : null;
  if (r.winner === 0) return { title: "🤝 Hòa!", money: stake > 0 ? `Hoàn cược ${formatXu(stake)}` : "Giao hữu", reason, record };
  if (r.winner === side) {
    const net = (pvp?.won ?? 0) - stake;
    return {
      title: "🏆 Bạn thắng!",
      money: stake > 0 ? `+${formatXu(net)} (nhận ${formatXu(pvp?.won ?? 0)}, phí ${formatXu(pvp?.fee ?? 0)})` : "Giao hữu",
      reason, record,
    };
  }
  return { title: "😵 Bạn thua", money: stake > 0 ? `−${formatXu(stake)}` : "Giao hữu", reason, record };
}

/** v20.3 the ring match's result card (spec §v20.3 "Challenge flow" 5): the rounds, the xu, the vitals cost and the
 *  record; "Tái đấu" (a new offer at the same stake) and "Rời sàn". Both fighters stay in their corners. */
export default function ResultCard({ result, side, onRematch, onLeave, onClose }: {
  result: MatchResult;
  side: 1 | 2;
  onRematch: (() => void) | null;
  onLeave: () => void;
  onClose: () => void;
}) {
  const l = resultLines(result, side);
  const mine = (w: number) => (w === side ? "thắng" : w === 0 ? "hòa" : "thua");
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40" role="alertdialog" aria-label="Kết quả">
      <div className="pch flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 p-3 font-vt text-xl" data-testid="pvp-result">
        <p className="text-3xl text-burgundy">{l.title}</p>
        <p className="text-base opacity-80">{l.reason}</p>
        {!result.void && <p className="text-lg">Các hiệp: {result.rounds.map((r) => mine(r.winner)).join(" · ") || "—"}</p>}
        <p className="text-lg" data-testid="pvp-money">💰 {l.money}</p>
        {!result.void && <p className="text-base">Mệt: −{result.vitals.hunger} no · −{result.vitals.thirst} khát</p>}
        {l.record && <p className="text-base">Thành tích: {l.record}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="pch-btn" onClick={onLeave}>Rời sàn</button>
          <button type="button" className="pch-btn" onClick={onClose}>Đóng</button>
          {onRematch && (
            <button type="button" className="pch-btn pch-btn-primary" onClick={onRematch}>
              Tái đấu{result.pvp ? ` · ${stakeText(result.pvp.stake)}` : ""}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
