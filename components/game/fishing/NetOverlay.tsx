"use client";

import { useEffect, useRef, useState } from "react";
import { drawArrowRow, drawNetBundle, drawNetScene, type NetPhase } from "@/lib/game/art/net";
import { formatWeight } from "@/lib/game/fishing/catalog";
import { netLostText } from "@/lib/game/fishing/messages";
import {
  ARROW_GLYPH, ARROWS, arrowAdvance, arrowForKey, arrowGame, arrowPress, clampAimInt, MAX_MISTAKES, NETX, netArrowPlan,
  netHaulReplay, netQuality, netRadiusMilli, netSchool, netShadowsAt, roundGrade, SCENE, TickClock,
  type Arrow, type ArrowGame, type NetHaulReplay, type NetSchool, type NetShadow, type Pt,
} from "@/lib/game/fishing/net";
import { isTyping } from "@/lib/game/keys";
import type { NetInput } from "@/lib/game/fishing/netcast";
import type { NetPull, NetThrow } from "@/lib/game/fishing/rpc";
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

type Step = "load" | NetPhase | "wait" | "result";
type Grade = "perfect" | "good" | "miss";

/** Scene px from the replay's milli-px. */
const px = (s: NetShadow) => ({ x: s.x / 1000, y: s.y / 1000, dir: s.dir, size: s.size });

