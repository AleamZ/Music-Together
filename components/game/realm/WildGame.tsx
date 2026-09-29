"use client";

// v22 world (0083): the wild minigames' overlay — the hunt (aim and release, lead the animal, the wind; a wolf or a bear
// charges: dodge), the trap (pull the cord as it steps in; a net for birds and fireflies) and the photo (frame, zoom,
// snap the pose). A 60 Hz sim (lib/game/realm/minigames.ts); only the input ticks go back (wild_finish replays them).
// 0087: the round stays on the server — mg_sync reveals the hunted / photographed animal when it shows (a secret tick
// 0.5–1 s in; a shot or a snap waits a moment after it), the trail 0.5 s ahead and the charge 1 s ahead; the inputs go
// up as they are made.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { drawAnimal } from "@/lib/game/realm/art";
import {
  WG, huntAnimal, huntParamsFrom, photoParamsFrom, photoPose, photoX, replayWildP, snapScore, trapParamsFrom, trapPath, tri, zoomAt,
  type HuntParams, type PhotoParams, type TrapParams, type WildReplay,
} from "@/lib/game/realm/minigames";
import { DODGE_HELP, WILD_HELP } from "@/lib/game/realm/mg-copy";
import { speciesOf } from "@/lib/game/realm/model";
import type { WildRound } from "@/lib/game/realm/rpc";
import { GATE_GUARD_MS, liveTick, useLive, type LiveEvents, type LiveSync } from "@/lib/game/mglive";
import { isTyping } from "@/lib/game/keys";

const W = 320, H = 160;
type Ctx = CanvasRenderingContext2D;

export interface WildView {
  round: WildRound; phase: "playing" | "sending" | "done"; message: string; night: boolean;
  /** 0087: the round's live channel (mg_sync('world')); null in a test render. */
  live: LiveSync | null;
}

interface Sim { tick: number; a: number[]; b: number[]; rep: WildReplay; flash: number }

const isNet = (r: WildRound) => r.game === "trap" && (r.species === "bird" || r.species === "firefly");
const OPEN: WildReplay = { outcome: "open", ticks: null, score: 0, used: 0, dodged: false };

/** The round's parameters from what mg_sync revealed (null: the animal has not shown yet). */
function paramsOf(r: WildRound, ev: LiveEvents): HuntParams | TrapParams | PhotoParams | null {
  return r.game === "hunt" ? huntParamsFrom(r.reticle, ev) : r.game === "trap" ? trapParamsFrom(r.species, ev) : photoParamsFrom(ev);
}

function sprite(c: Ctx, sp: WildRound["species"], x: number, y: number, scale: number, left: boolean, step: number, night: boolean, t: number, flip = false) {
  c.save();
  c.translate(Math.round(x), Math.round(y));
  c.scale(scale, flip ? -scale : scale);
  drawAnimal(c, sp, 0, 0, left, step, night, t);
  c.restore();
}

function sky(c: Ctx, night: boolean) {
  c.fillStyle = night ? "#1d2440" : "#9fd3f0";
  c.fillRect(0, 0, W, H);
  c.fillStyle = night ? "#2c4a2e" : "#78b05a";
  c.fillRect(0, 96, W, H - 96);
  c.fillStyle = night ? "#23402a" : "#5f9a48";
  for (let x = 0; x < W; x += 12) c.fillRect(x + ((x / 12) % 2) * 5, 104 + ((x * 7) % 11), 3, 2);
}

/** The bushes the animal will come out of (before it shows). */
function lurk(c: Ctx, t: number, reduced: boolean) {
  c.fillStyle = "#3f7a34";
  for (let k = 0; k < 5; k++) {
    const sway = reduced ? 0 : Math.round(Math.sin(t / 7 + k) * 1.5);
    c.fillRect(30 + k * 62 + sway, 86, 26, 14);
    c.fillRect(34 + k * 62 + sway, 80, 18, 8);
  }
  c.fillStyle = "#1d1a14";
  c.font = "10px monospace";
  c.textAlign = "center";
  c.fillText("… đang rình …", W / 2, 60);
}

