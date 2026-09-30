"use client";

import { useEffect, useState } from "react";
import type { Card } from "@/lib/game/cards/deck";
import { serverNow } from "@/lib/game/farm/clock";
import { CANCELLED, signedXu, xidachHandName, xuNum } from "@/lib/game/cards/messages";
import type { CardAction } from "@/lib/game/cards/rpc";
import type { CardSeat, XidachState } from "@/lib/game/cards/state";
import { xidachEval } from "@/lib/game/cards/xidach";
import PlayingCard, { CardRow } from "./PlayingCard";

/** A card's peel state counts to this when it is fully open (nặn bài). */
const PEEL_STEPS = 3;
/** Dragging the back this far (px) and letting go opens the card; less springs it back. */
const PEEL_OPEN_PX = 56;

/**
 * Nặn bài by hand: the card lies face up under its back; dragging the back slides it off (tilting as it goes) and shows
 * the corner underneath, and letting go past PEEL_OPEN_PX flicks it away. Enter/Space or a double click opens it too.
 */
export function PeelCard({ card, index, open, onOpen }: { card: Card; index: number; open: boolean; onOpen: () => void }) {
  const [drag, setDrag] = useState<{ x: number; y: number; from: { x: number; y: number } } | null>(null);
  const dx = drag?.x ?? 0, dy = drag?.y ?? 0;
  const far = Math.hypot(dx, dy);
  const end = (e: React.PointerEvent) => {
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    if (far >= PEEL_OPEN_PX) onOpen();
    setDrag(null);
  };
  return (
    <div className="relative rounded-sm" aria-label={open ? `Lá ${index + 1}` : undefined}>
      <PlayingCard card={card} faceDown={false} size="large" />
      {!open && (
        <span
          role="button"
          tabIndex={0}
          aria-label={`Nặn lá ${index + 1} (kéo lưng bài ra)`}
          title="Kéo để nặn"
          className={`absolute inset-0 cursor-grab touch-none active:cursor-grabbing ${drag ? "" : "transition-transform duration-200"}`}
          style={{ transform: `translate(${dx}px, ${dy}px) rotate(${dx * 0.12}deg)`, boxShadow: far > 4 ? "4px 6px 10px rgba(0,0,0,0.45)" : undefined }}
          onPointerDown={(e) => {
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* old browser */ }
            setDrag({ x: 0, y: 0, from: { x: e.clientX, y: e.clientY } });
          }}
          onPointerMove={(e) => {
            if (!drag) return;
            setDrag({ ...drag, x: e.clientX - drag.from.x, y: e.clientY - drag.from.y });
          }}
          onPointerUp={end}
          onPointerCancel={() => setDrag(null)}
          onDoubleClick={onOpen}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
        >
          <PlayingCard card={null} faceDown size="large" />
          {drag && far < PEEL_OPEN_PX && (
            <span className="pointer-events-none absolute inset-x-0 -bottom-5 text-center text-[11px] text-gold-200">
              {Math.round((far / PEEL_OPEN_PX) * 100)}%
            </span>
          )}
        </span>
      )}
    </div>
  );
}
/** A turn lasts this long on the server (0021's deadlines). */
const XIDACH_TURN_S = 30;

