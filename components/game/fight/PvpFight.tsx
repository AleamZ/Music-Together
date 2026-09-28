"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { State } from "@/lib/game/fight/engine";
import { fightErrorMessage } from "@/lib/game/fight/messages";
import { PvpMatch, logKey, resumeLog } from "@/lib/game/fight/pvp";
import type { ServerClock } from "@/lib/game/fight/referee";
import type { FighterLook } from "@/lib/game/fight/render/rig";
import type { StartedMatch } from "@/lib/game/fight/rings";
import { fightClaim, fightForfeit, fightPushPvp, fightState, type MatchResult } from "@/lib/game/fight/rpc";
import { broadcastTransport, type FightTransport } from "@/lib/game/fight/transport";
import type { Look } from "@/lib/game/types";
import Arena, { type FightDriver } from "./Arena";
import { KeyLegend } from "./PracticeSetup";
import ResultCard from "./ResultCard";
import WaitingBanner from "./WaitingBanner";

const readLog = (id: string): number[] | null => {
  try {
    const v = JSON.parse(window.localStorage.getItem(logKey(id)) ?? "null") as unknown;
    return Array.isArray(v) && v.every((x) => Number.isInteger(x)) ? (v as number[]) : null;
  } catch {
    return null;
  }
};
const writeLog = (id: string, runs: number[]): void => {
  try { window.localStorage.setItem(logKey(id), JSON.stringify(runs)); } catch { /* private mode: an honest reload may void */ }
};
const dropLog = (id: string): void => {
  try { window.localStorage.removeItem(logKey(id)); } catch { /* nothing to drop */ }
};

interface NetChip { rtt: number; delay: number; depth: number; stalledMs: number; over: boolean }

/** v20.3 a ring match (spec §v20.3 "Netcode", "Settlement and the forfeit rules"): the arena overlay driven by the
 *  rollback session over the ring's fight topic, pushes to fight_push every 60 frames (with what I saw of the opponent
 *  and my checkpoint hash), procedure R on a desync, a resync answer or the opponent's `fr`, the network chip, the stall
 *  banner with the claim, "Đầu hàng", and the result card the server settled. Leaving mid-match is a loss ("Thoát = xử
 *  thua"). `resume`: the page reloaded mid-match (fight_state first). */
