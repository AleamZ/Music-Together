"use client";

import { useState } from "react";
import type { Card } from "@/lib/game/cards/deck";
import { CANCELLED, caoHandName, NO_DEALER, signedXu, xuNum } from "@/lib/game/cards/messages";
import type { CardAction } from "@/lib/game/cards/rpc";
import type { CaoState, CardSeat } from "@/lib/game/cards/state";
import CardHand from "./CardHand";
import { CardRow } from "./PlayingCard";

/** Cào's centre, my three cards and the dealer's button (spec §13.2): the dealer, nặn bài (local, one card at a time),
 *  then every hand with its nút. "Lật bài sau {n} giây" is the panel's status line. */
export default function CaoBoard({ state, cards, mine, busy, act, name }: {
  state: CaoState;
  cards: readonly Card[];
  mine: CardSeat | null;
  busy: boolean;
  act: (a: CardAction) => void;
  name: (seat: number) => string;
}) {
  const pub = state.pub;
  // nặn bài: how many of my cards I have turned, for this hand
  const [turned, setTurned] = useState<{ hand: number; n: number }>({ hand: -1, n: 0 });
  const shown = turned.hand === state.handNo ? turned.n : 0;
  const dealer = pub?.dealer ?? null;
  const iDeal = state.phase === "deal_wait" && mine !== null && dealer === mine.seat;
  const last = state.phase === "result" ? state.last : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-16 flex-col items-center gap-1 rounded-sm bg-[#1f5a3a]/10 p-1.5" aria-label="Giữa bàn">
        {dealer !== null && <p>{`Nhà cái: ${name(dealer)}`}</p>}
        {state.phase === "deal_wait" && pub?.note === "no_dealer" && <p className="text-burgundy">{NO_DEALER}</p>}
        {(pub?.left ?? []).length > 0 && state.phase === "peek" && (
          <p className="text-base">{`Rời bàn: ${pub!.left.map(name).join(", ")} — mỗi người mất ${xuNum(state.stake ?? 0)} cho cái`}</p>
        )}
      </div>
      {last && (
        <div className="flex flex-col gap-1 rounded-sm border-2 border-gold-200 p-1.5" aria-label="Kết quả ván">
          {last.cancelled && <p className="text-burgundy">{CANCELLED}</p>}
          {Object.entries(last.hands).map(([s, h]) => (
            <span key={s} className="flex flex-wrap items-center gap-1">
              <span>{`${name(Number(s))}${Number(s) === last.dealer ? " (cái)" : ""}`}</span>
              <CardRow cards={h.cards} />
              <span>{caoHandName(h.cards)}</span>
            </span>
          ))}
          <p>{Object.entries(last.net).map(([s, xu]) => `${name(Number(s))} ${signedXu(xu)}`).join(" · ")}</p>
        </div>
      )}
      {cards.length > 0 && state.phase === "peek" && (
        <>
          <CardHand cards={cards} hidden={cards.slice(shown)} label="Bài của bạn" />
          <div className="flex flex-wrap items-center gap-1">
            {shown < cards.length ? (
              <button type="button" className="pch-btn" onClick={() => setTurned({ hand: state.handNo, n: shown + 1 })}>Nặn bài</button>
            ) : (
              <span className="text-xl">{caoHandName(cards)}</span>
            )}
          </div>
        </>
      )}
      {iDeal && (
        <div className="flex gap-1">
          <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => act({ kind: "cao_deal", seq: state.seq })}>
            🃏 Chia bài
          </button>
        </div>
      )}
    </div>
  );
}
