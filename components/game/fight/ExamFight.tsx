"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MartialStyle } from "@/lib/game/fight/dojo";
import { type MatchParams, type State } from "@/lib/game/fight/engine";
import { fightErrorMessage } from "@/lib/game/fight/messages";
import { RefereedMatch, type ServerClock } from "@/lib/game/fight/referee";
import type { ArenaKind } from "@/lib/game/fight/render/arena-art";
import type { FighterLook } from "@/lib/game/fight/render/rig";
import { fightForfeit, fightPush, fightState, type MatchResult } from "@/lib/game/fight/rpc";
import type { Look } from "@/lib/game/types";
import Arena, { type FightDriver } from "./Arena";
import { KeyLegend } from "./PracticeSetup";

/** v20.2 the exam's sparring match against the master's bot, refereed by the server (spec §v20.2 "The refereed-match
 *  pipeline"): the local sim follows the server clock from frame 0 (never ahead of it), pushes every 60 frames with its
 *  hash, resyncs when asked, and shows the result the server settled. Leaving mid-match is a loss ("Thoát = xử thua"). */
export default function ExamFight({ token, match, resume, clock, look, name, master, myRank, onResult, onFlag, arena = "dojo", foe }: {
  token: string;
  match: { id: string; params: MatchParams; startedAtMs: number };
  /** Resuming after a reload: the runs the server already holds. */
  resume?: number[] | null;
  clock: ServerClock;
  look: Look;
  name: string;
  master: MartialStyle;
  myRank: number;
  onResult: (r: MatchResult) => void;
  onFlag?: (code: string) => void;
  /** v20.4 the bot ladder: the hầm's arena and the boss (its name, look and style) instead of the master. */
  arena?: ArenaKind;
  foe?: { name: string; look: Look; style: number };
}) {
  const [confirmExit, setConfirmExit] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onResultRef = useRef(onResult);
  const onFlagRef = useRef(onFlag);
  useEffect(() => { onResultRef.current = onResult; }, [onResult]);
  useEffect(() => { onFlagRef.current = onFlag; }, [onFlag]);
  const doneRef = useRef(false);

  const ref = useMemo(() => {
    const m = new RefereedMatch(match.params, match.startedAtMs);
    if (resume && resume.length > 0) m.restore(resume);
    return m;
  }, [match, resume]);

  const driver = useMemo((): FightDriver => ({
    tick(_now, mask) {
      ref.advance(clock.now(Date.now()), mask);
      return ref.state;
    },
    countdown() {
      const c = ref.countdown(clock.now(Date.now()));
      return c > 0 ? c : null;
    },
  }), [ref, clock]);

  const finish = useCallback((r: MatchResult | null) => {
    if (!r || doneRef.current) return;
    doneRef.current = true;
    onResultRef.current(r);
  }, []);

  // the pushes: every 60 frames, one at a time; a resync takes the server's sim
  useEffect(() => {
    let stopped = false;
    const id = window.setInterval(() => {
      if (stopped || doneRef.current) return;
      const p = ref.nextPush();
      if (!p) return;
      fightPush(token, match.id, p.from, p.runs, p.hashFrame, p.hash).then(async ({ value, sentAt, receivedAt }) => {
        clock.sample(value.serverNowMs, sentAt, receivedAt);
        ref.pushDone(value.frontier);
        if (value.anticheat) onFlagRef.current?.(value.anticheat.code);
        // 0060 a secret-bot match: the server's sim on every push (the local bot is a decoy)
        if (value.sim && value.status === "live") ref.resync(value.sim, value.simFrame);
        else if (value.resync) {
          const st = await fightState(token, match.id);
          ref.resync(st.value.sim, st.value.simFrame);
        }
        if (value.status !== "live") finish(value.result);
      }).catch((e: unknown) => {
        ref.pushFailed();
        setError(fightErrorMessage(e));
      });
    }, 100);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [ref, token, match.id, clock, finish]);

  const fighters = useMemo((): readonly [FighterLook, FighterLook] => [
    { look, style: match.params.p1.style, rank: myRank },
    foe ? { look: foe.look, style: foe.style, rank: match.params.p2.rank } : { look: master.masterLook, style: master.id, rank: match.params.p2.rank },
  ], [look, match, myRank, master, foe]);

  const forfeit = useCallback(() => {
    setConfirmExit(false);
    fightForfeit(token, match.id).then(({ value }) => finish(value.result)).catch((e: unknown) => setError(fightErrorMessage(e)));
  }, [token, match.id, finish]);

  const onOver = useCallback((s: State) => {
    void s;
    setWaiting(true);
  }, []);

  return (
    <div className="game-ui fixed inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-[#120c14]/95 p-2 text-ink" role="dialog" aria-modal="true" aria-label={foe ? `Thách đấu ${foe.name}` : "Thi đấu với thầy"}>
      <Arena
        driver={driver}
        arena={arena}
        fighters={fighters}
        names={[name, foe?.name ?? master.master]}
        paused={false}
        onEsc={() => setConfirmExit(true)}
        onOver={onOver}
      />
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" className="pch-btn" onClick={() => setConfirmExit(true)}>🏳️ Đầu hàng (Esc)</button>
        <details className="pch hidden px-2 py-1 pointer-fine:block">
          <summary className="cursor-pointer font-vt text-lg">⌨️ Phím</summary>
          <KeyLegend className="mt-1" style={foe ? match.params.p1.style : master.id} />
        </details>
      </div>
      {waiting && <p className="font-vt text-xl text-[#fff4d8]" role="status">Trọng tài đang chấm trận…</p>}
      {error && <p className="font-vt text-lg text-red-300" role="alert">{error}</p>}
      {confirmExit && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50" role="alertdialog" aria-label="Thoát = xử thua">
          <div className="pch flex max-w-xs flex-col gap-2 p-3 font-vt text-xl">
            <p>Thoát giữa trận là xử thua (trận vẫn chạy trong lúc này). Đầu hàng?</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="pch-btn" onClick={() => setConfirmExit(false)}>Đấu tiếp</button>
              <button type="button" className="pch-btn pch-btn-primary" onClick={forfeit}>Đầu hàng</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
