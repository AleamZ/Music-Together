"use client";

import { useEffect, useRef, useState } from "react";
import { drawArrowRow, drawNetBundle, drawNetScene, type NetPhase } from "@/lib/game/art/net";
import { formatWeight } from "@/lib/game/fishing/catalog";
import {
  ARROW_GLYPH, ARROWS, arrowForKey, arrowPlan, arrowSequence, chargeQuality, clampAim, createRound, insideNet, landingPoint,
  makeSchool, MAX_MISTAKES, NET, netRadius, offsetsFor, pressArrow, ringSize, roundGrade, roundMistakes, SCENE, shadowsAt,
  type Arrow, type ArrowPlan, type ArrowRound, type Pt, type Shadow,
} from "@/lib/game/fishing/net";
import { isTyping } from "@/lib/game/keys";
import type { NetInput } from "@/lib/game/fishing/netcast";
import type { NetView } from "@/hooks/useFishingController";

/** The net rising to the hands after kéo lưới. */
const PULL_MS = 800;
const AIM_STEP = 3;
/** The arrow row's canvas: up to 9 keys of 13 px. */
const ROW_W = 9 * 13, ROW_H = 11;

/** Docked to one side so the thrower stays visible in the world: a bottom sheet (~45% high) on phones, a panel pinned
 *  to the right on wider screens; no backdrop over the world, only a light gradient on the panel's side. The dock lets
 *  the pointer through outside the panel. */
export const NET_DOCK =
  "pointer-events-none fixed inset-x-0 bottom-0 z-30 flex h-[45vh] items-end justify-center select-none " +
  "bg-linear-to-t from-black/25 to-transparent " +
  "sm:inset-y-0 sm:left-auto sm:right-0 sm:h-auto sm:w-[420px] sm:items-center sm:justify-end sm:bg-linear-to-l sm:pr-3";
export const NET_PANEL =
  "pch pointer-events-auto flex max-h-full w-full flex-col gap-2 overflow-y-auto p-3 font-vt leading-tight sm:max-h-[96vh] sm:w-[400px]";
/** The pond scene: compact in the phone sheet (at most 24vh high, 16:10), full panel width beside the world. */
export const NET_CANVAS = "mx-auto w-full touch-none rounded-sm border-2 border-ink max-sm:max-w-[38.4vh]";

type Step = NetPhase | "wait" | "result";
type Grade = "perfect" | "good" | "miss";

interface Machine {
  step: Step;
  aim: Pt;
  holdAt: number;
  chargeMs: number;
  q: number;
  landing: Pt;
  r: number;
  thrownAt: number;
  sinkAt: number;
  pullAt: number;
  caught: boolean[];
  /** Where the caught shadows were when the net closed over them. */
  frozen: Shadow[];
  keys: Set<string>;
  plan: ArrowPlan;
  roundNo: number;
  round: ArrowRound;
  roundAt: number;
  /** Mistakes of the finished rounds. */
  mistakes: number;
  seed: number;
  hauled: boolean;
  grade: { grade: Grade; at: number } | null;
  shakeAt: number;
}

/** What the arrow panel shows. */
interface ArrowsView {
  seq: Arrow[];
  at: number;
  round: number;
  rounds: number;
  /** The round's timer left, 1 … 0. */
  left: number;
  mistakes: number;
  shake: boolean;
  grade: Grade | null;
}

const TEXT: Record<Step, string> = {
  aim: "Di chuột chọn chỗ – giữ chuột/Space để lấy đà",
  charge: "Thả ra khi thanh lực vào vùng xanh!",
  flight: "Lưới bay…",
  sink: "Lưới đang chìm… cá dưới lưới đã bị vây!",
  wait: "Lưới đang chìm… cá dưới lưới đã bị vây!",
  arrows: "Kéo lưới: gõ đúng dãy mũi tên (phím mũi tên / WASD) trước khi hết giờ!",
  pull: "Kéo lưới lên!",
  result: "",
};
const GRADE_TEXT: Record<Grade, string> = { perfect: "Perfect!", good: "Good", miss: "Miss" };

