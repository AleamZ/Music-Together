"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RowView } from "@/hooks/useExplore";
import { isTyping } from "@/lib/game/keys";
import { liveTick, useLive } from "@/lib/game/mglive";
import { paddleSplash } from "@/lib/game/river/beep";
import { canStroke, createRowFrom, ROW, stepRow, withBeats, type RowState, type Side } from "@/lib/game/river/row";

export const ROW_HELP = "Chèo đều theo nhịp: bấm ← / → (A / D) hoặc chạm mái chèo trái / phải khi nhịp chạm vạch.";

const W = 240, H = 150;          // the scene, in pixels (drawn 2× and pixelated)
const LANE_X: Record<Side, number> = { 0: 70, 1: 170 };
const HIT_Y = 118;               // the stroke line
const PX_PER_TICK = 1.6;         // how fast the beats come down

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** The scene: the river scrolling past, the ghe bobbing with its wake, the two lanes of beats and the stroke line. */
function paint(c: CanvasRenderingContext2D, s: RowState, dir: RowView["dir"], reduced: boolean): void {
  const t = s.tick;
  const flow = reduced ? 0 : (t * (1 + s.hits * 0.15)) % 40;
  // water and banks
  c.fillStyle = "#3f7478"; c.fillRect(0, 0, W, H);
  c.fillStyle = "#46807f"; c.fillRect(20, 0, W - 40, H);
  c.fillStyle = "#6aa23c"; c.fillRect(0, 0, 18, H); c.fillRect(W - 18, 0, 18, H);
  c.fillStyle = "#8a6a3f"; c.fillRect(18, 0, 3, H); c.fillRect(W - 21, 0, 3, H);
  for (let y = -40; y < H; y += 20) {
    c.fillStyle = "#9aa84a";
    c.fillRect(6, y + flow, 2, 8); c.fillRect(W - 10, y + 10 + flow, 2, 8);
  }
  for (let k = 0; k < 14; k++) {
    const y = ((k * 37 + flow * 2) % (H + 10)) - 5;
    c.fillStyle = "#8cc4bc"; c.fillRect(28 + ((k * 53) % (W - 60)), y, 6, 1);
  }
  // the stroke line and the lane marks
  for (const side of [0, 1] as const) {
    const x = LANE_X[side];
    c.fillStyle = "rgba(255,255,255,0.12)"; c.fillRect(x - 12, 0, 24, H);
    c.fillStyle = "#3a2418"; c.fillRect(x - 13, HIT_Y - 1, 26, 3);
    c.fillStyle = "#f4efe0"; c.fillRect(x - 12, HIT_Y, 24, 1);
  }
  // the beats coming down: a paddle blade per beat, gold when hit, grey when missed
  s.beats.targets.forEach((target, b) => {
    const y = HIT_Y - (target - t) * PX_PER_TICK;
    if (y < -10 || y > H + 10) return;
    const x = LANE_X[s.beats.sides[b]];
    const mark = s.marks[b];
    c.fillStyle = "#3a2418"; c.fillRect(x - 7, y - 5, 14, 10);
    c.fillStyle = mark === "hit" ? "#ffe08a" : mark === "miss" ? "#8a8178" : b === s.beat ? "#f4efe0" : "#c8905c";
    c.fillRect(x - 6, y - 4, 12, 8);
    c.fillStyle = "#6e4424"; c.fillRect(x - 1, y - 4, 2, 8);
  });
  // the ghe, bobbing, its wake behind
  const bob = reduced ? 0 : Math.sin(t / 9) > 0.3 ? 1 : 0;
  const bx = W / 2, by = 96 + bob;
  if (!reduced) {
    for (let k = 1; k <= 4; k++) {
      const d = k * 8 + (t % 8);
      c.fillStyle = k < 3 ? "#d6ece4" : "#a6d6e8";
      c.fillRect(bx - 6 - k * 3, by + 16 + d, 3, 1); c.fillRect(bx + 4 + k * 3, by + 16 + d, 3, 1);
    }
  }
  c.fillStyle = "#3a2418"; c.fillRect(bx - 9, by - 18, 18, 36);
  c.fillStyle = "#8b5a33"; c.fillRect(bx - 8, by - 16, 16, 32);
  c.fillStyle = "#a8743f"; c.fillRect(bx - 7, by - 16, 2, 32);
  c.fillStyle = "#5a381e"; c.fillRect(bx - 5, by - 6, 10, 12);
  c.fillStyle = "#3a2418"; c.fillRect(bx - 3, by - 22, 6, 4); c.fillRect(bx - 2, by + 18, 4, 3);
  // the rower's nón lá and the paddle on the last stroke's side
  c.fillStyle = "#e6d2b0"; c.fillRect(bx - 5, by - 3, 10, 5);
  c.fillStyle = "#c8a870"; c.fillRect(bx - 2, by - 4, 4, 2);
  const last = s.last && t - s.last.at < 14 ? s.last : null;
  const side = last ? last.side : (Math.floor(t / 30) % 2) as Side;
  const px = side === 0 ? bx - 16 : bx + 12;
  c.fillStyle = "#c8905c"; c.fillRect(Math.min(px, bx) + (side === 0 ? 0 : -8), by - 1, 12, 2);
  c.fillStyle = "#a8743f"; c.fillRect(px, by - 3 + (last ? 4 : 0), 4, 7);
  if (last) {
    c.fillStyle = last.kind === "hit" ? "#ffffff" : "#6aa6a4";
    for (let k = 0; k < 5; k++) c.fillRect(px - 2 + k * 2, by + 6 - ((t - last.at) >> 1) - (k % 2) * 2, 1, 1);
  }
  // the goal: the far bank's jetty grows nearer as beats are hit
  const near = s.hits / s.need;
  c.fillStyle = "#6e4424"; c.fillRect(bx - 20, 4, 40, Math.min(18, 4 + near * 14));
  c.fillStyle = "#3a2418"; c.fillRect(bx - 20, 4, 40, 1);
  c.fillStyle = "#f4efe0"; c.font = "8px monospace"; c.textAlign = "center";
  c.fillText(dir === "out" ? "Sông Cái" : "Bến ao", bx, 14);
}

