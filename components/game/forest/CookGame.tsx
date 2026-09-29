"use client";

// 0096 Đầu bếp: the cooking minigame's overlay — 2–3 steps, each shown 0.5 s before it starts (mg_sync('cook')):
// thái (press Space on the two beats), khuấy (hold Space, let go when the bar reaches the mark), canh lửa (press Space
// while the swinging heat is in the green band). Presses and releases go up as they are made; cook_finish replays
// them (lib/game/forest/games.ts cookScore is the same rule) — 0–39 Hỏng, 40–69 Đạt, 70–89 Ngon, 90+ Tuyệt phẩm.
import { useCallback, useEffect, useRef, useState } from "react";
import { recipeById } from "@/lib/game/forest/catalog";
import { heatAt, parseStep, type CookStepEv } from "@/lib/game/forest/games";
import { GATE_GUARD_MS, liveTick, useLive, type LiveSync } from "@/lib/game/mglive";
import { isTyping } from "@/lib/game/keys";

export interface CookView {
  recipe: string;
  steps: string[];
  phase: "playing" | "sending" | "done";
  message: string;
  live: LiveSync | null;
}

const STEP_NAME: Record<number, string> = { 1: "🔪 Thái — bấm đúng nhịp", 2: "🥄 Khuấy — giữ, thả đúng vạch", 3: "🔥 Canh lửa — bấm khi lửa vào vùng xanh" };

export default function CookGame({ view, onEnd, onClose }: {
  view: CookView;
  onEnd: (a: number[] | null, b: number[]) => void;
  onClose: () => void;
}) {
  const a = useRef<number[]>([]);
  const b = useRef<number[]>([]);
  const inputs = useCallback((): [readonly number[] | null, readonly number[] | null] => [a.current, b.current], []);
  const live = useLive(view.phase === "playing" ? view.live : null, inputs);
  const [tick, setTick] = useState(0);
  const [holding, setHolding] = useState<number | null>(null);
  const ended = useRef(false);
  const n = view.steps.length;

  useEffect(() => {
    if (view.phase !== "playing" || !live.ready) return;
    let raf = 0;
    const loop = () => { setTick(liveTick(live.t0, performance.now())); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [view.phase, live.ready, live.t0]);

  const steps: CookStepEv[] = [];
  for (let i = 1; i <= n; i++) { const s = parseStep(live.events[i]); if (s) steps.push(s); }
  const cur = steps.find((s) => tick < s.end) ?? null;
  const curIdx = cur ? steps.indexOf(cur) + 1 : 0;
  const end = steps.length === n && n > 0 ? steps[n - 1].end : null;

  const finish = useCallback((ok: boolean) => {
    if (ended.current) return;
    ended.current = true;
    live.stop();
    onEnd(ok ? a.current.slice() : null, b.current.slice());
  }, [live, onEnd]);
  useEffect(() => { if (view.phase === "playing" && end !== null && tick > end) finish(true); }, [tick, end, view.phase, finish]);
  useEffect(() => { if (view.phase === "playing" && live.failed) finish(false); }, [live.failed, view.phase, finish]);

  /** May an input go now: the current step shown a moment ago and started. */
  const open = useCallback((): { t: number; s: CookStepEv } | null => {
    if (view.phase !== "playing" || !live.ready || !cur) return null;
    const shown = live.at.current?.[curIdx];
    const t = liveTick(live.t0, performance.now());
    if (shown === undefined || performance.now() - shown < GATE_GUARD_MS || t < cur.start || t >= cur.end) return null;
    return { t, s: cur };
  }, [view.phase, live, cur, curIdx]);

  const down = useCallback(() => {
    const o = open();
    if (!o || a.current.length >= 12) return;
    a.current = [...a.current, o.t];
    if (o.s.kind === 2) setHolding(o.t);
    live.flush();
  }, [open, live]);
  const up = useCallback(() => {
    if (holding === null) return;
    setHolding(null);
    const t = liveTick(live.t0, performance.now());
    if (b.current.length < 6) { b.current = [...b.current, t]; live.flush(); }
  }, [holding, live]);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.code === "Space" || e.code === "KeyE") { e.preventDefault(); if (!e.repeat) down(); }
      else if (e.code === "Escape") { e.preventDefault(); if (view.phase === "playing") finish(false); else onClose(); }
    };
    const onUp = (e: KeyboardEvent) => { if (e.code === "Space" || e.code === "KeyE") { e.preventDefault(); up(); } };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => { window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); };
  }, [down, up, finish, onClose, view.phase]);

  const recipe = recipeById(view.recipe);
  let body: React.ReactNode = <p className="text-sm">Chuẩn bị…</p>;
  if (cur && tick >= cur.start - 30) {
    if (cur.kind === 1) {
      body = (
        <div className="relative h-10 rounded bg-[#5a4030]">
          <div className="absolute inset-y-0 left-8 w-1 bg-amber-200" />
          {[cur.p1, cur.p2].map((bt, i) => {
            const dx = bt - tick;
            return dx < -15 || dx > 70 ? null : <div key={i} className="absolute top-2 h-6 w-6 -translate-x-1/2 rounded-full bg-lime-300" style={{ left: 32 + (dx / 70) * 260 }} />;
          })}
        </div>
      );
    } else if (cur.kind === 2) {
      const held = holding === null ? 0 : tick - holding;
      body = (
        <div className="relative h-6 rounded bg-[#5a4030]">
          <div className="absolute inset-y-0 left-0 bg-amber-400" style={{ width: `${Math.min(100, (held / (cur.p1 * 1.5)) * 100)}%` }} />
          <div className="absolute inset-y-0 w-1 bg-lime-300" style={{ left: `${(1 / 1.5) * 100}%` }} />
        </div>
      );
    } else {
      const h = tick >= cur.start ? heatAt(cur, tick) : 0;
      body = (
        <div className="relative h-6 rounded bg-[#402a20]">
          <div className="absolute inset-y-0 bg-lime-500/60" style={{ left: `${cur.p3 - 8}%`, width: "16%" }} />
          <div className="absolute inset-y-0 w-1 bg-orange-400" style={{ left: `${h}%` }} />
        </div>
      );
    }
  }

  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-28 z-20 mx-auto w-[min(92vw,360px)] font-vt" role="dialog" aria-label="Nấu ăn">
      <div className="pch p-2 text-base">
        <div className="flex items-center justify-between">
          <b>🍳 {recipe?.name ?? "Nấu ăn"}</b>
          <span className="text-sm">Bước {Math.max(1, curIdx)}/{n}</span>
        </div>
        <p className="mb-1 text-sm">{cur ? STEP_NAME[cur.kind] : " "}</p>
        {view.phase === "playing" ? (
          <>
            {body}
            <button type="button" className="pch-btn pch-btn-primary mt-2 w-full py-1 text-lg"
              onPointerDown={(e) => { e.preventDefault(); down(); }} onPointerUp={up} onPointerLeave={up}>
              Bấm / giữ <span className="pointer-coarse:hidden">(Space)</span>
            </button>
          </>
        ) : (
          <div>
            <p className="whitespace-pre-line text-sm">{view.phase === "sending" ? "Đang chấm…" : view.message}</p>
            {view.phase === "done" && <button type="button" className="pch-btn mt-1 w-full" onClick={onClose}>Đóng</button>}
          </div>
        )}
      </div>
    </div>
  );
}