/** Whose turn it is and the seconds left, with a bar that turns red in the last 10 s. */
function XidachTimer({ state, mine }: { state: XidachState; mine: CardSeat | null }) {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 250);
    return () => clearInterval(t);
  }, []);
  if (state.deadline === null || state.turn === null) return null;
  const left = Math.max(0, Math.ceil((state.deadline - now) / 1000));
  const mineTurn = mine !== null && state.turn === mine.seat;
  const pct = Math.min(100, (left / XIDACH_TURN_S) * 100);
  return (
    <div className="flex flex-col gap-0.5" role="timer" aria-label="Thời gian lượt">
      <div className="flex items-center justify-between text-xs">
        <span className={mineTurn ? "font-bold text-burgundy" : ""}>
          {mineTurn ? "⏰ Tới lượt bạn!" : `⏳ Lượt ${state.seats.find((s) => s.seat === state.turn)?.name ?? `ghế ${state.turn}`}`}
        </span>
        <span className={`font-bold ${left <= 10 ? "text-red-500" : ""}`}>{`${left}s`}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-sm bg-ink/20" aria-hidden="true">
        <div className={`h-full transition-[width] duration-300 ${left <= 10 ? "bg-red-500" : "bg-burgundy"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** The waiting table: who is ready, and my Sẵn sàng / Bỏ sẵn sàng button. */
function XidachReady({ state, mine, busy, act, name }: {
  state: XidachState;
  mine: CardSeat | null;
  busy: boolean;
  act: (a: CardAction) => void;
  name: (seat: number) => string;
}) {
  const ready = state.pub?.ready ?? [];
  const seated = state.seats.filter((s) => !s.leaving);
  const meReady = mine !== null && ready.includes(mine.seat);
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-sm bg-[#1f5a3a]/15 p-2 text-center" aria-label="Sẵn sàng">
      <p className="text-sm">
        {state.phase === "countdown"
          ? "Tất cả đã sẵn sàng — sắp chia bài…"
          : `Sẵn sàng ${ready.length}/${seated.length}${seated.length < 2 ? " · cần ít nhất 2 người" : ""}`}
      </p>
      {seated.length > 0 && (
        <p className="text-xs opacity-80">
          {seated.map((s) => `${ready.includes(s.seat) ? "✅" : "⏳"} ${name(s.seat)}`).join(" · ")}
        </p>
      )}
      {mine !== null && !mine.leaving && (
        <button
          type="button"
          className={`pch-btn px-3 py-1 text-sm font-bold ${meReady ? "" : "pch-btn-primary"}`}
          disabled={busy}
          onClick={() => act({ kind: "xidach_ready", seq: state.seq })}
        >
          {meReady ? "✋ Bỏ sẵn sàng" : "✅ Sẵn sàng"}
        </button>
      )}
    </div>
  );
}

export default function XidachBoard({
  state,
  cards,
  mine,
  busy,
  act,
  name,
}: {
  state: XidachState;
  cards: readonly Card[];
  mine: CardSeat | null;
  busy: boolean;
  act: (a: CardAction) => void;
  name: (seat: number) => string;
}) {
  const pub = state.pub;
  const dealer = pub?.dealer ?? null;
  const iDeal = state.phase === "deal_wait" && mine !== null && dealer === mine.seat;
  const isDealer = mine !== null && dealer === mine.seat;
  const isMyTurn = state.phase === "playing" && mine !== null && state.turn === mine.seat;
  const last = state.phase === "result" ? state.last : null;

  const myEval = cards.length > 0 ? xidachEval(cards) : null;
  // past 21 you may still draw, up to five cards; only a xì bàng / xì dách is kept as dealt
  const canHit =
    isMyTurn &&
    cards.length > 0 &&
    cards.length < 5 &&
    myEval !== null &&
    myEval.kind !== "xi_bang" &&
    myEval.kind !== "xi_dach";
  // nặn bài: my cards come face down; each is peeled open by clicks (3 per card), and the score shows once all are open
  const [peel, setPeel] = useState<{ hand: number; open: number[] }>({ hand: -1, open: [] });
  const opened = peel.hand === state.handNo ? peel.open : [];
  const openOf = (i: number) => opened[i] ?? 0;
  const allOpen = cards.length > 0 && cards.every((_, i) => openOf(i) >= PEEL_STEPS);
  const peelCard = (i: number, to?: number) => setPeel((p) => {
    const base = p.hand === state.handNo ? [...p.open] : [];
    base[i] = to ?? Math.min(PEEL_STEPS, (base[i] ?? 0) + 1);
    return { hand: state.handNo, open: base };
  });
  const openAll = () => setPeel({ hand: state.handNo, open: cards.map(() => PEEL_STEPS) });

  const canStand =
    isMyTurn &&
    myEval !== null &&
    (isDealer ? myEval.points >= 15 : myEval.points >= 16 || myEval.kind === "xi_bang" || myEval.kind === "xi_dach");

  // Other uninspected players for dealer to inspect
  // the dealer inspects from 15 points (or a special hand / quắc), as the server checks
  const inspectableSeats =
    isDealer && isMyTurn && pub && myEval !== null && (myEval.kind !== "du_tuoi" || myEval.points >= 15)
      ? pub.order.filter((s) => s !== dealer && !pub.left.includes(s) && !pub.players[s]?.inspected)
      : [];

  return (
    <div className="flex flex-col gap-2 font-vt select-none max-w-full">
      {/* Center Table Summary */}
      <div className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-sm bg-[#1f5a3a]/15 p-2 text-cream" aria-label="Giữa bàn">
        {dealer !== null && (
          <div className="flex items-center gap-1 text-sm font-bold text-gold-200">
            <span>👑 Nhà cái: {name(dealer)}</span>
            {isDealer && <span className="rounded bg-burgundy px-1 text-[11px]">(Bạn)</span>}
          </div>
        )}
        {state.phase === "deal_wait" && (
          <p className="text-xs text-amber-200">Đang chờ nhà cái chia bài…</p>
        )}
        {(pub?.left ?? []).length > 0 && state.phase === "playing" && (
          <p className="text-xs text-burgundy">{`Rời bàn: ${pub!.left.map(name).join(", ")} — mất ${xuNum(state.stake ?? 0)} xu cho cái`}</p>
        )}
      </div>

      {/* Hand Result if round finished */}
      {last && (
        <div className="flex flex-col gap-1.5 rounded-sm border-2 border-gold-300 bg-black/40 p-2 text-cream" aria-label="Kết quả ván">
          {last.cancelled && <p className="text-burgundy font-bold">{CANCELLED}</p>}
          {[...new Set(last.lines.filter((l) => l.why === "den_lang").map((l) => l.from))].map((s) => (
            <p key={s} className="text-xs font-bold text-red-400">{`💥 ${name(s)} quá 28 điểm — đền cả làng!`}</p>
          ))}
          {last.capped.length > 0 && (
            <p className="text-xs text-amber-200">
              {`⚖️ ${last.capped.map(name).join(", ")} không đủ đền hết: chỉ mất số xu đã giữ trên bàn, chia cho từng người theo tỷ lệ.`}
            </p>
          )}
          <div className="flex flex-col gap-1 text-xs">
            {Object.entries(last.hands).map(([s, h]) => {
              const seatNum = Number(s);
              const isLead = seatNum === last.dealer;
              return (
                <div key={s} className="flex flex-wrap items-center justify-between gap-1 border-b border-white/10 pb-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-gold-200">
                      {name(seatNum)}{isLead ? " (cái)" : ""}:
                    </span>
                    <CardRow cards={h.cards} size="tiny" />
                    <span className="text-[11px] opacity-90">{xidachHandName(h.cards)}</span>
                  </div>
                  <span className={`font-bold ${last.net[seatNum] > 0 ? "text-green-400" : last.net[seatNum] < 0 ? "text-red-400" : "text-gray-300"}`}>
                    {signedXu(last.net[seatNum] ?? 0)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* My Cards & Evaluation while playing */}
      {state.phase === "playing" && <XidachTimer state={state} mine={mine} />}

      {cards.length > 0 && state.phase === "playing" && (
        <div className="flex flex-col items-center gap-1.5 rounded-lg border border-gold-400/40 bg-black/50 p-2 text-cream shadow-md">
          <div className="flex items-center gap-1.5">
            {cards.map((c, i) => (
              <PeelCard key={i} card={c} index={i} open={openOf(i) >= PEEL_STEPS} onOpen={() => peelCard(i, PEEL_STEPS)} />
            ))}
          </div>
          {allOpen && myEval ? (
            <div className="flex items-center gap-2 text-sm">
              <span className={`font-bold ${myEval.kind === "quac" ? "text-red-400" : myEval.points >= 16 ? "text-green-400" : "text-amber-300"}`}>
                {xidachHandName(cards)}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs">
              <span className="opacity-80">🤏 Kéo lưng bài ra để nặn</span>
              <button type="button" className="pch-btn px-2 py-0.5 text-xs" onClick={openAll}>Lật hết</button>
            </div>
          )}
        </div>
      )}

      {/* Waiting: every seated player must press Sẵn sàng (at least 2) before the deal */}
      {(state.phase === "idle" || state.phase === "countdown") && (
        <XidachReady state={state} mine={mine} busy={busy} act={act} name={name} />
      )}

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
        {iDeal && (
          <button
            type="button"
            className="pch-btn pch-btn-primary px-3 py-1 text-sm font-bold"
            disabled={busy}
            onClick={() => act({ kind: "xidach_deal", seq: state.seq })}
          >
            🃏 Chia bài
          </button>
        )}

        {isMyTurn && (
          <>
            <button
              type="button"
              className="pch-btn pch-btn-primary px-3 py-1 text-sm font-bold"
              disabled={busy || !canHit}
              onClick={() => act({ kind: "xidach_hit", seq: state.seq })}
              title={canHit ? "Rút thêm 1 lá bài từ nọc" : "Không thể rút thêm"}
            >
              🃏 Rút bài ({cards.length}/5)
            </button>

            <button
              type="button"
              className="pch-btn px-3 py-1 text-sm font-bold"
              disabled={busy || !canStand}
              onClick={() => act({ kind: "xidach_stand", seq: state.seq })}
              title={canStand ? "Dằn bài và kết thúc lượt" : `Cần tối thiểu ${isDealer ? 15 : 16} điểm để dằn`}
            >
              ✋ Dằn bài
            </button>

            {isDealer && inspectableSeats.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                {inspectableSeats.map((seatNum) => (
                  <button
                    key={seatNum}
                    type="button"
                    className="pch-btn text-xs bg-amber-600/80 hover:bg-amber-500 text-cream px-2 py-1"
                    disabled={busy}
                    onClick={() => act({ kind: "xidach_inspect", seq: state.seq, targetSeat: seatNum })}
                  >
                    🔍 Xét {name(seatNum)}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