function Playing({ view, onEnd, onQuit }: { view: RowView; onEnd: (strokes: readonly number[], ticks: number) => void; onQuit: () => void }) {
  const [s, setS] = useState(() => createRowFrom(view.need));
  const pending = useRef<Side | null>(null);
  const over = useRef(false);
  const cb = useRef(onEnd);
  const cv = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    cb.current = onEnd;
  });
  // 0087: the beats come from mg_sync('row') 1.5 s ahead (they show 80 ticks ahead); the strokes go up live
  const strokes = useRef<number[]>([]);
  const live = useLive(view.live, () => [strokes.current, null]);
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  });
  const stroke = useCallback((side: Side) => {
    pending.current = side;
  }, []);

  useEffect(() => {
    if (!live.ready) return;
    const reduced = reducedMotion();
    const t0 = live.t0;
    let cur = createRowFrom(view.need);
    let raf = requestAnimationFrame(function loop(now: number) {
      const due = liveTick(t0, now);
      cur = withBeats(cur, liveRef.current.ev.current ?? {});
      while (cur.tick < due && cur.outcome === "open") {
        // strokes during the countdown are ignored here (never sent), so an eager tap is not a stray
        const want = pending.current !== null && canStroke(cur) && cur.tick >= ROW.lead - ROW.win - 4 ? pending.current : null;
        pending.current = null;
        const before = cur.hits;
        cur = stepRow(cur, want);
        if (want !== null) { paddleSplash(cur.hits > before); strokes.current = cur.strokes; }
      }
      setS(cur);
      const c = cv.current?.getContext("2d");
      if (c) paint(c, cur, view.dir, reduced);
      if (cur.outcome !== "open") {
        if (!over.current) {
          over.current = true;
          liveRef.current.stop();
          cb.current(cur.strokes.slice(), cur.tick);
        }
        return;
      }
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [view.need, view.dir, live.ready, live.t0]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.repeat) return;
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") { e.preventDefault(); stroke(0); }
      else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") { e.preventDefault(); stroke(1); }
      else if (e.key === "Escape") onQuit();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [stroke, onQuit]);

  const countdown = s.tick < ROW.lead - 10 ? Math.ceil((ROW.lead - 10 - s.tick) / 30) : null;
  if (!live.ready) return <p role="status">Chuẩn bị…</p>;
  return (
    <div className="flex w-full flex-col items-center gap-2">
      <div className="relative">
        <canvas ref={cv} width={W} height={H} className="block h-[300px] w-[480px] max-w-full rounded border-2 border-[#3a2418]"
          style={{ imageRendering: "pixelated" }} aria-hidden="true" />
        {countdown !== null && (
          <span className="absolute inset-0 flex items-center justify-center font-vt text-6xl text-parchment drop-shadow-[0_2px_0_#3a2418]">{countdown}</span>
        )}
        {s.last && s.tick - s.last.at < 20 && (
          <span className={`absolute top-2 font-vt text-2xl drop-shadow-[0_1px_0_#3a2418] ${s.last.kind === "hit" ? "text-[#ffe08a]" : "text-[#d6ece4]"} ${s.last.side === 0 ? "left-4" : "right-4"}`}>
            {s.last.kind === "hit" ? "Chuẩn!" : "Lệch!"}
          </span>
        )}
      </div>
      <p>Trúng {s.hits}/{view.need} nhịp{s.stray > 0 ? ` · lệch ${s.stray}/${ROW.maxStray}` : ""}</p>
      <div className="flex w-full gap-2">
        <button type="button" className="pch-btn flex-1 touch-none py-3 text-2xl" onPointerDown={(e) => { e.preventDefault(); stroke(0); }}>⬅️ Trái</button>
        <button type="button" className="pch-btn flex-1 touch-none py-3 text-2xl" onPointerDown={(e) => { e.preventDefault(); stroke(1); }}>Phải ➡️</button>
      </div>
      <p className="text-base opacity-80">{ROW_HELP}</p>
    </div>
  );
}

/** v22 (0086) Chèo ghe: the rowing rhythm between Cầu ao and Sông Cái (0086 replays the strokes and moves me). */
export default function RowGame({ view, onEnd, onClose }: { view: RowView; onEnd: (strokes: readonly number[], ticks: number) => void; onClose: () => void }) {
  const r = view.result;
  useEffect(() => {
    if (view.phase !== "done") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isTyping(e.target)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view.phase, onClose]);
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="Chèo ghe">
      <div className="pch flex w-[32rem] max-w-full flex-col items-center gap-2 p-3 text-center font-vt text-lg leading-tight">
        <h2 className="font-vt text-2xl leading-none text-burgundy">{view.dir === "out" ? "🛶 Chèo ra Sông Cái" : "🛶 Chèo về bến Ao cá"}</h2>
        {view.phase === "starting" && <p role="status">Đang tháo dây neo…</p>}
        {view.phase === "playing" && <Playing view={view} onEnd={onEnd} onQuit={onClose} />}
        {view.phase === "sending" && <p role="status">Thuyền đang lướt…</p>}
        {view.phase === "done" && r && (
          <>
            <p role="status" className="text-xl">
              {r.result === "arrived"
                ? (r.pass ? `Thuyền lướt êm quá! (${r.hits}/${r.need} nhịp) — ${r.to.map === "song_cai" ? "tới Sông Cái rồi!" : "về bến rồi nhé!"}` : `Chèo lệch nhịp mấy lần, nhưng cũng về bến rồi (${r.hits}/${r.need}).`)
                : r.why === "missed" ? `Chèo lệch nhịp rồi (${r.hits}/${r.need}) — ghe trôi lại bến. Thử lại nhé!`
                  : r.why === "expired" ? "Chuyến chèo đã quá lâu — chèo lại nhé." : "Chuyến chèo không hợp lệ."}
            </p>
            {r.result !== "arrived" && <button type="button" className="pch-btn pch-btn-primary" onClick={onClose}>Đóng</button>}
          </>
        )}
      </div>
    </div>
  );
}