interface Machine {
  step: Step;
  aim: Pt;
  keys: Set<string>;
  /** The school's clock (tick 0 = the start_net answer) and the school; null until the answer. */
  clock: TickClock | null;
  school: NetSchool | null;
  press: number;
  release: number;
  /** The throw as the server will replay it (at the release). */
  throw: NetHaulReplay | null;
  aimI: Pt;
  /** Where the shadows were when the net closed over them (scene px). */
  frozen: ReturnType<typeof px>[];
  hauled: boolean;
  pullAt: number;
  /** Kéo lưới: its clock (tick 0 = the haul answer), the game and the keys it took. */
  aclock: TickClock | null;
  game: ArrowGame | null;
  sent: number[];
  finished: boolean;
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
  load: "Đang chuẩn bị lưới…",
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
 * v18.2 Quăng lưới (spec §18.2, the owner's redesign; server-replayed since 0056): fish shadows swim in front of me —
 * where, from the server's seed; a ring follows the mouse (or the arrow keys) within the throw's range; holding fills a
 * power bar whose top is green; the release throws the net in an arc and it opens into a circle (short and small without
 * the green); it sinks 1.5 s and the shadows under it are caught (net_haul sends the press and release ticks with the
 * aim); then kéo lưới: rounds of arrow sequences — from the server's second seed — typed with the arrow keys / WASD /
 * the on-screen buttons before each round's timer runs out (finish_net sends every key with its tick). Each wrong key
 * and each timed-out round is a mistake: one fish escapes per mistake, the 4th pulls me into the pond. Everything runs on
 * 60 Hz ticks, never ahead of real time. Esc gives up before the throw (nothing is spent).
 */
export default function NetOverlay({ view, speciesName, onHaul, onFinish, onClose, onExpire, onPhase }: {
  view: NetView;
  speciesName: (id: string) => string;
  onHaul: (input: NetThrow) => void;
  onFinish: (pull: NetPull) => void;
  onClose: () => void;
  /** The aim ran past NETX.aimTicks: the throw lapses (nothing spent). */
  onExpire?: () => void;
  /** v18.2: each phase, for the others to see (the throw carries where the net lands). */
  onPhase?: (inp: NetInput) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rowRef = useRef<HTMLCanvasElement>(null);
  const [step, setStep] = useState<Step>("load");
  const [arrows, setArrows] = useState<ArrowsView | null>(null);
  const [released, setReleased] = useState(false);
  const m = useRef<Machine>({
    step: "load", aim: { x: SCENE.hands.x, y: 40 }, keys: new Set(), clock: null, school: null, press: 0, release: 0,
    throw: null, aimI: { x: 0, y: 0 }, frozen: [], hauled: false, pullAt: 0, aclock: null, game: null, sent: [],
    finished: false, grade: null, shakeAt: 0,
  });
  const props = useRef({ view, onHaul, onFinish, onClose, onExpire, onPhase });
  useEffect(() => {
    props.current = { view, onHaul, onFinish, onClose, onExpire, onPhase };
  });
  const actions = useRef<{ press: () => void; release: () => void; aimAt: (p: Pt) => void; arrow: (a: Arrow) => void } | null>(null);

  // the server's answers move the game on: start_net's seed starts the aim, the haul starts kéo lưới, a result the card
  const { throwId, seed, openedAt, haulAt, arrowSeed } = view;
  const haulN = view.haul?.length ?? null;
  const hasResult = view.result !== null;
  useEffect(() => {
    const M = m.current;
    let next: Step | null = null;
    if (hasResult) next = "result";
    else if (haulN !== null && haulAt !== null && (M.step === "sink" || M.step === "wait")) {
      const plan = netArrowPlan((props.current.view.haul ?? []).map((f) => ({ weightG: f.weightG, rarity: f.rarity })));
      M.aclock = new TickClock(haulAt);
      M.game = arrowGame(arrowSeed, plan);
      M.sent = [];
      next = "arrows";
      props.current.onPhase?.({ show: "pull" });
    } else if (throwId && openedAt !== null && M.step === "load") {
      M.clock = new TickClock(openedAt);
      M.school = netSchool(seed);
      next = "aim";
    }
    if (!next) return;
    M.step = next;
    const t = setTimeout(() => setStep(next), 0);
    return () => clearTimeout(t);
  }, [hasResult, haulN, haulAt, arrowSeed, throwId, openedAt, seed]);

  useEffect(() => {
    const M = m.current;
    const go = (s: Step) => {
      M.step = s;
      setStep(s);
    };
    const press = () => {
      if (M.step !== "aim" || !M.clock) return;
      M.press = M.clock.advance(performance.now());
      go("charge");
      props.current.onPhase?.({ show: "charge" });
    };
    const release = () => {
      if (M.step !== "charge" || !M.clock || !M.school) return;
      M.release = M.clock.advance(performance.now());
      M.aimI = clampAimInt(M.aim);
      M.throw = netHaulReplay(props.current.view.seed, props.current.view.radiusPx,
        { press: M.press, release: M.release, aimX: M.aimI.x, aimY: M.aimI.y });
      go("flight");
      setReleased(true);
      props.current.onPhase?.({ show: "throw", scene: { x: M.throw.landX / 1000, y: M.throw.landY / 1000 }, sceneR: M.throw.r / 1000 });
    };
    const aimAt = (p: Pt) => {
      if (M.step !== "aim" && M.step !== "charge") return;
      const a = clampAimInt(p);                                                       // on the water, within range
      M.aim = { x: a.x / 1000, y: a.y / 1000 };
    };

    // --- kéo lưới
    const publish = (tick: number, now: number) => {
      const g = M.game;
      if (!g) return;
      setArrows({
        seq: g.seq, at: g.at, round: Math.min(g.round + 1, g.plan.rounds), rounds: g.plan.rounds,
        left: g.done ? 0 : Math.max(0, 1 - (tick - g.start) / g.plan.timer),
        mistakes: Math.min(MAX_MISTAKES + 1, g.mistakes + (g.done ? 0 : g.wrongs)), shake: now - M.shakeAt < 250,
        grade: M.grade && now - M.grade.at < 900 ? M.grade.grade : null,
      });
    };
    const end = (now: number) => {
      const g = M.game;
      if (!g || M.finished) return;
      M.finished = true;
      const mistakes = Math.min(MAX_MISTAKES + 1, g.mistakes);
      if (mistakes <= MAX_MISTAKES) {
        M.pullAt = now;
        go("pull");
      } else go("wait");
      props.current.onFinish({ keys: M.sent.slice(), ticks: g.end, mistakes });
    };
    /** The game moved from `before` to `after`: flash a finished round's grade, and end it once done. */
    const moved = (before: ArrowGame, after: ArrowGame, tick: number, now: number) => {
      if (after.round > before.round || (after.done && !before.done)) {
        const clean = after.mistakes === before.mistakes && after.round > before.round && after.wrongs === 0;
        M.grade = { grade: roundGrade(clean, tick - before.start, before.plan.timer), at: now };
      }
      M.game = after;
      publish(tick, now);
      if (after.done) end(now);
    };
    const arrow = (a: Arrow) => {
      if (M.step !== "arrows" || !M.game || !M.aclock) return;
      const now = performance.now();
      const tick = M.aclock.advance(now);
      const due = arrowAdvance(M.game, tick);                                         // time-outs up to this key first
      if (due !== M.game) moved(M.game, due, tick, now);
      if (due.done) return;
      M.sent.push(tick * 4 + ARROWS.indexOf(a));
      const after = arrowPress(due, tick, a);
      if (after.wrongs > due.wrongs) M.shakeAt = now;                                     // a wrong key (the 4th ends it)
      moved(due, after, tick, now);
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
      const tick = M.clock ? M.clock.advance(now) : 0;
      const v = props.current.view;
      if (M.step === "aim" && tick >= NETX.aimTicks) {
        M.step = "result";                                                               // lapsed: nothing was spent
        props.current.onExpire?.();
      }
      if (M.step === "charge" && tick >= NETX.maxRelease) release();
      const T = M.throw;
      if (M.step === "flight" && T && tick >= T.landTick && M.school) {
        M.frozen = netShadowsAt(M.school, T.landTick).map(px);
        go("sink");
        props.current.onPhase?.({ show: "sunk" });
      }
      // the net has sunk: haul it — once, with the throw's input
      if (M.step === "sink" && T && tick >= T.landTick + NETX.sinkTicks) go("wait");
      if (M.step === "wait" && T && !M.hauled && v.throwId && !v.busy) {
        M.hauled = true;
        props.current.onHaul({ press: M.press, release: M.release, aimX: M.aimI.x, aimY: M.aimI.y, hits: T.hits });
      }
      if (M.step === "arrows" && M.game && M.aclock) {
        const at = M.aclock.advance(now);
        const due = arrowAdvance(M.game, at);
        if (due !== M.game) moved(M.game, due, at, now);
        else publish(at, now);
      }

      const school = M.school;
      const live = school ? netShadowsAt(school, tick).map(px) : [];
      const caught = T && M.step !== "aim" && M.step !== "charge" && M.step !== "flight" ? T.caught : [];
      const shadows = caught.length ? live.map((s, i) => (caught[i] ? M.frozen[i] ?? s : s)) : live;
      const power = M.step === "charge" && school ? netQuality(tick - M.press, school.period) / 1000 : (T?.quality ?? 0) / 1000;
      const c = canvasRef.current?.getContext("2d");
      if (c && M.step !== "result") {
        const phase: NetPhase = M.step === "load" ? "aim" : M.step === "wait" ? (M.game ? "arrows" : "sink") : M.step;
        c.clearRect(0, 0, SCENE.w, SCENE.h);
        drawNetScene(c, {
          phase, t: now, shadows, aim: M.aim, power,
          r: M.step === "aim" || M.step === "charge" || M.step === "load"
            ? netRadiusMilli(v.radiusPx, M.step === "charge" ? Math.round(power * 1000) : 1000) / 1000 : (T?.r ?? 0) / 1000,
          landing: T ? { x: T.landX / 1000, y: T.landY / 1000 } : { x: 0, y: 0 },
          k: M.step === "flight" && T ? Math.min(1, (tick - M.release) / NETX.flightTicks) : M.step === "pull" ? (now - M.pullAt) / PULL_MS : 1,
          caught, sweet: NETX.sweet / 1000, w: SCENE.w, h: SCENE.h, shore: SCENE.shore, hands: SCENE.hands,
          squash: SCENE.squash,
        });
      }
      const row = rowRef.current?.getContext("2d");
      if (row && M.step === "arrows" && M.game) {
        row.clearRect(0, 0, ROW_W, ROW_H);
        drawArrowRow(row, Math.floor((ROW_W - M.game.seq.length * 13 + 2) / 2), 0, M.game.seq, M.game.at, now - M.shakeAt < 250);
      }
      raf = requestAnimationFrame(loop);
    });

    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.code === "Escape") {
        if (M.step === "load" || M.step === "aim" || M.step === "charge" || M.step === "result") {
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
          <span className="opacity-80">còn {Math.max(0, view.left - (released ? 1 : 0))}/{view.max} lần quăng</span>
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
          {(step === "load" || step === "aim" || step === "charge" || step === "result") && (
            <button type="button" className="pch-btn" onClick={onClose}>{step === "result" ? "Đóng" : "Thôi (Esc)"}</button>
          )}
        </div>
      </div>
    </div>
  );
}

function resultLine(result: NetView["result"]): string {
  if (!result) return "";
  if ("lost" in result) return netLostText(result.lost);
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
