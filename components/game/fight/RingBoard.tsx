"use client";

import { useEffect, useState } from "react";
import { fightErrorMessage } from "@/lib/game/fight/messages";
import { ringBoard, type BoardRow } from "@/lib/game/fight/rpc";
import { ParchmentModal } from "../Parchment";

/** v20.3 "Bảng thành tích" on Bãi đất trống: the room's top 10 ring fighters by wins over the last 7 days. */
export default function RingBoard({ token, roomId, onClose }: { token: string; roomId: string; onClose: () => void }) {
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    ringBoard(roomId, token).then(({ value }) => { if (live) setRows(value); }, (e: unknown) => { if (live) setError(fightErrorMessage(e)); });
    return () => { live = false; };
  }, [roomId, token]);
  return (
    <ParchmentModal title="🏅 Bảng thành tích · Bãi đất trống" onClose={onClose} className="sm:max-w-md">
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        <p className="text-base opacity-80">Mười võ sĩ thắng nhiều nhất phòng này trong 7 ngày qua.</p>
        {error ? <p role="alert">{error}</p> : rows === null ? <p>Đang xem bảng…</p> : rows.length === 0 ? <p>Chưa có trận nào — lên sàn mở hàng đi!</p> : (
          <ol className="flex flex-col gap-1" data-testid="ring-board">
            {rows.map((r, i) => (
              <li key={`${r.name}-${i}`} className="flex justify-between gap-2 border-b border-ink/15 pb-0.5">
                <span>{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`} {r.name}</span>
                <span>{r.wins} thắng · {r.losses} thua · {r.draws} hòa</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </ParchmentModal>
  );
}
