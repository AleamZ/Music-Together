"use client";

import { useCallback, useMemo, useState } from "react";
import { stepWithBots } from "@/lib/game/fight/bot";
import {
  BOT_DUMMY, G_PHASE, G_RESULT, PH_OVER, RESULT_DRAW, createMatch, fighterParams, makeParams, roundResults, type State,
} from "@/lib/game/fight/engine";
import type { FighterLook } from "@/lib/game/fight/render/rig";
import { DEFAULT_LOOK } from "@/lib/game/look";
import type { Look } from "@/lib/game/types";
import Arena, { type FightDriver } from "./Arena";
import PracticeSetup, { DEFAULT_PRACTICE, KeyLegend, type PracticeOptions } from "./PracticeSetup";

/** The practice bot's look (a sparring partner from the street). */
const SPARRING_LOOK: Look = { ...DEFAULT_LOOK, skin: "tan", hair: "buzz", hairColor: "darkbrown" };
const STEP_MS = 1000 / 60;

interface Match {
  seed: number;
  opts: PracticeOptions;
}

interface Outcome {
  result: number;
  rounds: { reason: number; winner: number }[];
}

/** Practice's own sim: the fixed 60 Hz step with the bot, paused while a dialog is up. */
function practiceDriver(state: State): FightDriver {
  let s = state, acc = 0, last = -1;
  return {
    tick(now, mask, paused) {
      if (last < 0) last = now;
      acc = Math.min(acc + (now - last), STEP_MS * 5);
      last = now;
      while (acc >= STEP_MS) {
        acc -= STEP_MS;
        if (paused || s[G_PHASE] === PH_OVER) continue;
        s = stepWithBots(s, mask, 0);
      }
      return s;
    },
  };
}

/** v20.1 practice (v20.2: as the style of the uniform worn, at its rank — plan ruling P15): the fight overlay over the
 *  game canvas. World input is suspended while it is open (GameShell counts it as a panel) and the room's music plays
 *  on. Practice is client-only and pays nothing. */
export default function FightOverlay({ look, name, onClose, fighter = { style: 0, rank: 0 }, styleName = "Tự do", arena = "practice", title }: {
  look: Look;
  name: string;
  onClose: () => void;
  /** The style and rank practised (v20.2); Tự do by default. */
  fighter?: { style: number; rank: number };
  styleName?: string;
  arena?: "practice" | "dojo";
  title?: string;
}) {
  const [opts, setOpts] = useState<PracticeOptions>(DEFAULT_PRACTICE);
  const [match, setMatch] = useState<Match | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [confirmExit, setConfirmExit] = useState(false);

  const start = useCallback(() => {
    setOutcome(null);
    setConfirmExit(false);
    setMatch({ seed: (Date.now() & 0x7fffffff) | 1, opts });
  }, [opts]);

  const askExit = useCallback(() => {
    if (outcome) onClose();
    else setConfirmExit(true);
  }, [outcome, onClose]);

  const driver = useMemo(() => {
    if (!match) return null;
    const p2 = fighterParams(0, 0, { bot: match.opts.dummy ? BOT_DUMMY : match.opts.level });
    return practiceDriver(createMatch(makeParams(fighterParams(fighter.style, fighter.rank), p2, { seed: match.seed, rounds: match.opts.rounds })));
  }, [match, fighter.style, fighter.rank]);
  const fighters = useMemo((): readonly [FighterLook, FighterLook] => [
    { look, style: fighter.style, rank: fighter.rank }, { look: SPARRING_LOOK, style: 0, rank: 0 },
  ], [look, fighter.style, fighter.rank]);
  const onOver = useCallback((s: State) => setOutcome({ result: s[G_RESULT], rounds: roundResults(s) }), []);

  if (!match || !driver) {
    return <PracticeSetup value={opts} onChange={setOpts} onStart={start} onClose={onClose} styleName={styleName} title={title} style={fighter.style} />;
  }
  const foe = match.opts.dummy ? "Bao cát" : `Bạn tập cấp ${match.opts.level}`;
  return (
    <div className="game-ui fixed inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-[#120c14]/95 p-2 text-ink" role="dialog" aria-modal="true" aria-label="Sàn luyện tập">
      <Arena
        key={match.seed}
        driver={driver}
        arena={arena}
        fighters={fighters}
        names={[name, foe]}
        paused={confirmExit || outcome !== null}
        boxes={match.opts.boxes}
        onEsc={askExit}
        onOver={onOver}
      />
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" className="pch-btn" onClick={askExit}>✕ Thoát (Esc)</button>
        <details className="pch hidden px-2 py-1 pointer-fine:block">
          <summary className="cursor-pointer font-vt text-lg">⌨️ Phím</summary>
          <KeyLegend className="mt-1" style={fighter.style} />
        </details>
      </div>
      {confirmExit && !outcome && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50" role="alertdialog" aria-label="Thoát luyện tập?">
          <div className="pch flex flex-col gap-2 p-3 font-vt text-xl">
            <p>Thoát luyện tập?</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="pch-btn" onClick={() => setConfirmExit(false)}>Tập tiếp</button>
              <button type="button" className="pch-btn pch-btn-primary" onClick={onClose}>Thoát</button>
            </div>
          </div>
        </div>
      )}
      {outcome && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40" role="alertdialog" aria-label="Kết quả">
          <div className="pch flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-2 p-3 font-vt text-xl" data-testid="fight-result">
            <p className="text-3xl text-burgundy">
              {outcome.result === 1 ? "🏆 Bạn thắng!" : outcome.result === RESULT_DRAW ? "🤝 Hòa!" : "😵 Bạn thua"}
            </p>
            <p className="text-lg">
              Các hiệp: {outcome.rounds.map((r) => (r.winner === 1 ? "thắng" : r.winner === 2 ? "thua" : "hòa")).join(" · ") || "—"}
            </p>
            <p className="text-base opacity-80">Luyện tập: không tốn xu, không mất đói khát, không có thưởng.</p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="pch-btn" onClick={() => { setOutcome(null); setMatch(null); }}>Đổi tùy chọn</button>
              <button type="button" className="pch-btn" onClick={onClose}>Rời sàn</button>
              <button type="button" className="pch-btn pch-btn-primary" onClick={start}>Đấu lại</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