function drawHunt(c: Ctx, r: WildRound, p: HuntParams | null, s: Sim, night: boolean, reduced: boolean) {
  const t = s.tick;
  sky(c, night);
  const done = s.rep.outcome !== "open" && t >= (s.rep.ticks ?? Infinity) - 1;
  if (p) {
    const ax = (huntAnimal(p, t) / 1000) * W;
    const dir = huntAnimal(p, t + 1) - huntAnimal(p, t);
    const hit = s.rep.outcome === "hit" && t >= (s.rep.ticks ?? 0) - 1;
    // the charge: the animal grows toward you in the warning
    const charging = r.danger && t >= p.charge - 50 && t <= p.charge && !(s.rep.outcome === "hit" && (s.rep.ticks ?? 0) <= p.charge);
    const grow = charging ? 1 + (t - (p.charge - 50)) / 25 : 0;
    const y = charging ? 110 + grow * 10 : 100;
    sprite(c, r.species, ax, y, hit ? 3 : 3 + grow, dir < 0, reduced || hit ? 0 : Math.floor(t / 8) % 2, night, t * 16, hit);
    if (hit && !reduced) {
      c.fillStyle = "#ffe066";
      for (let k = 0; k < 5; k++) c.fillRect(ax + Math.cos(t / 6 + k) * 14, 78 + Math.sin(t / 6 + k) * 6, 2, 2);
    }
    // arrows in flight
    for (const sh of s.a) {
      if (t < sh || t > sh + WG.flight) continue;
      const k = (t - sh) / WG.flight;
      const tx = ((tri(p.reticle, sh) + p.wind) / 1000) * W;
      const x = W / 2 + (tx - W / 2) * k, yy = 150 - 60 * k - 20 * Math.sin(Math.PI * k);
      c.fillStyle = "#5a3a24";
      c.fillRect(Math.round(x) - 1, Math.round(yy) - 4, 2, 8);
      c.fillStyle = "#e8e8e8";
      c.fillRect(Math.round(x) - 1, Math.round(yy) - 5, 2, 2);
    }
    if (charging) {
      c.fillStyle = Math.floor(t / 6) % 2 && !reduced ? "#ff3030" : "#ffd040";
      c.textAlign = "center";
      c.font = "12px monospace";
      c.fillText(s.b.some((d) => d >= p.charge - WG.dodgeWin && d <= p.charge) ? "NÉ ĐƯỢC!" : "⚠ LAO TỚI — NÉ (E)!", W / 2, 40);
    }
  } else {
    lurk(c, t, reduced);
  }
  // the aim (and, once the wind is known, where it lands)
  const aim = (tri(r.reticle, t) / 1000) * W;
  if (!done) {
    c.strokeStyle = "#d83a3a";
    c.lineWidth = 1;
    c.strokeRect(Math.round(aim) - 6, 88, 12, 12);
    c.fillStyle = "#d83a3a";
    c.fillRect(Math.round(aim), 84, 1, 20);
    if (p) {
      const land = ((tri(r.reticle, t) + p.wind) / 1000) * W;
      c.globalAlpha = 0.45;
      c.fillStyle = "#fff4d0";
      c.fillRect(Math.round(land) - 1, 92, 3, 3);
      c.globalAlpha = 1;
    }
  }
  c.fillStyle = "#1d1a14";
  c.font = "8px monospace";
  c.textAlign = "left";
  c.fillText(p ? `Gió ${p.wind < 0 ? "←" : "→"} ${Math.abs(p.wind)}` : "Gió ?", 6, 12);
  c.fillText(`Tên: ${WG.shots - s.a.length}`, 6, 22);
}