export default function PvpFight({ token, roomId, ring, match, me, foeId, names, looks, clock, resume, onDone, onRematch, onLeave, onToast }: {
  token: string;
  roomId: string;
  ring: number;
  match: StartedMatch;
  me: string;
  foeId: string;
  /** Red's and blue's names (p1, p2). */
  names: readonly [string, string];
  looks: readonly [Look, Look];
  clock: ServerClock;
  resume: boolean;
  onDone: () => void;
  onRematch: (stake: number) => void;
  onLeave: () => void;
  onToast: (text: string) => void;
}) {
  const side = match.side;
  const pvp = useMemo(() => new PvpMatch(match.params, (side - 1) as 0 | 1, match.startedAtMs, (runs) => writeLog(match.id, runs)), [match, side]);
  const [ready, setReady] = useState(!resume);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [chip, setChip] = useState<NetChip>({ rtt: 0, delay: pvp.session.delay, depth: 0, stalledMs: 0, over: false });
  const [confirmExit, setConfirmExit] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const transport = useRef<FightTransport | null>(null);
  const done = useRef(false);
  const resyncing = useRef(false);
  const onToastRef = useRef(onToast);
  useEffect(() => { onToastRef.current = onToast; }, [onToast]);

  const finish = useCallback((r: MatchResult | null) => {
    if (!r || done.current) return;
    done.current = true;
    dropLog(match.id);
    setResult(r);
  }, [match.id]);

  // procedure R: the server's sim and the opponent's canonical runs; the opponent is told with `fr`
  const resync = useCallback((tell: boolean) => {
    if (resyncing.current || done.current) return;
    resyncing.current = true;
    fightState(token, match.id).then(({ value, sentAt, receivedAt }) => {
      clock.sample(value.serverNowMs, sentAt, receivedAt);
      if (value.status !== "live") { finish(value.result); return; }
      pvp.resync(value.sim, value.simFrame, value.oppRuns);
      if (tell) transport.current?.send({ t: "fr", id: me, f: value.simFrame });
    }).catch(() => {}).finally(() => { resyncing.current = false; });
  }, [token, match.id, clock, pvp, me, finish]);

  // a reload mid-match: my log (stored, else the server's), the opponent's runs and the server's sim
  useEffect(() => {
    if (!resume) return;
    let live = true;
    fightState(token, match.id).then(({ value, sentAt, receivedAt }) => {
      if (!live) return;
      clock.sample(value.serverNowMs, sentAt, receivedAt);
      if (value.status !== "live") { finish(value.result); setReady(true); return; }
      pvp.restore(resumeLog(value.runs, readLog(match.id)), value.oppRuns, value.sim, value.simFrame, value.frontier ?? -1);
      if (value.seenFrontier !== null) pvp.seenPushed = value.seenFrontier + 1;
      setReady(true);
    }).catch((e: unknown) => { if (live) setError(fightErrorMessage(e)); });
    return () => { live = false; };
  }, [resume, token, match.id, clock, pvp, finish]);

  // the ring's fight topic
  useEffect(() => {
    const t = broadcastTransport(roomId, ring, foeId);
    transport.current = t;
    t.onPacket((p) => {
      if (p.t === "fi") pvp.session.onPacket(p, performance.now());
      else if (p.t === "fr") resync(false);
      else if (p.t === "fp") t.send({ t: "fq", id: me, n: p.n, ms: p.ms });
    });
    return () => {
      transport.current = null;
      t.close();
    };
  }, [roomId, ring, foeId, pvp, me, resync]);

  // the pushes (one at a time, every 60 frames; keepalives while stalled) and the network chip
  useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(() => {
      const now = performance.now();
      const s = pvp.session;
      setChip((c) => {
        const next = { rtt: Math.round(s.stats.rtt), delay: s.delay, depth: s.stats.depth, stalledMs: Math.round(s.stalledFor(now) / 250) * 250, over: s.over };
        return c.rtt === next.rtt && c.depth === next.depth && c.stalledMs === next.stalledMs && c.over === next.over ? c : next;
      });
      if (done.current) return;
      const plan = pvp.nextPush(now);
      if (!plan) return;
      fightPushPvp(token, match.id, plan).then(({ value, sentAt, receivedAt }) => {
        clock.sample(value.serverNowMs, sentAt, receivedAt);
        pvp.pushDone(value.frontier, value.seenFrontier);
        if (value.anticheat) onToastRef.current("Dữ liệu trận không hợp lệ — hệ thống đã ghi nhận.");
        if (value.status !== "live") finish(value.result);
        else if (value.resync) resync(true);
      }).catch(() => pvp.pushFailed());
    }, 100);
    return () => window.clearInterval(id);
  }, [ready, pvp, token, match.id, clock, finish, resync]);

  const driver = useMemo((): FightDriver => ({
    tick(_now, mask) {
      if (!ready) return pvp.session.display();
      const s = pvp.tick(clock.now(Date.now()), performance.now(), mask);
      const p = pvp.packet(performance.now());
      if (p) transport.current?.send({ t: "fi", id: me, ...p });
      if (pvp.session.desync !== null) resync(true);
      return s;
    },
    countdown() {
      const c = pvp.countdown(clock.now(Date.now()));
      return c > 0 ? c : null;
    },
    confirmed: () => pvp.session.confirmed,
  }), [pvp, clock, me, ready, resync]);

  const fighters = useMemo((): readonly [FighterLook, FighterLook] => [
    { look: looks[0], style: match.params.p1.style, rank: match.params.p1.rank },
    { look: looks[1], style: match.params.p2.style, rank: match.params.p2.rank },
  ], [looks, match.params]);

  const forfeit = useCallback(() => {
    setConfirmExit(false);
    fightForfeit(token, match.id).then(({ value }) => finish(value.result)).catch((e: unknown) => setError(fightErrorMessage(e)));
  }, [token, match.id, finish]);

  const claim = useCallback(() => {
    setClaiming(true);
    fightClaim(token, match.id).then(({ value }) => {
      if (value.status !== "live") finish(value.result);
      else if (!value.claimed) onToastRef.current(`Chưa xử được — đối thủ vừa còn kết nối (chờ thêm ${Math.ceil((value.waitMs ?? 0) / 1000)} giây).`);
    }).catch((e: unknown) => setError(fightErrorMessage(e))).finally(() => setClaiming(false));
  }, [token, match.id, finish]);

  const onOver = useCallback((s: State) => { void s; }, []);

  return (
    <div className="game-ui fixed inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-[#120c14]/95 p-2 text-ink" role="dialog" aria-modal="true" aria-label="Trận đấu trên sàn">
      <p className="pch px-2 py-0.5 font-vt text-base" data-testid="pvp-net">
        {`📶 ${chip.rtt > 0 ? `${chip.rtt} ms` : "…"} · trễ ${chip.delay} khung · lùi ${chip.depth}`}
      </p>
      <Arena driver={driver} arena="bai_dat" fighters={fighters} names={names} paused={false} onEsc={() => setConfirmExit(true)} onOver={onOver} />
      {!result && <WaitingBanner stalledMs={chip.stalledMs} claiming={claiming} onClaim={claim} />}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" className="pch-btn" disabled={result !== null} onClick={() => setConfirmExit(true)}>🏳️ Đầu hàng (Esc)</button>
        <details className="pch hidden px-2 py-1 pointer-fine:block">
          <summary className="cursor-pointer font-vt text-lg">⌨️ Phím</summary>
          <KeyLegend className="mt-1" style={side === 1 ? match.params.p1.style : match.params.p2.style} />
        </details>
      </div>
      {chip.over && !result && <p className="font-vt text-xl text-[#fff4d8]" role="status">Trọng tài đang chấm trận…</p>}
      {!ready && !error && <p className="font-vt text-xl text-[#fff4d8]" role="status">Đang nối lại trận…</p>}
      {error && <p className="font-vt text-lg text-red-300" role="alert">{error}</p>}
      {confirmExit && !result && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50" role="alertdialog" aria-label="Thoát = xử thua">
          <div className="pch flex max-w-xs flex-col gap-2 p-3 font-vt text-xl">
            <p>Thoát giữa trận là xử thua{match.stake > 0 ? " và mất tiền cược" : ""}. Đầu hàng?</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="pch-btn" onClick={() => setConfirmExit(false)}>Đấu tiếp</button>
              <button type="button" className="pch-btn pch-btn-primary" onClick={forfeit}>Đầu hàng</button>
            </div>
          </div>
        </div>
      )}
      {result && (
        <ResultCard
          result={result}
          side={side}
          onRematch={() => { onDone(); onRematch(result.pvp?.stake ?? match.stake); }}
          onLeave={() => { onDone(); onLeave(); }}
          onClose={onDone}
        />
      )}
    </div>
  );
}
