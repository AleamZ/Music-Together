"use client";

import { useState } from "react";
import type { Card } from "@/lib/game/cards/deck";
import { signedXu, xuNum } from "@/lib/game/cards/messages";
import { pkEval, pkHandName, pkLegal, pkPots, pkPresets, pkTopUpRange, type PkOptions } from "@/lib/game/cards/poker";
import type { CardAction } from "@/lib/game/cards/rpc";
import type { CardSeat, PkState } from "@/lib/game/cards/state";
import CardHand from "./CardHand";
import { CardRow } from "./PlayingCard";

/** The bet or raise slider (§13.2): bounded by what the server takes, with Tối thiểu, ½ pot and Pot. */
function BetControls({ o, presets, busy, bet, onAct }: {
  o: PkOptions;
  presets: { min: number; half: number; pot: number };
  busy: boolean;
  /** The last amount chosen (null: the minimum). */
  bet: [number | null, (n: number) => void];
  onAct: (action: "bet" | "raise", to: number) => void;
}) {
  const [chosen, setChosen] = bet;
  const to = Math.min(o.max, Math.max(o.min, chosen ?? o.min));
  const action = o.canBet ? "bet" : "raise";
  return (
    <div className="flex flex-wrap items-center gap-1">
      <input type="range" aria-label={o.canBet ? "Mức cược" : "Mức tố"} min={o.min} max={o.max} step={1} value={to}
        onChange={(e) => setChosen(Number(e.target.value))} />
      <button type="button" className="pch-btn" onClick={() => setChosen(presets.min)}>Tối thiểu</button>
      <button type="button" className="pch-btn" onClick={() => setChosen(presets.half)}>½ pot</button>
      <button type="button" className="pch-btn" onClick={() => setChosen(presets.pot)}>Pot</button>
      <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => onAct(action, to)}>
        {o.canBet ? `Cược ${xuNum(to)}` : `Tố lên ${xuNum(to)}`}
      </button>
    </div>
  );
}

/** Poker's centre, my two cards and my buttons (spec §13.2): the board, the pot and the side pots; Úp bài, Xem bài or
 *  Theo, Cược or Tố lên with its slider, Tất tay; a top-up between my hands; the showdown. */
export default function PokerBoard({ state, cards, mine, coins, busy, act, name }: {
  state: PkState;
  cards: readonly Card[];
  mine: CardSeat | null;
  coins: number | null;
  busy: boolean;
  act: (a: CardAction) => void;
  name: (seat: number) => string;
}) {
  const pub = state.pub;
  const stake = state.stake ?? 0;
  const [amount, setAmount] = useState<{ v: number; n: number | null }>({ v: -1, n: null });
  const chosen = amount.v === state.v ? amount.n : null;
  const [topup, setTopup] = useState<number | null>(null);
  const playing = state.phase === "playing" && pub !== null;
  const me = playing && mine ? pub.players[mine.seat] : undefined;
  const inHand = me !== undefined && me.id === mine?.id;
  const myTurn = playing && inHand && state.turn === mine?.seat && !me.fold && !me.allin;
  const spot = myTurn && mine && pub ? { cur: pub.cur, raise: pub.raise, bet: me.bet, acted: me.acted, chips: mine.chips, stake } : null;
  const o = spot ? pkLegal(spot) : null;
  const pots = playing ? pkPots({ players: pub.players, button: pub.button }) : [];
  const board = pub?.board ?? [];
  const made = cards.length > 0 ? pkHandName(pkEval([...cards, ...board])) : null;
  const room = mine && !inHand ? pkTopUpRange(stake, mine.chips, coins ?? Number.MAX_SAFE_INTEGER) : null;
  const top = room ? Math.min(room.max, Math.max(room.min, topup ?? room.max)) : 0;
  const last = state.phase === "result" ? state.last : null;
  const pk = (action: "fold" | "check" | "call" | "bet" | "raise" | "allin", to: number | null = null) =>
    act({ kind: "pk_act", seq: state.seq, action, amount: to });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-16 flex-col items-center gap-1 rounded-sm bg-[#1f5a3a]/10 p-1.5" aria-label="Giữa bàn">
        {board.length > 0 && <CardRow cards={board} size="normal" label="Bài chung" />}
        {playing && <p>{`Pot ${xuNum(pub.pot)}`}</p>}
        {pots.length > 1 && <p className="text-base">{pots.slice(1).map((p) => `Pot phụ ${xuNum(p.xu)}`).join(" · ")}</p>}
      </div>
      {last && (
        <div className="flex flex-col gap-1 rounded-sm border-2 border-gold-200 p-1.5" aria-label="Kết quả ván">
          {last.board.length > 0 && <CardRow cards={last.board} label="Bài chung" />}
          {Object.entries(last.shown).map(([s, cs]) => (
            <span key={s} className="flex flex-wrap items-center gap-1">
              <span>{name(Number(s))}</span><CardRow cards={cs} /><span>{pkHandName(pkEval([...cs, ...last.board]))}</span>
            </span>
          ))}
          {last.pots.map((p, i) => (
            <p key={i}>{`${i === 0 ? "Pot" : "Pot phụ"} ${xuNum(p.xu)}: ${p.winners.map(name).join(", ")}${p.hand ? ` — ${pkHandName(p.hand)}` : ""}`}</p>
          ))}
          <p>{Object.entries(last.net).map(([s, xu]) => `${name(Number(s))} ${signedXu(xu)}`).join(" · ")}</p>
        </div>
      )}
      {cards.length > 0 && inHand && (
        <>
          <CardHand cards={cards} label="Bài của bạn" />
          {made && <p>{`Bạn đang có: ${made}`}</p>}
        </>
      )}
      {o && (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap gap-1">
            <button type="button" className="pch-btn" disabled={busy} onClick={() => pk("fold")}>Úp bài</button>
            {o.canCheck ? (
              <button type="button" className="pch-btn" disabled={busy} onClick={() => pk("check")}>Xem bài</button>
            ) : (
              <button type="button" className="pch-btn" disabled={busy} onClick={() => pk("call")}>{`Theo ${xuNum(o.callCost)}`}</button>
            )}
            {o.canAllin && <button type="button" className="pch-btn" disabled={busy} onClick={() => pk("allin")}>Tất tay</button>}
          </div>
          {(o.canBet || o.canRaise) && spot && pub && (
            <BetControls o={o} presets={pkPresets(o, spot, pub.pot)} busy={busy}
              bet={[chosen, (n) => setAmount({ v: state.v, n })]} onAct={(action, to) => pk(action, to)} />
          )}
        </div>
      )}
      {room && (
        <div className="flex flex-wrap items-center gap-1">
          <input type="range" aria-label="Nạp thêm" min={room.min} max={room.max} step={1} value={top}
            onChange={(e) => setTopup(Number(e.target.value))} />
          <button type="button" className="pch-btn" disabled={busy} onClick={() => act({ kind: "topup", amount: top })}>
            {`Nạp thêm ${xuNum(top)}`}
          </button>
        </div>
      )}
    </div>
  );
}
