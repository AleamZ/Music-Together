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
  if (r.ug) return ugResultLines(r, side);
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

/** v20.4 an underground match's lines: the money (entry, prize, fee, refund), and in ecord the rating change or the cup. */
export function ugResultLines(r: MatchResult, side: 1 | 2): { title: string; money: string; reason: string; record: string | null } {
  const u = r.ug!;
  const reason = r.noshow ? (r.winner === side ? "Đối thủ không bấm Sẵn sàng" : "Bạn không bấm Sẵn sàng kịp") : REASON[r.endReason] ?? r.endReason;
  const mine = u.rating?.bySide[side === 1 ? "1" : "2"];
  const rating = mine ? `Hạng ngầm: ${mine.rating} (${mine.delta >= 0 ? "+" : "−"}${Math.abs(mine.delta)}${u.rating!.factor < 1 ? ", ×0,5: gặp nhau nhiều" : ""})` : null;
  if (r.void) return { title: "⏹️ Trận bị hủy", money: u.cupVoid ? "Giải bị hủy — hoàn phí mọi người" : `Hoàn phí ${formatXu(u.refund || u.entry)}`, reason, record: null };
  if (u.kind === "ug_ladder") {
    return r.winner === 1
      ? { title: `🏆 Hạ ${u.boss ?? "trùm"}!`, money: `+${formatXu(u.won)}${u.first ? " (lần đầu mùa này)" : " (lần sau: 10%)"}`, reason, record: u.floor ? `Tầng ${u.floor} đã mở tầng kế` : null }
      : { title: `😵 ${u.boss ?? "Trùm"} thắng`, money: `−${formatXu(u.entry)}`, reason, record: null };
  }
  const won = r.winner === side;
  if (u.kind === "ug_cup") {
    if (u.round === "final") {
      return won
        ? { title: "🏆 Vô địch giải đêm!", money: `+${formatXu(u.championWon)}`, reason, record: rating }
        : { title: "🥈 Á quân", money: `+${formatXu(u.runnerUpWon)}`, reason, record: rating };
    }
    return won ? { title: "✅ Vào chung kết!", money: "Chờ gọi tên trận chung kết", reason, record: rating } : { title: "😵 Dừng ở bán kết", money: "Phí vào không hoàn", reason, record: rating };
  }
  if (r.noshow) {
    return won
      ? { title: "🏆 Xử thắng", money: `+${formatXu(u.won)} · bạn về đầu hàng chờ kèo`, reason, record: null }
      : { title: "😶 Xử thua", money: `−${formatXu(u.entry)}`, reason, record: null };
  }
  if (r.winner === 0) return { title: "🤝 Hòa!", money: `Hoàn phí ${formatXu(u.entry)}`, reason, record: rating };
  return won
    ? { title: "🏆 Bạn thắng kèo!", money: `+${formatXu(u.won - u.entry)} (nhận ${formatXu(u.won)}, phí ${formatXu(u.fee)})`, reason, record: rating }
    : { title: "😵 Bạn thua kèo", money: `−${formatXu(u.entry)}`, reason, record: rating };
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
        {l.record && <p className="text-base">{result.ug ? l.record : `Thành tích: ${l.record}`}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="pch-btn" onClick={onLeave}>{result.ug ? "Rời lồng" : "Rời sàn"}</button>
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
