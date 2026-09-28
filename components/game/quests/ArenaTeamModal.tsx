"use client";

import { useCallback, useEffect, useState } from "react";
import { questErrorMessage } from "@/lib/game/quests/model";
import {
  arenaAccept, arenaCancel, arenaChallenge, arenaState, arenaTeamCreate, arenaTeamJoin, arenaTeamLeave, type ArenaState,
} from "@/lib/game/quests/rpc";
import { ParchmentModal } from "../Parchment";

const errText = (e: unknown) =>
  questErrorMessage(e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e));

/** ⚔️ Đấu đội 2v2 (v21 #36). The fight engine is 1v1, so a team series is a best-of-3 of ordinary PvP bouts at Bãi đất
 *  trống's rings (A1–B1, A2–B2, then A1–B2). The server reads each finished bout from the fight records. */
export default function ArenaTeamModal({ token, onCoins, onClose }: { token: string; onCoins: () => void; onClose: () => void }) {
  const [s, setS] = useState<ArenaState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [stake, setStake] = useState(0);

  useEffect(() => {
    let live = true;
    const load = () => arenaState(token).then((x) => { if (live) setS(x); }, (e) => { if (live) setMsg(errText(e)); });
    void load();
    const id = window.setInterval(load, 15_000);
    return () => { live = false; window.clearInterval(id); };
  }, [token]);

  const run = useCallback(async (f: () => Promise<ArenaState>, coins = false) => {
    setBusy(true);
    setMsg(null);
    try {
      setS(await f());
      if (coins) onCoins();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  }, [onCoins]);

  const team = s?.team ?? null;
  const live = s?.series.filter((x) => x.status === "open" || x.status === "live") ?? [];
  const past = s?.series.filter((x) => x.status === "done" || x.status === "void") ?? [];

  return (
    <ParchmentModal title="⚔️ Đấu đội 2v2" onClose={onClose} className="sm:max-w-[720px]">
      <div className="flex flex-col gap-3 font-vt text-lg" data-testid="arena-team">
        <p className="text-base">
          Mỗi loạt đấu là tối đa 3 trận 1v1 ở võ đài Bãi đất trống: người 1 gặp người 1, người 2 gặp người 2, hoà 1–1 thì người
          1 đội thách gặp người 2 đội kia. Đội thắng 2 trận thắng loạt; mỗi người thắng nhận tiền cược × 0,95.
        </p>
        {msg && <p role="status" className="rounded bg-gold-100 px-2 text-burgundy">{msg}</p>}
        {!s && !msg && <p>Đang tải…</p>}
        {s && !team && (
          <div className="flex flex-col gap-2 rounded border border-gold-300 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <input className="rounded border border-gold-300 bg-parchment px-2" maxLength={24} placeholder="Tên đội" value={name}
                onChange={(e) => setName(e.target.value)} />
              <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => void run(() => arenaTeamCreate(token, name))}>Lập đội</button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input className="w-28 rounded border border-gold-300 bg-parchment px-2 uppercase" maxLength={6} placeholder="Mã đội" value={code}
                onChange={(e) => setCode(e.target.value)} />
              <button type="button" className="pch-btn" disabled={busy} onClick={() => void run(() => arenaTeamJoin(token, code))}>Vào đội</button>
            </div>
          </div>
        )}
        {team && (
          <div className="rounded border border-gold-300 p-2">
            <div className="text-xl text-burgundy">🛡️ {team.name} · {team.rating} điểm · {team.wins}T/{team.losses}B</div>
            <p className="text-base">Thành viên: {team.a}{team.b ? `, ${team.b}` : " (đang chờ đồng đội)"}</p>
            {team.code && !team.b && <p className="text-base">Mã mời đồng đội: <b className="tracking-widest">{team.code}</b></p>}
            <button type="button" className="pch-btn mt-1" disabled={busy} onClick={() => void run(() => arenaTeamLeave(token))}>Rời đội</button>
          </div>
        )}
        {live.map((x) => {
          const mine = team?.id === x.teamB.id;
          return (
            <div key={x.id} className="rounded border-2 border-burgundy p-2">
              <div className="text-xl">{x.teamA.name} {x.scoreA} – {x.scoreB} {x.teamB.name} · cược {x.stake} xu</div>
              {x.status === "open" ? (
                <div className="flex flex-wrap gap-2">
                  <span className="text-base">{mine ? "Đội bạn được thách đấu!" : "Đang chờ đối thủ nhận lời…"}</span>
                  {mine && <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => void run(() => arenaAccept(token, x.id), true)}>Nhận lời</button>}
                  <button type="button" className="pch-btn" disabled={busy} onClick={() => void run(() => arenaCancel(token, x.id), true)}>{mine ? "Từ chối" : "Huỷ"}</button>
                </div>
              ) : (
                <p className="text-base">
                  Trận {x.bout}: <b>{x.pair?.join(" vs ")}</b> — hai người ra võ đài Bãi đất trống, chiếm hai góc và đấu (có hoặc không cược).
                  Loạt đấu tự huỷ và hoàn tiền sau 2 giờ.
                </p>
              )}
            </div>
          );
        })}
        {s && (
          <div>
            <h3 className="text-xl text-burgundy">🏆 Bảng xếp hạng đội</h3>
            {team && team.b && live.length === 0 && (
              <label className="flex items-center gap-2 text-base">
                Tiền cược
                <input type="number" min={0} max={500} step={10} className="w-24 rounded border border-gold-300 bg-parchment px-2" value={stake}
                  onChange={(e) => setStake(Math.max(0, Math.min(500, Math.floor(Number(e.target.value) || 0))))} />
                xu
              </label>
            )}
            <ol className="flex flex-col gap-1">
              {s.ranking.map((r, i) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-gold-300">
                  <span>{i + 1}. {r.name} <span className="text-base">({r.a}{r.b ? `, ${r.b}` : ""})</span></span>
                  <span className="flex items-center gap-2 tabular-nums">
                    {r.rating} · {r.wins}T/{r.losses}B
                    {team && team.b && r.full && r.id !== team.id && live.length === 0 && (
                      <button type="button" className="pch-btn" disabled={busy} onClick={() => void run(() => arenaChallenge(token, r.id, stake), true)}>Thách đấu</button>
                    )}
                  </span>
                </li>
              ))}
              {s.ranking.length === 0 && <li>Chưa có đội nào.</li>}
            </ol>
          </div>
        )}
        {past.length > 0 && (
          <p className="text-base opacity-80">
            Gần đây: {past.map((x) => `${x.teamA.name} ${x.scoreA}–${x.scoreB} ${x.teamB.name}${x.status === "void" ? " (huỷ)" : ""}`).join(" · ")}
          </p>
        )}
      </div>
    </ParchmentModal>
  );
}