function drawTrap(c: Ctx, r: WildRound, p: TrapParams, s: Sim, path: number[], night: boolean, reduced: boolean) {
  const t = Math.min(s.tick, path.length - 1);
  sky(c, night);
  const net = isNet(r);
  // the trail and the trap (its zone)
  c.fillStyle = night ? "#4a3a28" : "#b09060";
  c.fillRect(0, 118, W, 8);
  const zx = ((WG.trapAt - p.zone) / 1000) * W, zw = ((2 * p.zone) / 1000) * W;
  c.globalAlpha = 0.35;
  c.fillStyle = "#ffe066";
  c.fillRect(zx, net ? 60 : 110, zw, net ? 60 : 20);
  c.globalAlpha = 1;
  const pulled = s.a.length > 0 ? s.a[0] : null;
  const shut = pulled !== null && t >= pulled;
  const cx = W / 2;
  if (net) {
    // the net on a pole sweeping down
    const k = shut ? Math.min(1, (t - (pulled ?? 0)) / 8) : 0;
    c.strokeStyle = "#6a4a2a";
    c.beginPath();
    c.moveTo(cx - 40 + 30 * k, 40);
    c.lineTo(cx, 70 + 40 * k);
    c.stroke();
    c.strokeStyle = "#e8e8e8";
    for (let i = -8; i <= 8; i += 4) { c.beginPath(); c.moveTo(cx + i, 70 + 40 * k); c.lineTo(cx + i * 1.4, 88 + 40 * k); c.stroke(); }
  } else {
    // a snare: a loop on the trail and the cord to a bent twig
    c.strokeStyle = "#8a6a3a";
    c.beginPath();
    c.ellipse(cx, 120, shut ? 4 : 14, shut ? 2 : 5, 0, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.moveTo(cx + 14, 120);
    c.lineTo(W - 20, shut ? 70 : 100);
    c.stroke();
    c.fillStyle = "#5a3a24";
    c.fillRect(W - 22, shut ? 60 : 96, 3, shut ? 60 : 24);
  }
  const x = (path[t] / 1000) * W;
  const moving = t > 0 && path[t] !== path[t - 1];
  const caught = s.rep.outcome === "caught" && shut;
  const ay = net ? 104 : 124;
  // idle: a sniff bob; walking: steps; caught: lifted (snare) or held in the net
  const bob = !moving && !reduced ? (Math.floor(t / 12) % 2) : 0;
  sprite(c, r.species, x, caught ? (net ? 110 : 90) : ay - bob, 3, path[t] < path[Math.max(0, t - 1)], moving && !reduced ? Math.floor(t / 6) % 2 : 0, night, t * 16, caught && !net);
  c.fillStyle = "#1d1a14";
  c.font = "8px monospace";
  c.textAlign = "left";
  c.fillText(net ? "Lưới" : "Bẫy", 6, 12);
}

function drawPhoto(c: Ctx, r: WildRound, p: PhotoParams | null, s: Sim, night: boolean, reduced: boolean) {
  const t = s.tick;
  const zoom = zoomAt(s.b, t);
  sky(c, night);
  if (p) {
    const x = (photoX(p, t) / 1000) * W;
    const scale = zoom ? 5 : 3;
    const pose = photoPose(p, t);
    const dir = photoX(p, t + 1) - photoX(p, t);
    sprite(c, r.species, W / 2 + (x - W / 2) * (zoom ? 2 : 1), 112, scale, pose ? false : dir < 0, pose || reduced ? 0 : Math.floor(t / 8) % 2, night, t * 16);
    if (pose && !reduced) {
      c.fillStyle = "#fff4a0";
      c.fillRect(W / 2 + (x - W / 2) * (zoom ? 2 : 1) + 10, 70, 2, 2);
    }
  } else {
    lurk(c, t, reduced);
  }
  // the viewfinder: the centre box (tolerance) and the corners
  c.strokeStyle = "#fff4d0";
  c.lineWidth = 1;
  const half = zoom ? 40 : 70;
  c.strokeRect(W / 2 - half, 40, half * 2, 90);
  c.fillStyle = "#fff4d0";
  for (const [cx, cy] of [[8, 8], [W - 14, 8], [8, H - 14], [W - 14, H - 14]]) c.fillRect(cx, cy, 6, 6);
  c.font = "8px monospace";
  c.textAlign = "left";
  c.fillText(`${zoom ? "🔍 x2" : "x1"} · còn ${WG.snaps - s.a.length} kiểu`, 18, 20);
  if (s.flash > 0 && !reduced) {
    c.globalAlpha = s.flash / 10;
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, W, H);
    c.globalAlpha = 1;
  }
}

