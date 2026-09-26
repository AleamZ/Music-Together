"use client";

import { useEffect, useState } from "react";
import type { CardTable } from "@/hooks/useCardTable";
import { seatChipText } from "@/lib/game/cards/messages";
import { inHand, mySeat, secondsLeft } from "@/lib/game/cards/state";
import { serverNow } from "@/lib/game/farm/clock";

/** Under the player card while I sit at a table (spec §13.1, R29): "🃏 Tiến lên · Đến lượt bạn! 14s" (pulsing),
 *  "· Đang chơi" or "· Chờ ván mới". A tap opens the table. */
export default function CardSeatChip({ table, me, onOpen }: { table: CardTable; me: string; onOpen: () => void }) {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(t);
  }, []);
  const { game, state, hand } = table;
  const seat = state ? mySeat(state, me) : null;
  if (!game || !state || !seat || seat.leaving) return null;
  const turn = state.turn === seat.seat && (state.phase === "playing" || state.phase === "deal_wait");
  const what = turn ? "turn" : inHand(state, hand) ? "playing" : "waiting";
  return (
    <button type="button" onClick={onOpen}
      className={`pch-btn self-start text-base ${turn ? "pch-btn-primary motion-safe:animate-pulse" : ""}`}>
      {seatChipText(game, what, secondsLeft(state, now))}
    </button>
  );
}
