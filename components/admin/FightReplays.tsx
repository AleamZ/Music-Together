"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Arena, { type FightDriver } from "@/components/game/fight/Arena";
import { formatXu } from "@/lib/game/fishing/catalog";
import type { FighterLook } from "@/lib/game/fight/render/rig";
import { ReplayPlayer } from "@/lib/game/fight/replay";
import { adminFightList, adminFightLog, type AdminFightList, type AdminFightLog } from "@/lib/game/fight/rpc";
import { DEFAULT_LOOK } from "@/lib/game/look";

const REASON: Record<string, string> = {
  ko: "KO", decision: "điểm", forfeit: "đầu hàng", timeout_claim: "mất kết nối", overtime: "quá giờ", abandon: "cả hai vắng", conflict: "lệch dữ liệu",
};
const SPEEDS = [0.5, 1, 2, 4] as const;

/** The replay overlay: both stored logs through the engine, read-only (spec §v20.3 "Anti-cheat": "Xem lại trận"). */
function ReplayView({ log, onClose }: { log: AdminFightLog; onClose: () => void }) {
  const [player] = useState(() => {
    const runsOf = (side: number) => log.logs.find((l) => l.side === side)?.runs ?? [];
    return new ReplayPlayer(log.params, runsOf(1), runsOf(2), log.simFrame);
  });
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [at, setAt] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setAt(player.at), 250);
    return () => window.clearInterval(id);
  }, [player]);
  const driver = useMemo((): FightDriver => ({ tick: (now, _mask, p) => player.tick(now, p) }), [player]);
  const fighters = useMemo((): readonly [FighterLook, FighterLook] => [
    { look: DEFAULT_LOOK, style: log.params.p1.style, rank: log.params.p1.rank },
    { look: DEFAULT_LOOK, style: log.params.p2.style, rank: log.params.p2.rank },
  ], [log]);
  const names = useMemo((): readonly [string, string] => [log.p1, log.p2 ?? "?"], [log]);
  const onOver = useCallback(() => {}, []);
  return (
    <div className="game-ui fixed inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-[#120c14]/95 p-2 text-ink" role="dialog" aria-modal="true" aria-label="Xem lại trận">
      <Arena driver={driver} arena="bai_dat" fighters={fighters} names={names} paused={paused} boxes onEsc={onClose} onOver={onOver} />
      <div className="pch flex flex-wrap items-center justify-center gap-2 px-2 py-1 font-vt text-lg" data-testid="replay-controls">
        <span>{`Khung ${at} / ${log.simFrame}`}</span>
        <button type="button" className="pch-btn" onClick={() => setPaused((p) => !p)}>{paused ? "▶ Chạy" : "⏸ Dừng"}</button>
        <button type="button" className="pch-btn" onClick={() => { player.seek(0); setAt(0); }}>⏮ Từ đầu</button>
        {SPEEDS.map((v) => (
          <button key={v} type="button" className={`pch-btn px-2 ${speed === v ? "pch-btn-primary" : ""}`}
            onClick={() => { player.speed = v; setSpeed(v); }}>{`${v}×`}</button>
        ))}
        <button type="button" className="pch-btn" onClick={onClose}>Đóng</button>
      </div>
      <div className="pch max-w-2xl px-2 py-1 text-sm">
        {log.logs.map((l) => (
          <p key={l.side}>{`Bên ${l.side} (${l.side === 1 ? log.p1 : log.p2 ?? "?"}): gửi tới khung ${l.frontier} · thấy đối thủ tới ${l.seenFrontier ?? "—"} · đứng chờ ${l.stallFrames} khung · băm sai ${l.badHashes}`}</p>
        ))}
        {log.conflicts.map((c, i) => <p key={i} className="text-burgundy">{`⚠️ ${c.reporter} thấy ${c.reported} khác ở khung ${c.fromFrame}–${c.toFrame}`}</p>)}
      </div>
    </div>
  );
}

// /admin, anti-cheat tab (v20.3): the last ring matches (disputes and voids first) and the conflict reports; each match
// can be replayed from both stored logs.
export default function FightReplays({ token }: { token: string }) {
  const [list, setList] = useState<AdminFightList | null>(null);
  const [failed, setFailed] = useState(false);
  const [log, setLog] = useState<AdminFightLog | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    adminFightList(token).then(({ value }) => { if (live) setList(value); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [token]);
  const open = (id: string) => {
    setLoading(id);
    adminFightLog(token, id).then(({ value }) => setLog(value), () => setFailed(true)).finally(() => setLoading(null));
  };
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-gold-200 bg-cream p-3" data-testid="fight-replays">
      <p className="font-bold text-burgundy">🥊 Trận trên sàn (Bãi đất trống)</p>
      {failed ? <p>Chưa tải được (chưa chạy 0051?).</p> : list === null ? <p>Đang xem sổ trận…</p> : list.matches.length === 0 ? <p>Chưa có trận nào.</p> : (
        <ul className="flex flex-col gap-1">
          {list.matches.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {`${new Date(m.createdAt).toLocaleString("vi-VN")} · Sàn ${m.ring ?? "?"} · ${m.p1} vs ${m.p2} · ${m.stake > 0 ? formatXu(m.stake) : "giao hữu"} · ${m.status}`}
                {m.endReason ? ` (${REASON[m.endReason] ?? m.endReason}${m.winner ? `, bên ${m.winner} thắng` : ""})` : ""}
                {m.resyncs > 0 ? ` · ${m.resyncs} lần nối lại` : ""}
              </span>
              <button type="button" className="rounded-lg border border-gold-300 px-2 py-0.5" disabled={loading !== null} onClick={() => open(m.id)}>
                {loading === m.id ? "Đang tải…" : "Xem lại trận"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {list && list.conflicts.length > 0 && (
        <>
          <p className="mt-1 font-bold text-burgundy">⚠️ Báo lệch dữ liệu</p>
          <ul className="flex flex-col gap-0.5">
            {list.conflicts.map((c) => (
              <li key={c.id}>{`${new Date(c.createdAt).toLocaleString("vi-VN")} · ${c.reporter} báo ${c.reported} · khung ${c.fromFrame}–${c.toFrame}`}</li>
            ))}
          </ul>
        </>
      )}
      {log && <ReplayView key={log.id} log={log} onClose={() => setLog(null)} />}
    </div>
  );
}
