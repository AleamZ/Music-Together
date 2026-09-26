"use client";

import { useEffect, useState, type CSSProperties } from "react";
import ConfirmButton from "@/components/game/farm/ConfirmButton";
import { ParchmentModal } from "@/components/game/Parchment";
import type { CardTable } from "@/hooks/useCardTable";
import type { Card, CardGame } from "@/lib/game/cards/deck";
import {
  CARDS_FAILED, CARDS_LOADING, CARDS_NOT_OPEN, DEALER_WAIT, LEAVE_CONFIRM, placeBadge, SIT_HERE, STAND_UP, stakeLine,
  statusLine, TABLE_TITLE, WATCHING, xuNum,
} from "@/lib/game/cards/messages";
import type { CardAction } from "@/lib/game/cards/rpc";
import { inHand, mySeat, secondsLeft, type CardSeat, type CardState } from "@/lib/game/cards/state";
import { serverNow } from "@/lib/game/farm/clock";
import CaoBoard from "./CaoBoard";
import { CardRow } from "./PlayingCard";
import PokerBoard from "./PokerBoard";
import SitDialog from "./SitDialog";
import TienLenBoard from "./TienLenBoard";

/** A turn's length (§10), for the timer bar. */
const TURN_S: Record<CardGame, number> = { tienlen: 20, cao: 15, poker: 30 };

/** The seats in drawing order from the bottom (spec §7.3, §13.2): mine first (seat 1 for a spectator), then counter-clockwise. */
export function ringOrder(max: number, bottom: number): number[] {
  return Array.from({ length: max }, (_, k) => ((bottom - 1 + k) % max) + 1);
}

/** Where the k-th seat of the ring sits around the oval, as percentages of the felt. */
function ringSpot(k: number, max: number): CSSProperties {
  const a = Math.PI / 2 - (k * 2 * Math.PI) / max;
  return { "--x": `${50 + 40 * Math.cos(a)}%`, "--y": `${50 + 36 * Math.sin(a)}%` } as CSSProperties;
}

/** A seat's badges (§13.2): Bỏ lượt, Về nhất/nhì/ba/bét, Cóng, Xử thua; Cái; Úp bài, Tất tay, D. */
function badges(s: CardState, seat: CardSeat): string[] {
  const out: string[] = [];
  if (s.game === "tienlen" && s.pub) {
    const p = s.pub.players[seat.seat];
    if (!p || p.id !== seat.id) return out;
    if (s.phase === "playing" && s.pub.passed.includes(seat.seat)) out.push("Bỏ lượt");
    const placed = Object.values(s.pub.players).filter((q) => q.out !== "forfeit").length;
    if (p.place !== null) out.push(placeBadge(p.place, placed));
    if (p.out === "cong") out.push("Cóng");
    if (p.out === "forfeit") out.push("Xử thua");
  } else if (s.game === "cao" && s.pub) {
    if (s.pub.dealer === seat.seat) out.push("Cái");
  } else if (s.game === "poker" && s.pub) {
    if (s.pub.button === seat.seat) out.push("D");
    const p = s.pub.players[seat.seat];
    if (p && p.id === seat.id && s.phase === "playing") {
      if (p.fold) out.push("Úp bài");
      else if (p.allin) out.push("Tất tay");
    }
  }
  return out;
}

/** The cards a seat shows face down: Tiến lên's count, Cào's three, poker's two while in the hand. */
function backs(s: CardState, seat: CardSeat): { count: number | null; backs: number } {
  if (s.game === "tienlen" && s.pub && s.phase === "playing") {
    const p = s.pub.players[seat.seat];
    return p && p.id === seat.id && p.out === null ? { count: p.n, backs: 0 } : { count: null, backs: 0 };
  }
  if (s.game === "cao" && s.pub && s.phase === "peek") {
    return { count: null, backs: s.pub.order.includes(seat.seat) && !s.pub.left.includes(seat.seat) ? 3 : 0 };
  }
  if (s.game === "poker" && s.pub && s.phase === "playing") {
    const p = s.pub.players[seat.seat];
    return { count: null, backs: p && p.id === seat.id && !p.fold ? 2 : 0 };
  }
  return { count: null, backs: 0 };
}

/** A card table's panel (spec §13.2): the seats around the felt (mine at the bottom), the centre and my hand from the
 *  game's board, the status line and the timer; sitting and standing up. Esc closes it without standing up. */
