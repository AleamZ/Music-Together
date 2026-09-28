"use client";

import { useEffect, useState } from "react";
import { ParchmentModal } from "@/components/game/Parchment";
import { serverNow } from "@/lib/game/farm/clock";
import { formatXu } from "@/lib/game/fishing/catalog";
import {
  BATTLE_DURATIONS, BATTLE_FEES, BATTLE_MAX_PLAYERS, battlePhase, battlePrize, clockText, myBattle, type Battle, type BattleBoard,
} from "@/lib/game/fishing/extras";

/** A clock that ticks every second while shown. */
function useNow(): number {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** One battle's scoreboard: rank, name, catches, value (the leader crowned). */
export function Scoreboard({ battle, me, speciesName, limit }: { battle: Battle; me: string; speciesName: (id: string) => string; limit?: number }) {
  const rows = limit ? battle.players.slice(0, limit) : battle.players;
  return (
    <ol className="flex flex-col gap-0.5">
      {rows.map((p, i) => (
        <li key={p.accountId} className={`flex items-center gap-2 ${p.accountId === me ? "font-bold text-burgundy" : ""}`}>
          <span className="w-6 text-right tabular-nums">{i === 0 && p.score > 0 ? "👑" : `${i + 1}.`}</span>
          <span className="min-w-0 flex-1 truncate">{p.username}</span>
          <span className="text-base opacity-80">{p.catches} con{p.best ? ` · ${speciesName(p.best)}` : ""}</span>
          <span className="tabular-nums">{formatXu(p.score)}</span>
        </li>
      ))}
    </ol>
  );
}

function BattleCard({ b, board, now, busy, speciesName, onJoin, onLeave, onStart }: {
  b: Battle; board: BattleBoard; now: number; busy: boolean; speciesName: (id: string) => string;
  onJoin: (id: string) => void; onLeave: (id: string) => void; onStart: (id: string) => void;
}) {
  const inIt = b.players.some((p) => p.accountId === board.me);
  const host = b.players.find((p) => p.accountId === b.host)?.username ?? "?";
  const phase = battlePhase(b, now);
  const mine = myBattle(board);
  return (
    <li className="pch flex flex-col gap-1 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>Trận của <b>{host}</b> · cược {formatXu(b.fee)} · {b.durationS / 60} phút</span>
        <span className="text-base">
          {b.status === "open" ? `Chờ người (${b.players.length}/${BATTLE_MAX_PLAYERS})`
            : b.status === "live" ? (phase === "countdown" ? `Bắt đầu sau ${clockText((b.startsAt ?? now) - now)}` : phase === "fishing" ? `⏱️ Còn ${clockText((b.endsAt ?? now) - now)}` : "Đang chấm…")
            : b.status === "done" ? "Đã xong" : "Đã huỷ"}
        </span>
      </div>
      <span className="text-base opacity-80">
        Quỹ thưởng {formatXu(b.pot)}{b.status === "done" ? ` · người thắng nhận ${formatXu(b.prize)} (đốt ${formatXu(b.burned)})` : ` · người thắng nhận ~${formatXu(battlePrize(b.pot))}`}
      </span>
      <Scoreboard battle={b} me={board.me} speciesName={speciesName} />
      {b.status === "open" && (
        <div className="flex flex-wrap gap-2">
          {!inIt && !mine && <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => onJoin(b.id)}>Vào trận · {formatXu(b.fee)}</button>}
          {inIt && b.host === board.me && (
            <button type="button" className="pch-btn pch-btn-primary" disabled={busy || b.players.length < 2} onClick={() => onStart(b.id)}>
              {b.players.length < 2 ? "Chờ thêm người…" : "▶ Bắt đầu"}
            </button>
          )}
          {inIt && <button type="button" className="pch-btn" disabled={busy} onClick={() => onLeave(b.id)}>{b.host === board.me ? "Huỷ trận" : "Rời trận"}</button>}
        </div>
      )}
    </li>
  );
}

/** v21 (0076) 🏆 Đấu câu: open a battle (entry fee held by the server), join one, the live scoreboards and the results.
 *  The score is what the server counted: the value of every fish landed during the window. */
export default function BattlePanel({ board, busy, speciesName, onCreate, onJoin, onLeave, onStart, onClose }: {
  board: BattleBoard | null;
  busy: boolean;
  speciesName: (id: string) => string;
  onCreate: (fee: number, durationS: number) => void;
  onJoin: (id: string) => void;
  onLeave: (id: string) => void;
  onStart: (id: string) => void;
  onClose: () => void;
}) {
  const now = useNow();
  const [fee, setFee] = useState(BATTLE_FEES[1]);
  const [dur, setDur] = useState(BATTLE_DURATIONS[1]);
  const mine = myBattle(board);
  return (
    <ParchmentModal title="🏆 Đấu câu cá" onClose={onClose} className="sm:max-w-2xl">
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        <p className="text-base">
          Mỗi người góp tiền cược; trong giờ đấu ai câu (cần, lưới, ghe) được tổng giá cá cao nhất thì ôm quỹ thưởng
          (trừ {10}% phí). Không ai dính cá thì trả lại tiền cược.
        </p>
        {!board ? <p>Đang tải…</p> : (
          <>
            {!mine && (
              <div className="pch flex flex-wrap items-center gap-2 p-2">
                <span>Mở trận:</span>
                <select className="pch-btn" value={fee} onChange={(e) => setFee(Number(e.target.value))} aria-label="Tiền cược">
                  {BATTLE_FEES.map((f) => <option key={f} value={f}>{formatXu(f)}</option>)}
                </select>
                <select className="pch-btn" value={dur} onChange={(e) => setDur(Number(e.target.value))} aria-label="Thời gian">
                  {BATTLE_DURATIONS.map((d) => <option key={d} value={d}>{d / 60} phút</option>)}
                </select>
                <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => onCreate(fee, dur)}>Mở trận</button>
              </div>
            )}
            {board.battles.length === 0 ? <p>Chưa có trận nào — mở một trận đi!</p> : (
              <ul className="flex flex-col gap-2">
                {board.battles.map((b) => (
                  <BattleCard key={b.id} b={b} board={board} now={now} busy={busy} speciesName={speciesName} onJoin={onJoin} onLeave={onLeave} onStart={onStart} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </ParchmentModal>
  );
}

/** The live scoreboard over the world while my battle runs (top 3 and the clock). */
export function BattleChip({ board, speciesName, onOpen }: { board: BattleBoard | null; speciesName: (id: string) => string; onOpen: () => void }) {
  const now = useNow();
  const b = myBattle(board);
  if (!b || !board || b.status !== "live") return null;
  const phase = battlePhase(b, now);
  return (
    <button type="button" onClick={onOpen} className="pch absolute left-2 top-28 z-10 flex w-56 flex-col gap-0.5 p-2 text-left font-vt text-base leading-tight">
      <span className="text-lg text-burgundy">
        🏆 Đấu câu · {phase === "countdown" ? `bắt đầu sau ${clockText((b.startsAt ?? now) - now)}` : phase === "fishing" ? `còn ${clockText((b.endsAt ?? now) - now)}` : "đang chấm…"}
      </span>
      <Scoreboard battle={b} me={board.me} speciesName={speciesName} limit={3} />
    </button>
  );
}
