"use client";

import { useState } from "react";
import type { CardAction } from "@/lib/game/cards/rpc";
import type { Card } from "@/lib/game/cards/deck";
import { cutBanner, mustText, signedXu, tlResultLines } from "@/lib/game/cards/messages";
import type { CardSeat, TlState } from "@/lib/game/cards/state";
import { tlArrange, tlBeats, tlCombo, tlLegalPlays, tlSlams, type TlCombo } from "@/lib/game/cards/tienlen";
import CardHand from "./CardHand";
import { CardRow } from "./PlayingCard";

/** "Rác", "Đôi", "Sám cô", "Tứ quý", "Sảnh 5 lá", "3 đôi thông". */
export function comboName(x: Pick<TlCombo, "type" | "len">): string {
  switch (x.type) {
    case "single": return "Rác";
    case "pair": return "Đôi";
    case "triple": return "Sám cô";
    case "quad": return "Tứ quý";
    case "straight": return `Sảnh ${x.len} lá`;
    case "pairs": return `${x.len} đôi thông`;
  }
}

/** Why "Đánh" cannot play this selection, or null when it can (§7.3; the server decides). */
export function playBlocker(s: TlState, mine: CardSeat | null, cards: readonly Card[], selection: readonly Card[]): string | null {
  const pub = s.pub;
  if (s.phase !== "playing" || !pub || !mine) return "Chưa tới lúc làm việc này.";
  const me = pub.players[mine.seat];
  if (!me || me.id !== mine.id || me.out !== null) return "Chưa tới lượt bạn.";
  if (selection.length === 0) return "Chọn bài để đánh.";
  const x = tlCombo(selection);
  if (!x || !selection.every((c) => cards.includes(c))) return "Bộ bài không hợp lệ.";
  if (s.turn === mine.seat) {
    if (!pub.top) return pub.must !== null && !selection.includes(pub.must) ? mustText(pub.must) : null;
    return tlBeats(pub.top, x) ? null : "Bài này không chặn được.";
  }
  // out of turn only a 4 đôi thông that beats the top (R9)
  if (x.type !== "pairs" || x.len !== 4 || !pub.top || pub.top.seat === mine.seat) return "Chưa tới lượt bạn.";
  return tlBeats(pub.top, x) ? null : "Bài này không chặn được.";
}

/** Tiến lên's centre, my hand and my buttons (spec §13.2): the round's pile, the top's name and a cut banner; Đánh,
 *  Bỏ lượt, Bỏ chọn, 💡 Gợi ý and 💣 Chặt!; the result with its lines. */
export default function TienLenBoard({ state, cards, mine, busy, act, name }: {
  state: TlState;
  /** My cards in this hand (none for a spectator). */
  cards: readonly Card[];
  mine: CardSeat | null;
  busy: boolean;
  act: (a: CardAction) => void;
  name: (seat: number) => string;
}) {
  const pub = state.pub;
  const [picked, setPicked] = useState<Card[]>([]);
  const [mode, setMode] = useState<"rank" | "group">("rank");
  const [hint, setHint] = useState(0);
  const selection = picked.filter((c) => cards.includes(c));
  const playing = state.phase === "playing" && pub !== null;
  const myTurn = playing && mine !== null && state.turn === mine.seat;
  const meP = pub && mine ? pub.players[mine.seat] : undefined;
  const active = playing && meP !== undefined && meP.id === mine?.id && meP.out === null;
  const blocker = playBlocker(state, mine, cards, selection);
  const top = pub?.top ?? null;
  const slams = active && !myTurn && top && top.seat !== mine?.seat ? tlSlams(cards, top) : [];
  const toggle = (c: Card) => setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));
  const play = (sel: readonly Card[]) => {
    act({ kind: "tl_play", seq: state.seq, cards: [...sel] });
    setPicked([]);
  };
  const suggest = () => {
    const plays = tlLegalPlays(cards, top, pub?.must ?? null);
    if (plays.length === 0) return;
    setPicked(plays[hint % plays.length].cards);
    setHint(hint + 1);
  };
  const last = state.phase === "result" ? state.last : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-16 flex-col items-center gap-1 rounded-sm bg-[#1f5a3a]/10 p-1.5" aria-label="Giữa bàn">
        {pub?.chain && <p className="text-xl text-burgundy">{cutBanner(name(pub.chain.cutter), name(pub.chain.victim))}</p>}
        {top && <p>{`${name(top.seat)}: ${comboName(top)}`}</p>}
        <div className="flex flex-wrap justify-center gap-2">
          {(pub?.pile ?? []).map((p, i) => (
            <span key={i} className="flex items-center gap-1 text-base"><span>{name(p.seat)}</span><CardRow cards={p.cards} /></span>
          ))}
        </div>
        {playing && pub.must !== null && !top && <p className="text-base">{mustText(pub.must)}</p>}
      </div>
      {last && (
        <div className="flex flex-col gap-1 rounded-sm border-2 border-gold-200 p-1.5" aria-label="Kết quả ván">
          {last.places.map((s, i) => <p key={s}>{`${i + 1}. ${name(s)}`}</p>)}
          {tlResultLines(last, name).map((l, i) => <p key={i} className="text-base">{l}</p>)}
          <p>{Object.entries(last.net).map(([s, xu]) => `${name(Number(s))} ${signedXu(xu)}`).join(" · ")}</p>
          {Object.entries(last.hands).map(([s, cs]) => (
            <span key={s} className="flex items-center gap-1 text-base"><span>{name(Number(s))}</span><CardRow cards={cs} /></span>
          ))}
        </div>
      )}
      {cards.length > 0 && (
        <>
          <CardHand cards={tlArrange(cards, mode)} selected={selection} onToggle={toggle} disabled={busy} />
          <div className="flex flex-wrap gap-1">
            <button type="button" className="pch-btn pch-btn-primary" disabled={busy || blocker !== null} title={blocker ?? undefined}
              onClick={() => play(selection)}>
              Đánh
            </button>
            <button type="button" className="pch-btn" disabled={busy || !myTurn || !top}
              title={myTurn && !top ? "Bạn đang mở vòng — phải đánh." : undefined}
              onClick={() => act({ kind: "tl_pass", seq: state.seq })}>
              Bỏ lượt
            </button>
            <button type="button" className="pch-btn" disabled={selection.length === 0} onClick={() => setPicked([])}>Bỏ chọn</button>
            <button type="button" className="pch-btn" disabled={!myTurn} onClick={suggest}>💡 Gợi ý</button>
            <button type="button" className="pch-btn" onClick={() => setMode(mode === "rank" ? "group" : "rank")}>Xếp bài</button>
            {slams.length > 0 && (
              <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => play(slams[0].cards)}>💣 Chặt!</button>
            )}
          </div>
          {selection.length > 0 && blocker && <p className="text-base text-burgundy">{blocker}</p>}
        </>
      )}
    </div>
  );
}
