"use client";

import { useMemo } from "react";
import type { Card, CardGame } from "@/lib/game/cards/deck";
import { placeBadge, xuNum } from "@/lib/game/cards/messages";
import type { CardAction } from "@/lib/game/cards/rpc";
import type { CardSeat, CardState } from "@/lib/game/cards/state";
import { DEFAULT_LOOK } from "@/lib/game/look";
import type { Look } from "@/lib/game/types";
import SpritePreview from "../SpritePreview";
import { CardRow } from "./PlayingCard";
import CaoBoard from "./CaoBoard";
import PokerBoard from "./PokerBoard";
import TienLenBoard from "./TienLenBoard";
import XidachBoard from "./XidachBoard";

/** A turn's length (§10), for the timer bar. */
const TURN_S: Record<CardGame, number> = { tienlen: 20, cao: 15, poker: 30, xidach: 30 };

export default function CardFirstPersonView({
  game,
  state,
  cards,
  mine,
  coins,
  busy,
  act,
  name,
  secs,
  turn,
  looks,
}: {
  game: CardGame;
  state: CardState;
  cards: readonly Card[];
  mine: CardSeat;
  coins: number | null;
  busy: boolean;
  act: (a: CardAction) => void;
  name: (seat: number) => string;
  secs: number;
  turn: { mine: boolean; name: string } | null;
  looks?: Map<string, Look>;
}) {
  // Seats of other players around the table, relative to my seat (in order clockwise)
  const otherSeats = useMemo(() => {
    const list: CardSeat[] = [];
    const max = state.max;
    for (let i = 1; i < max; i++) {
      const seatNo = ((mine.seat - 1 + i) % max) + 1;
      const s = state.seats.find((x) => x.seat === seatNo);
      if (s && !s.leaving) list.push(s);
    }
    return list;
  }, [state.max, state.seats, mine.seat]);

  const isMyTurn = turn?.mine ?? false;

  // Badge list for a seat
  const seatBadges = (seat: CardSeat): string[] => {
    const out: string[] = [];
    if (state.game === "tienlen" && state.pub) {
      const p = state.pub.players[seat.seat];
      if (p && p.id === seat.id) {
        if (state.phase === "playing" && state.pub.passed.includes(seat.seat)) out.push("Bỏ lượt");
        const placed = Object.values(state.pub.players).filter((q) => q.out !== "forfeit").length;
        if (p.place !== null) out.push(placeBadge(p.place, placed));
        if (p.out === "cong") out.push("Cóng");
        if (p.out === "forfeit") out.push("Xử thua");
      }
    } else if (state.game === "cao" && state.pub) {
      if (state.pub.dealer === seat.seat) out.push("Cái");
    } else if (state.game === "xidach" && state.pub) {
      if (state.pub.dealer === seat.seat) out.push("Cái");
      const p = state.pub.players[seat.seat];
      if (p) {
        if (p.standing) out.push("Dằn");
        if (p.busted) out.push("Quắc");
        if (p.inspected) out.push("Đã xét");
      }
    } else if (state.game === "poker" && state.pub) {
      if (state.pub.button === seat.seat) out.push("D");
      const p = state.pub.players[seat.seat];
      if (p && p.id === seat.id && state.phase === "playing") {
        if (p.fold) out.push("Úp bài");
        else if (p.allin) out.push("Tất tay");
      }
    }
    return out;
  };

  // Face down cards in front of a seat
  const seatCards = (seat: CardSeat): { count: number | null; backs: number } => {
    if (state.game === "tienlen" && state.pub && state.phase === "playing") {
      const p = state.pub.players[seat.seat];
      return p && p.id === seat.id && p.out === null ? { count: p.n, backs: 0 } : { count: null, backs: 0 };
    }
    if (state.game === "cao" && state.pub && state.phase === "peek") {
      return { count: null, backs: state.pub.order.includes(seat.seat) && !state.pub.left.includes(seat.seat) ? 3 : 0 };
    }
    if (state.game === "xidach" && state.pub && state.phase === "playing") {
      const p = state.pub.players[seat.seat];
      return { count: null, backs: p ? p.n : 0 };
    }
    if (state.game === "poker" && state.pub && state.phase === "playing") {
      const p = state.pub.players[seat.seat];
      return { count: null, backs: p && p.id === seat.id && !p.fold ? 2 : 0 };
    }
    return { count: null, backs: 0 };
  };

  return (
    <div className="relative flex flex-col gap-2 overflow-hidden rounded-xl border-4 border-[#522d14] bg-[#0c2415] p-3 text-cream select-none shadow-2xl">
      {/* 3D Felt Perspective Table Area */}
      <div className="relative flex min-h-[290px] flex-col justify-between overflow-hidden rounded-lg bg-radial from-[#1e6f42] to-[#0f4427] p-2 shadow-inner">
        {/* Other players seated opposite & sides */}
        <div className="flex flex-wrap items-start justify-center gap-2 sm:gap-4 pt-1 z-10">
          {otherSeats.length === 0 ? (
            <div className="rounded-md bg-black/40 px-3 py-1 text-sm opacity-70">
              Đang đợi người chơi khác ngồi vào bàn…
            </div>
          ) : (
            otherSeats.map((seat) => {
              const b = seatCards(seat);
              const badges = seatBadges(seat);
              const isSeatTurn = state.turn === seat.seat && (state.phase === "playing" || state.phase === "deal_wait");
              const look = looks?.get(seat.id) ?? DEFAULT_LOOK;

              return (
                <div
                  key={seat.seat}
                  aria-label={`Ghế ${seat.seat}`}
                  className={`flex flex-col items-center gap-0.5 rounded-lg border-2 p-1.5 transition-all ${
                    isSeatTurn
                      ? "border-gold-300 bg-gold-500/30 scale-105 shadow-[0_0_12px_rgba(234,179,8,0.5)]"
                      : "border-ink/40 bg-black/50"
                  }`}
                  style={{ minWidth: "72px", maxWidth: "100px" }}
                >
                  <div className="relative">
                    <SpritePreview look={look} mode="portrait" scale={1.5} className="rounded-sm bg-black/30" />
                  </div>
                  <span className="max-w-[80px] truncate text-xs font-bold leading-none text-gold-200">
                    {seat.name}
                  </span>
                  <span className="text-[11px] leading-none opacity-85">
                    {game === "poker" ? xuNum(seat.chips) : xuNum(seat.escrow)}
                  </span>
                  {/* Badges */}
                  {badges.length > 0 && (
                    <div className="flex flex-wrap items-center justify-center gap-0.5 mt-0.5">
                      {badges.map((bText) => (
                        <span key={bText} className="rounded-xs bg-burgundy px-1 text-[10px] font-bold text-cream">
                          {bText}
                        </span>
                      ))}
                    </div>
                  )}
                  {/* Cards in front of this player */}
                  <div className="flex items-center gap-0.5 mt-0.5">
                    {b.count !== null && (
                      <span className="rounded bg-black/60 px-1 text-[10px]">{`${b.count} lá`}</span>
                    )}
                    {b.backs > 0 && (
                      <CardRow cards={Array.from({ length: b.backs }, () => null)} size="tiny" />
                    )}
                  </div>
                  {isSeatTurn && (
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-black/40">
                      <div
                        className="h-full bg-burgundy transition-all"
                        style={{ width: `${Math.min(100, (secs / TURN_S[game]) * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Center of the Table (Felt Action Area) */}
        <div className="my-auto flex flex-col items-center justify-center gap-1.5 py-2 z-10">
          {state.game === "tienlen" && (
            <TienLenBoard state={state} cards={cards} mine={mine} busy={busy} act={act} name={name} />
          )}
          {state.game === "cao" && (
            <CaoBoard state={state} cards={cards} mine={mine} busy={busy} act={act} name={name} />
          )}
          {state.game === "xidach" && (
            <XidachBoard state={state} cards={cards} mine={mine} busy={busy} act={act} name={name} />
          )}
          {state.game === "poker" && (
            <PokerBoard state={state} cards={cards} mine={mine} coins={coins} busy={busy} act={act} name={name} />
          )}
        </div>

        {/* My Turn Banner */}
        {isMyTurn && (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 z-20 flex -translate-y-1/2 justify-center">
            <span className="animate-pulse rounded-full bg-burgundy px-4 py-1 text-base font-bold text-cream shadow-lg">
              👉 Đến lượt bạn! ({secs}s)
            </span>
          </div>
        )}
      </div>

      {/* First-Person Hand & HUD at the Bottom */}
      <div className="flex items-center justify-between border-t border-cream/20 pt-1.5 text-sm">
        <div className="flex flex-wrap items-center gap-2" aria-label={`Ghế ${mine.seat}`}>
          <span className="rounded-sm bg-black/50 px-2 py-0.5 font-bold text-gold-200">
            {`Ghế ${mine.seat}: ${name(mine.seat)}`}
          </span>
          {seatBadges(mine).map((bText) => (
            <span key={bText} className="rounded-xs bg-burgundy px-1 text-xs font-bold text-cream">
              {bText}
            </span>
          ))}
          <span className="text-xs opacity-80">
            {game === "poker" ? `Stack: ${xuNum(mine.chips)}` : `Giữ: ${xuNum(mine.escrow)}`}
          </span>
        </div>
        <div className="text-xs opacity-75">
          {`🪙 Ví: ${coins === null ? "—" : xuNum(coins)}`}
        </div>
      </div>
    </div>
  );
}