/**
 * v18.2 Quăng lưới (spec §18.2, the owner's redesign): fish shadows swim in front of me; a ring follows the mouse (or
 * the arrow keys) within the throw's range; holding fills a power bar whose top is green; the release throws the net in
 * an arc and it opens into a circle (short and small without the green); it sinks 1.5 s and the shadows under it are
 * caught (net_haul); then kéo lưới: rounds of arrow sequences typed with the arrow keys / WASD / the on-screen buttons
 * before each round's timer runs out (more, heavier, rarer fish: more rounds, longer, faster). Each wrong key and each
 * timed-out round is a mistake: one fish escapes per mistake, the 4th pulls me into the pond. Esc gives up before the
 * throw.
 */
export default function NetOverlay({ view, speciesName, onThrow, onHaul, onFinish, onClose, onPhase }: {
  view: NetView;
  speciesName: (id: string) => string;
  onThrow: (chargeMs: number) => void;
  onHaul: (chargeMs: number, offsets: number[]) => void;
  onFinish: (mistakes: number) => void;
  onClose: () => void;
  /** v18.2: each phase, for the others to see (the throw carries where the net lands). */
  onPhase?: (inp: NetInput) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rowRef = useRef<HTMLCanvasElement>(null);
  const [step, setStep] = useState<Step>("aim");
  const [arrows, setArrows] = useState<ArrowsView | null>(null);
  const m = useRef<Machine>({
    step: "aim", aim: { x: SCENE.hands.x, y: 40 }, holdAt: 0, chargeMs: 0, q: 0, landing: { x: 0, y: 0 }, r: 0,
    thrownAt: 0, sinkAt: 0, pullAt: 0, caught: [], frozen: [], keys: new Set(), plan: { rounds: 0, keys: 0, timerMs: 1 },
    roundNo: 0, round: createRound([]), roundAt: 0, mistakes: 0, seed: 0, hauled: false, grade: null, shakeAt: 0,
  });
  const props = useRef({ view, onThrow, onHaul, onFinish, onClose, onPhase });
  useEffect(() => {
    props.current = { view, onThrow, onHaul, onFinish, onClose, onPhase };
  });
  const actions = useRef<{ press: () => void; release: () => void; aimAt: (p: Pt) => void; arrow: (a: Arrow) => void } | null>(null);

  // the server's answers move the game on: the haul starts kéo lưới, a result shows the card
  const haulN = view.haul?.length ?? null;
  const hasResult = view.result !== null;
  useEffect(() => {
    const M = m.current;
    let next: Step | null = null;
    if (hasResult) next = "result";
    else if (haulN !== null && (M.step === "sink" || M.step === "wait")) {
      M.plan = arrowPlan((props.current.view.haul ?? []).map((f) => ({ weightG: f.weightG, rarity: f.rarity })));
      M.seed = crypto.getRandomValues(new Uint32Array(1))[0] | 0;
      M.roundNo = 0;
      M.round = createRound(arrowSequence(M.seed, M.plan.keys));
      M.roundAt = performance.now();
      M.mistakes = 0;
      next = "arrows";
      props.current.onPhase?.({ show: "pull" });
    }
    if (!next) return;
    M.step = next;
    const t = setTimeout(() => setStep(next), 0);
    return () => clearTimeout(t);
  }, [hasResult, haulN]);

  useEffect(() => {
    const M = m.current;
    const school = makeSchool(crypto.getRandomValues(new Uint32Array(1))[0]);
    const go = (s: Step) => {
      M.step = s;
      setStep(s);
    };
    const press = () => {
      if (M.step !== "aim") return;
      M.holdAt = performance.now();
      go("charge");
      props.current.onPhase?.({ show: "charge" });
    };
    const release = () => {
      if (M.step !== "charge") return;
      const now = performance.now();
      M.chargeMs = now - M.holdAt;
      M.q = chargeQuality(M.chargeMs);
      M.landing = landingPoint(M.aim, M.q);
      M.r = netRadius(props.current.view.radiusPx, M.q);
      M.thrownAt = now;
      go("flight");
      props.current.onPhase?.({ show: "throw", scene: M.landing, sceneR: M.r });
      props.current.onThrow(M.chargeMs);
    };
    const aimAt = (p: Pt) => {
      if (M.step === "aim" || M.step === "charge") M.aim = clampAim(p);
    };

    // --- kéo lưới
    const publish = (now: number) => {
      const r = M.round;
      setArrows({
        seq: r.seq, at: r.at, round: Math.min(M.roundNo + 1, M.plan.rounds), rounds: M.plan.rounds,
        left: Math.max(0, 1 - (now - M.roundAt) / M.plan.timerMs),
        mistakes: Math.min(MAX_MISTAKES + 1, M.mistakes + (r.done ? 0 : r.wrongs)), shake: now - M.shakeAt < 250,
        grade: M.grade && now - M.grade.at < 900 ? M.grade.grade : null,
      });
    };
    const end = (now: number) => {
      const mistakes = Math.min(MAX_MISTAKES + 1, M.mistakes);
      if (mistakes <= MAX_MISTAKES) {
        M.pullAt = now;
        go("pull");
      } else go("wait");
      props.current.onFinish(mistakes);
    };
    const nextRound = (now: number, grade: Grade) => {
      M.mistakes += roundMistakes(M.round);
      M.roundNo++;
      M.grade = { grade, at: now };
      if (M.mistakes > MAX_MISTAKES || M.roundNo >= M.plan.rounds) {
        publish(now);
        end(now);
        return;
      }
      M.round = createRound(arrowSequence(M.seed + M.roundNo * 7919, M.plan.keys));
      M.roundAt = now;
      publish(now);
    };
    const arrow = (a: Arrow) => {
      if (M.step !== "arrows") return;
      const now = performance.now();
      const before = M.round.wrongs;
      M.round = pressArrow(M.round, a);
      if (M.round.wrongs > before) {
        M.shakeAt = now;
        if (M.mistakes + M.round.wrongs > MAX_MISTAKES) {                                 // the 4th: kéo hụt
          M.mistakes += M.round.wrongs;
          M.grade = { grade: "miss", at: now };
          publish(now);
          end(now);
          return;
        }
      }
      if (M.round.done) nextRound(now, roundGrade(M.round, now - M.roundAt, M.plan.timerMs));
      else publish(now);
    };
    actions.current = { press, release, aimAt, arrow };

    let raf = requestAnimationFrame(function loop(now: number) {
      const k = M.keys;
      if (k.size && (M.step === "aim" || M.step === "charge")) {
        aimAt({
          x: M.aim.x + (k.has("ArrowRight") ? AIM_STEP : 0) - (k.has("ArrowLeft") ? AIM_STEP : 0),
          y: M.aim.y + (k.has("ArrowDown") ? AIM_STEP : 0) - (k.has("ArrowUp") ? AIM_STEP : 0),
        });
      }
      if (M.step === "flight" && now - M.thrownAt >= NET.flightMs) {
        M.sinkAt = now;
        const all = shadowsAt(school, now);
        M.caught = all.map((s) => insideNet(s, M.landing, M.r));
        M.frozen = all;
        go("sink");
        props.current.onPhase?.({ show: "sunk" });
      }
      // the net has sunk (and the server's pace allows it): haul it — once
      const v = props.current.view;
      if (M.step === "sink" && now - M.sinkAt >= NET.sinkMs) go("wait");
      if (M.step === "wait" && !M.hauled && v.throwId && v.readyAt !== null && now >= v.readyAt && !v.busy) {
        M.hauled = true;
        props.current.onHaul(M.chargeMs, offsetsFor(M.caught));
      }
      if (M.step === "arrows") {
        if (now - M.roundAt >= M.plan.timerMs) nextRound(now, "miss");                   // out of time: 1 mistake
        else publish(now);
      }

      const live = shadowsAt(school, now);
      const shadows = M.step === "aim" || M.step === "charge" || M.step === "flight"
        ? live : live.map((s, i) => (M.caught[i] ? M.frozen[i] : s));
      const power = M.step === "charge" ? ringSize(now - M.holdAt) : M.q;
      const c = canvasRef.current?.getContext("2d");
      if (c && M.step !== "result") {
        const phase: NetPhase = M.step === "wait" ? (M.plan.rounds > 0 ? "arrows" : "sink") : M.step;
        c.clearRect(0, 0, SCENE.w, SCENE.h);
        drawNetScene(c, {
          phase, t: now, shadows, aim: M.aim, power,
          r: M.step === "aim" || M.step === "charge" ? netRadius(v.radiusPx, M.step === "charge" ? power : 1) : M.r,
          landing: M.landing,
          k: M.step === "flight" ? (now - M.thrownAt) / NET.flightMs : M.step === "pull" ? (now - M.pullAt) / PULL_MS : 1,
          caught: M.caught, sweet: NET.sweet, w: SCENE.w, h: SCENE.h, shore: SCENE.shore, hands: SCENE.hands,
          squash: SCENE.squash,
        });
      }
      const row = rowRef.current?.getContext("2d");
      if (row && M.step === "arrows") {
        row.clearRect(0, 0, ROW_W, ROW_H);
        drawArrowRow(row, Math.floor((ROW_W - M.round.seq.length * 13 + 2) / 2), 0, M.round.seq, M.round.at, now - M.shakeAt < 250);
      }
      raf = requestAnimationFrame(loop);
    });

    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.code === "Escape") {
        if (M.step === "aim" || M.step === "charge" || M.step === "result") {
          e.preventDefault();
          props.current.onClose();
        }
        return;
      }
      if (M.step === "arrows") {
        const a = arrowForKey(e.code);
        if (a) {
          e.preventDefault();
          if (!e.repeat) arrow(a);
        }
        return;
      }
      if (e.code.startsWith("Arrow")) {
        e.preventDefault();
        M.keys.add(e.code);
        return;
      }
      if (e.code !== "Space") return;
      e.preventDefault();
      if (!e.repeat) press();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code.startsWith("Arrow")) M.keys.delete(e.code);
      if (e.code === "Space") release();
    };
    const blur = () => {
      M.keys.clear();
      release();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      cancelAnimationFrame(raf);
      actions.current = null;
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const toScene = (e: React.PointerEvent): Pt | null => {
    const el = canvasRef.current;
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: ((e.clientX - b.left) / b.width) * SCENE.w, y: ((e.clientY - b.top) / b.height) * SCENE.h };
  };
  const result = view.result;
  const fishN = view.haul?.length ?? 0;

  return (
    <div className={NET_DOCK} role="dialog" aria-label="Quăng lưới">
      <div className={NET_PANEL}>
        <div className="flex items-baseline justify-between gap-2 text-lg">
          <span>🕸️ {view.name}</span>
          <span className="opacity-80">còn {Math.max(0, view.left - (view.throwId ? 1 : 0))}/{view.max} lần quăng</span>
        </div>
        {step !== "result" ? (
          <canvas
            ref={canvasRef}
            width={SCENE.w}
            height={SCENE.h}
            className={NET_CANVAS}
            style={{ imageRendering: "pixelated", aspectRatio: `${SCENE.w} / ${SCENE.h}`, cursor: step === "aim" || step === "charge" ? "crosshair" : "default" }}
            onPointerMove={(e) => { const p = toScene(e); if (p) actions.current?.aimAt(p); }}
            onPointerDown={(e) => {
              const p = toScene(e);
              if (p) actions.current?.aimAt(p);
              if (step === "aim") e.currentTarget.setPointerCapture?.(e.pointerId);
              actions.current?.press();
            }}
            onPointerUp={() => actions.current?.release()}
            onPointerCancel={() => actions.current?.release()}
            aria-label="Mặt ao phía trước"
          />
        ) : (
          <ResultCard result={result} speciesName={speciesName} />
        )}
        {step === "arrows" && arrows && (
          <div className="flex flex-col items-center gap-1" aria-live="polite">
            <div className="flex w-full items-baseline justify-between text-lg">
              <span>Lượt {arrows.round}/{arrows.rounds} · 🐟×{fishN}</span>
              {arrows.grade && (
                <span className={arrows.grade === "miss" ? "text-burgundy" : "text-[#2e7d32]"}>{GRADE_TEXT[arrows.grade]}</span>
              )}
              <span className={arrows.mistakes > 0 ? "text-burgundy" : ""}>Sai: {Math.min(arrows.mistakes, MAX_MISTAKES + 1)}/{MAX_MISTAKES}</span>
            </div>
            <canvas
              ref={rowRef}
              width={ROW_W}
              height={ROW_H}
              aria-label={`Dãy phím: ${arrows.seq.map((a) => ARROW_GLYPH[a]).join(" ")}`}
              style={{ width: ROW_W * 4, maxWidth: "100%", imageRendering: "pixelated", transform: arrows.shake ? "translateX(3px)" : undefined }}
            />
            <div className="h-2 w-full overflow-hidden rounded-sm border border-ink bg-parchment-300" role="progressbar"
              aria-label="Thời gian" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(arrows.left * 100)}>
              <div className="h-full" style={{ width: `${arrows.left * 100}%`, background: arrows.left > 0.35 ? "#4caf50" : "#e5533d" }} />
            </div>
            <div className="grid grid-cols-4 gap-2 pt-1 pointer-fine:hidden">
              {ARROWS.map((a) => (
                <button key={a} type="button" className="pch-btn h-14 w-14 text-3xl" onPointerDown={() => actions.current?.arrow(a)} aria-label={a}>
                  {ARROW_GLYPH[a]}
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="rounded-sm bg-ink/85 px-2 py-1 text-center text-2xl text-parchment" aria-live="polite">
          {step === "result" ? resultLine(result) : TEXT[step]}
          {step === "charge" ? " (vùng xanh = lưới bung đủ, rơi đúng chỗ)" : ""}
        </p>
        <div className="flex justify-end gap-2 text-lg">
          {(step === "aim" || step === "charge" || step === "result") && (
            <button type="button" className="pch-btn" onClick={onClose}>{step === "result" ? "Đóng" : "Thôi (Esc)"}</button>
          )}
        </div>
      </div>
    </div>
  );
}

function resultLine(result: NetView["result"]): string {
  if (!result) return "";
  if ("lost" in result) return result.lost === "expired" ? "Lưới trôi mất rồi." : "Kéo vội quá, cá thoát hết rồi.";
  const escaped = result.escaped > 0 ? ` (sót ${result.escaped} con)` : "";
  return result.count > 0 ? `Kéo lưới được ${result.count} con cá!${escaped}` : `Lưới rỗng — không còn con nào.${escaped}`;
}

/** The pulled bundle with the fish flapping in it, and the catch listed. */
function ResultCard({ result, speciesName }: { result: NetView["result"]; speciesName: (id: string) => string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const count = result && !("lost" in result) ? result.count : 0;
  useEffect(() => {
    let raf = requestAnimationFrame(function loop(t: number) {
      const c = ref.current?.getContext("2d");
      if (c) {
        c.clearRect(0, 0, 40, 40);
        drawNetBundle(c, 20, 2, count, t);
      }
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [count]);
  const fish = result && !("lost" in result) ? result.fish : [];
  return (
    <div className="flex items-center gap-3 rounded-sm border-2 border-ink bg-parchment-300/60 p-2">
      <canvas ref={ref} width={40} height={40} aria-hidden="true" style={{ width: 120, height: 120, imageRendering: "pixelated" }} />
      <ul className="flex flex-col gap-0.5 text-xl">
        {fish.length === 0 && <li className="opacity-80">Không có con nào.</li>}
        {fish.map((f, i) => <li key={f.id || i}>🐟 {speciesName(f.speciesId)} · {formatWeight(f.weightG)}</li>)}
      </ul>
    </div>
  );
}
