"use client";

import { useState } from "react";
import { ParchmentModal } from "@/components/game/Parchment";
import type { CardGame } from "@/lib/game/cards/deck";
import { GAME_NAME, holdLine, PLAY_MONEY, STAKES, stakeLine, xuNum } from "@/lib/game/cards/messages";
import { pkBuyInRange } from "@/lib/game/cards/poker";

/** What sitting needs in the wallet (§6.1): Tiến lên 10 S, Cào S, poker the buy-in (at least 50 BB). */
export function sitNeeds(game: CardGame, stake: number): number {
  return game === "tienlen" ? 10 * stake : game === "cao" ? stake : 50 * stake;
}

/** Sitting down (spec §13.2): the stake picker only at an empty table, what each hand holds (or poker's buy-in slider,
 *  50–200 big blinds), and the play-money line. */
export default function SitDialog({ game, seat, stake, coins, busy, onSit, onClose }: {
  game: CardGame;
  seat: number;
  /** The table's stake; null while the table is empty (the first to sit picks it). */
  stake: number | null;
  /** My wallet (null: not loaded yet — the server checks). */
  coins: number | null;
  busy?: boolean;
  onSit: (stake: number, buyin: number | null) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState(1000);
  const s = stake ?? picked;
  const wallet = coins ?? Number.MAX_SAFE_INTEGER;
  const range = game === "poker" ? pkBuyInRange(s, wallet) : null;
  const [bb, setBb] = useState(100);
  const buyin = range ? Math.min(range.max, Math.max(range.min, bb * s)) : null;
  const enough = game === "poker" ? range !== null : wallet >= sitNeeds(game, s);
  return (
    <ParchmentModal title={`🪑 Ngồi ghế ${seat} · ${GAME_NAME[game]}`} onClose={onClose}>
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        {stake === null ? (
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Mức cược">
            <span>Chọn mức cược:</span>
            {STAKES.map((x) => (
              <button key={x} type="button" className="pch-btn" aria-pressed={picked === x} onClick={() => setPicked(x)}>
                {`${xuNum(x)} xu`}
              </button>
            ))}
          </div>
        ) : (
          <p>{stakeLine(game, stake)}</p>
        )}
        {game === "poker" ? (
          <label className="flex flex-col gap-1">
            <span>Mang vào bàn:</span>
            {range && (
              <>
                <input type="range" aria-label="Mang vào bàn" min={range.min} max={range.max} step={s}
                  value={buyin ?? range.min} onChange={(e) => setBb(Math.round(Number(e.target.value) / s))} />
                <span>{`${Math.round((buyin ?? range.min) / s)} lần mù lớn · ${xuNum(buyin ?? range.min)} xu (50–200 lần mù lớn)`}</span>
              </>
            )}
          </label>
        ) : (
          <p>{holdLine(game, s)}</p>
        )}
        {!enough && <p className="text-burgundy">Không đủ xu.</p>}
        <p className="text-base opacity-80">{PLAY_MONEY}</p>
        <div className="flex justify-end gap-1">
          <button type="button" className="pch-btn" onClick={onClose}>Thôi</button>
          <button type="button" className="pch-btn pch-btn-primary" disabled={!enough || busy} onClick={() => onSit(s, game === "poker" ? buyin : null)}>
            Ngồi xuống
          </button>
        </div>
      </div>
    </ParchmentModal>
  );
}