export default function CardTablePanel({ game, table, me, coins, act, onOpenRules, onClose }: {
  game: CardGame;
  table: CardTable;
  me: string;
  coins: number | null;
  act: (a: CardAction) => Promise<unknown>;
  onOpenRules: () => void;
  onClose: () => void;
}) {
  const { state, hand, busy, failed, notOpen } = table;
  const [sitAt, setSitAt] = useState<number | null>(null);
  // the countdowns move every second (the server's clock)
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(t);
  }, []);
  const run = (a: CardAction) => void act(a);

  let body;
  if (notOpen) body = <p>{CARDS_NOT_OPEN}</p>;
  else if (!state) body = <p>{failed ? CARDS_FAILED : CARDS_LOADING}</p>;
  else {
    const mine = mySeat(state, me);
    const sitting = mine !== null && !mine.leaving ? mine : null;
    const live = sitting !== null && inHand(state, hand);
    const cards: Card[] = live && hand ? hand.cards : [];
    const secs = secondsLeft(state, now);
    const name = (seat: number) => state.seats.find((x) => x.seat === seat)?.name ?? `Ghế ${seat}`;
    const dealerBusy = state.game === "cao" && state.phase === "peek" && sitting !== null && state.pub?.dealer === sitting.seat;
    const order = ringOrder(state.max, sitting?.seat ?? 1);
    const turn = state.turn !== null
      ? { mine: sitting !== null && state.turn === sitting.seat, name: name(state.turn) } : null;
    body = (
      <div className="flex flex-col gap-2">
        <div className="relative flex gap-1 overflow-x-auto sm:mb-3 sm:block sm:h-80 sm:overflow-visible" aria-label="Các ghế">
          <div className="hidden sm:absolute sm:inset-x-[16%] sm:inset-y-[18%] sm:block sm:rounded-[50%] sm:border-4 sm:border-[#6e4424] sm:bg-[#2f7d4f]" />
          {order.map((seatNo, k) => {
            const seat = state.seats.find((x) => x.seat === seatNo) ?? null;
            const b = seat ? backs(state, seat) : null;
            const isTurn = seat !== null && state.turn === seatNo && (state.phase === "playing" || state.phase === "deal_wait");
            return (
              <div key={seatNo} style={ringSpot(k, state.max)}
                className="pch flex min-w-24 shrink-0 flex-col items-center gap-0.5 p-1 text-base sm:absolute sm:left-[var(--x)] sm:top-[var(--y)] sm:-translate-x-1/2 sm:-translate-y-1/2"
                aria-label={`Ghế ${seatNo}`}>
                {seat ? (
                  <>
                    <span className="max-w-24 truncate text-lg">{seat.name}</span>
                    <span>{game === "poker" ? xuNum(seat.chips) : `giữ ${xuNum(seat.escrow)}`}</span>
                    <span className="flex flex-wrap items-center justify-center gap-1">
                      {b && b.count !== null && <span>{`${b.count} lá`}</span>}
                      {b && b.backs > 0 && <CardRow cards={Array.from({ length: b.backs }, () => null)} size="tiny" />}
                      {badges(state, seat).map((x) => <span key={x} className="rounded-sm bg-burgundy px-1 text-cream">{x}</span>)}
                    </span>
                    {seat.leaving && <span className="opacity-70">Đã rời</span>}
                    {isTurn && (
                      <div className="h-1.5 w-full overflow-hidden rounded-sm bg-ink/20" aria-hidden="true">
                        <div className="h-full bg-burgundy" style={{ width: `${Math.min(100, (secs / TURN_S[game]) * 100)}%` }} />
                      </div>
                    )}
                    {sitting && seat.id === me && (
                      dealerBusy ? (
                        <button type="button" className="pch-btn" disabled title={DEALER_WAIT}>{`${STAND_UP} · ${DEALER_WAIT}`}</button>
                      ) : (
                        <ConfirmButton warn={live ? LEAVE_CONFIRM : undefined} disabled={busy} onConfirm={() => run({ kind: "leave" })}>
                          {STAND_UP}
                        </ConfirmButton>
                      )
                    )}
                  </>
                ) : mine === null ? (
                  <button type="button" className="pch-btn" disabled={busy} onClick={() => setSitAt(seatNo)}>{SIT_HERE}</button>
                ) : (
                  <span className="opacity-60">{`Ghế ${seatNo}`}</span>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-xl" role="status">{statusLine(state.phase, state.seats.filter((x) => !x.leaving).length, secs, turn)}</p>
        {!sitting && <p>{WATCHING}</p>}
        {state.game === "tienlen" && (
          <TienLenBoard state={state} cards={cards} mine={sitting} busy={busy} act={run} name={name} />
        )}
        {state.game === "cao" && (
          <CaoBoard state={state} cards={cards} mine={sitting} busy={busy} act={run} name={name} />
        )}
        {state.game === "poker" && (
          <PokerBoard state={state} cards={cards} mine={sitting} coins={coins} busy={busy} act={run} name={name} />
        )}
        {sitAt !== null && (
          <SitDialog game={game} seat={sitAt} stake={state.seats.length > 0 ? state.stake : null} coins={coins} busy={busy}
            onSit={(stake, buyin) => {
              setSitAt(null);
              run({ kind: "sit", seat: sitAt, stake, buyin });
            }}
            onClose={() => setSitAt(null)} />
        )}
      </div>
    );
  }

  return (
    // sm:, because ParchmentModal's own max-w-lg comes later in Tailwind's output than a plain max-w-3xl
    <ParchmentModal title={TABLE_TITLE[game]} onClose={sitAt === null ? onClose : undefined} className="sm:max-w-3xl">
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        <div className="flex flex-wrap items-center gap-2">
          {state?.stake !== null && state?.stake !== undefined && <span>{stakeLine(game, state.stake)}</span>}
          <span>{`🪙 ${coins === null ? "—" : xuNum(coins)}`}</span>
          <button type="button" className="pch-btn ml-auto" onClick={onOpenRules}>📜 Sổ luật</button>
        </div>
        {body}
      </div>
    </ParchmentModal>
  );
}