function Playing({ view, onEnd }: { view: WildView; onEnd: (a: number[], b: number[], ticks: number) => void }) {
  const r = view.round;
  const reduced = useMemo(() => (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) ?? false, []);
  const [s, setS] = useState<Sim>({ tick: 0, a: [], b: [], rep: OPEN, flash: 0 });
  const want = useRef({ a: false, b: false });
  const cur = useRef<Sim>(s);
  const over = useRef(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cb = useRef(onEnd);
  useEffect(() => {
    cb.current = onEnd;
  });
  const [lastSnap, setLastSnap] = useState<number | null>(null);
  const live = useLive(view.live, () => [cur.current.a, cur.current.b]);
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  });

  const end = useCallback((a: number[], b: number[], ticks: number) => {
    if (over.current) return;
    over.current = true;
    liveRef.current.stop();
    cb.current(a, b, ticks);
  }, []);
  const stop = useCallback(() => {
    const x = cur.current;
    end(x.a.slice(), x.b.slice(), Math.max(1, x.tick));
  }, [end]);
  useEffect(() => {
    if (live.failed) stop();
  }, [live.failed, stop]);

  useEffect(() => {
    if (!live.ready) return;
    const t0 = live.t0;
    const maxA = r.game === "trap" ? 1 : r.game === "hunt" ? WG.shots : WG.snaps;
    const maxB = r.game === "hunt" ? WG.dodges : r.game === "photo" ? WG.zooms : 0;
    let raf = requestAnimationFrame(function loop(now: number) {
      const due = liveTick(t0, now);
      const ev = liveRef.current.ev.current ?? {};
      const p = paramsOf(r, ev);
      // a shot / a snap only once the animal has been on screen a moment (the server refuses a blind one)
      const seenAt = liveRef.current.at.current?.[1];
      const canAct = r.game === "trap" || (p !== null && seenAt !== undefined && now - seenAt >= GATE_GUARD_MS);
      let x = cur.current;
      while (x.tick < due && !over.current) {
        const t = x.tick;
        let a = x.a, b = x.b, flash = Math.max(0, x.flash - 1), changed = false;
        // a shot / pull the replay would still count: a hunt before its hit or miss (and before the charge), a trap
        // before the animal is past
        const o = x.rep.outcome, before = x.rep.ticks === null || t < x.rep.ticks - 1;
        const open = r.game === "photo" || o === "open" || (before && (o === "charged" || o === "escaped"));
        if (want.current.a && canAct && a.length < maxA && (a.length === 0 || t - a[a.length - 1] >= 60) && open) {
          a = [...a, t];
          changed = true;
          if (r.game === "photo" && p) { flash = 10; setLastSnap(snapScore(p as PhotoParams, b, t)); }
        }
        want.current.a = false;
        if (want.current.b && b.length < maxB && (r.game === "hunt" ? b.length === 0 || t - b[b.length - 1] >= 60 : b.length < 2 || t - b[b.length - 2] >= 60)) {
          b = [...b, t];
          changed = true;
        }
        want.current.b = false;
        const rep = p ? replayWildP(r.game, p, r.danger, a, b) : OPEN;
        x = { tick: t + 1, a, b, rep, flash };
        if (changed) liveRef.current.flush();
        if (rep.outcome !== "open" && rep.ticks !== null && x.tick >= rep.ticks) {
          cur.current = x;
          end(a.slice(), b.slice(), rep.ticks);
          break;
        }
        if (x.tick >= WG.maxTicks) {
          cur.current = x;
          end(a.slice(), b.slice(), WG.maxTicks);
          break;
        }
      }
      cur.current = x;
      setS(x);
      const c = canvas.current?.getContext("2d");
      if (c) {
        c.imageSmoothingEnabled = false;
        if (r.game === "hunt") drawHunt(c, r, p as HuntParams | null, x, view.night, reduced);
        else if (r.game === "trap") drawTrap(c, r, p as TrapParams, x, trapPath(p as TrapParams, x.tick + 1), view.night, reduced);
        else drawPhoto(c, r, p as PhotoParams | null, x, view.night, reduced);
      }
      if (!over.current) raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [r, reduced, view.night, live.ready, live.t0, end]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.repeat) return;
      if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); want.current.a = true; }
      else if (e.code === "KeyE" || e.code === "KeyZ" || e.code === "ArrowUp") { e.preventDefault(); want.current.b = true; }
      else if (e.key === "Escape") { e.preventDefault(); stop(); }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [stop]);

  const help = r.game === "trap" && isNet(r) ? WILD_HELP.net : WILD_HELP[r.game];
  const bLabel = r.game === "hunt" ? "🤸 Né (E)" : r.game === "photo" ? "🔍 Zoom (E)" : null;
  return (
    <>
      <canvas ref={canvas} width={W} height={H} aria-hidden="true" onPointerDown={() => { want.current.a = true; }}
        className="w-full max-w-[640px] touch-none select-none rounded border-2 border-[#3a2418] [image-rendering:pixelated]" />
      {!live.ready && <p role="status">Chuẩn bị…</p>}
      <p className="text-base opacity-80">{help}{r.danger ? ` ${DODGE_HELP}` : ""}</p>
      {r.game === "photo" && lastSnap !== null && <p role="status">Kiểu vừa chụp: {lastSnap} điểm</p>}
      <div className="flex gap-2">
        <button type="button" className="pch-btn pch-btn-primary px-3" onClick={() => { want.current.a = true; }}>
          {r.game === "hunt" ? "🏹 Bắn (Space)" : r.game === "trap" ? (isNet(r) ? "🥅 Quét (Space)" : "🪢 Giật dây (Space)") : "📷 Chụp (Space)"}
        </button>
        {bLabel && (r.game !== "hunt" || r.danger) && <button type="button" className="pch-btn px-3" onClick={() => { want.current.b = true; }}>{bLabel}</button>}
        <button type="button" className="pch-btn" onClick={stop}>{r.game === "photo" ? "Xong (Esc)" : "Bỏ (Esc)"}</button>
      </div>
      <span className="sr-only">{s.tick}</span>
    </>
  );
}

export default function WildGame({ view, onEnd, onClose }: {
  view: WildView;
  onEnd: (a: number[], b: number[], ticks: number) => void;
  onClose: () => void;
}) {
  const sp = speciesOf(view.round.species);
  useEffect(() => {
    if (view.phase !== "done") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Escape" || e.code === "Space") && !isTyping(e.target)) { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view.phase, onClose]);
  const title = view.round.game === "hunt" ? "🏹 Săn" : view.round.game === "trap" ? (isNet(view.round) ? "🥅 Bắt bằng lưới" : "🪤 Đặt bẫy") : "📷 Chụp ảnh";
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label={title}>
      <div className="pch flex w-[40rem] max-w-full flex-col items-center gap-2 p-3 text-center font-vt text-lg leading-tight">
        <h2 className="font-vt text-2xl leading-none text-burgundy">{title} · {sp?.name ?? view.round.species}{view.round.danger ? " ⚠️" : ""}</h2>
        {view.phase === "playing" && <Playing view={view} onEnd={onEnd} />}
        {view.phase === "sending" && <p role="status">Đang xem kết quả…</p>}
        {view.phase === "done" && (
          <>
            <p role="status" className="whitespace-pre-line">{view.message}</p>
            <button type="button" className="pch-btn pch-btn-primary" onClick={onClose}>Đóng</button>
          </>
        )}
      </div>
    </div>
  );
}
