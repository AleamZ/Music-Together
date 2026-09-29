"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { drawPet } from "@/lib/game/art/pets";
import { TickClock } from "@/lib/game/fishing/net";
import { isTyping } from "@/lib/game/keys";
import { SPECIES } from "@/lib/game/pets/catalog";
import {
  CARE_BASE, careGain, FEED, feedLanes, feedLand, feedSpawn, FETCH, fetchFlights, fetchStart, pack, replayCare, RUB, rubLikes,
  type CareKind,
} from "@/lib/game/pets/minigames";
import { lookOf, type Pet, type PetsState } from "@/lib/game/pets/rpc";
import { careFinish, careStart, errText, type CareOutcome, type CareRound } from "@/lib/game/pets/v2";
import { PET_ANIM_CSS, useReducedMotion } from "./petArt";

// v22 pets (0085): the care minigames that replaced the instant Cho ăn / Vuốt ve / Chơi buttons. The server rolls the
// seed (pet_care_start); this plays the round on a 60 Hz tick clock and sends only the packed inputs; the server replays
// them and pays affection / XP scaled by the score (40 %…100 % of the old amounts).

export const CARE_TITLE: Record<CareKind, string> = { feed: "🍖 Cho ăn", pat: "🤲 Vuốt ve", play: "🎾 Chơi ném bóng" };
export const CARE_HELP: Record<CareKind, string> = {
  feed: "Dùng ← → (hoặc A/D, chạm vào làn) di chuyển bát để hứng đồ ăn rơi xuống.",
  pat: "Giữ chuột/ngón tay (hoặc phím 1–5) lên chỗ bé thích — hiện tim là đúng chỗ, bé đổi chỗ thích liên tục.",
  play: "Nhấn Space (hoặc chạm) đúng lúc bóng chạm đất để bé nhảy bắt bóng.",
};

/** The result line by score (great, fine, weak). */
const CARE_CHEER: Record<CareKind, [string, string, string]> = {
  feed: ["Bé ăn ngon quá!", "Bé no bụng rồi!", "Thức ăn rơi mất nhiều quá!"],
  pat: ["Bé thích lắm kìa!", "Bé dụi vào tay rồi!", "Bé chưa quen đâu!"],
  play: ["Bé bắt được hết rồi!", "Bé vui ra mặt kìa!", "Bé lỡ bóng mất rồi!"],
};

const W = 250, H = 150, GROUND = 132;
const laneX = (l: number) => 25 + l * 50;
/** The pat spots on the big pet (canvas coordinates), 1–5. */
const SPOTS: ReadonlyArray<{ x: number; y: number; name: string }> = [
  { x: 125, y: 36, name: "Đầu" }, { x: 95, y: 58, name: "Má" }, { x: 150, y: 70, name: "Lưng" }, { x: 118, y: 104, name: "Bụng" },
  { x: 176, y: 100, name: "Đuôi" },
];

interface Fx { x: number; y: number; t0: number; text: string; color: string }

function treat(c: CanvasRenderingContext2D, species: string, x: number, y: number): void {
  const px = (dx: number, dy: number, w: number, h: number, col: string) => { c.fillStyle = col; c.fillRect(Math.round(x + dx), Math.round(y + dy), w, h); };
  if (species === "tho" || species === "hamster") {             // a carrot
    px(-2, -5, 4, 3, "#3f9b3a"); px(-3, -2, 6, 3, "#f08a24"); px(-2, 1, 4, 3, "#e0761a"); px(-1, 4, 2, 2, "#c9611a");
  } else if (species === "soc" || species === "vet") {           // a nut / seeds
    px(-3, -3, 6, 2, "#6b4424"); px(-4, -1, 8, 4, "#b07a3c"); px(-3, 3, 6, 2, "#8c5a2a");
  } else {                                                       // a bone-shaped treat
    px(-5, -2, 3, 4, "#f5ecd6"); px(2, -2, 3, 4, "#f5ecd6"); px(-3, -1, 6, 2, "#efe2c2"); px(-5, -2, 10, 1, "#fffaf0");
  }
}

function drawFx(c: CanvasRenderingContext2D, fx: Fx[], t: number): void {
  c.font = "bold 10px monospace";
  c.textAlign = "center";
  for (const f of fx) {
    const a = (t - f.t0) / 40;
    if (a < 0 || a > 1) continue;
    c.globalAlpha = 1 - a;
    if (f.text === "♥") { heart(c, Math.round(f.x), Math.round(f.y - a * 22), f.color); continue; }
    c.fillStyle = f.color;
    c.fillText(f.text, f.x, f.y - a * 22);
  }
  c.globalAlpha = 1;
}

function heart(c: CanvasRenderingContext2D, x: number, y: number, col = "#e2436b"): void {
  c.fillStyle = col;
  c.fillRect(x - 3, y - 2, 2, 2); c.fillRect(x + 1, y - 2, 2, 2); c.fillRect(x - 4, y - 1, 8, 2); c.fillRect(x - 3, y + 1, 6, 1);
  c.fillRect(x - 2, y + 2, 4, 1); c.fillRect(x - 1, y + 3, 2, 1);
}

function Playing({ round, pet, onEnd, onQuit }: {
  round: CareRound; pet: Pet; onEnd: (inputs: number[], ticks: number, score: number) => void; onQuit: () => void;
}) {
  const reduced = useReducedMotion();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hud, setHud] = useState({ tick: 0, score: 0 });
  const inputs = useRef<number[]>([]);
  const cur = useRef<number>(round.kind === "feed" ? 2 : 0);   // bowl lane / rubbed zone
  const want = useRef<number | null>(null);                    // a lane / zone asked for
  const press = useRef(false);
  const fx = useRef<Fx[]>([]);
  const jumpAt = useRef<number>(-99);
  const over = useRef(false);
  const cb = useRef(onEnd);
  useEffect(() => { cb.current = onEnd; });
  const kind = round.kind;

  // record a lane / zone change at tick t within the server's rules (max, rate); false: dropped
  const record = useCallback((t: number, v: number): boolean => {
    const l = inputs.current, n = l.length;
    const max = kind === "feed" ? FEED.maxInputs : RUB.maxInputs, rate = kind === "feed" ? FEED.rate : RUB.rate;
    if (n && Math.floor(l[n - 1] / 8) === t) { l[n - 1] = pack(t, v); return true; }
    if (n >= max || (n >= rate && t - Math.floor(l[n - rate] / 8) < 60)) return false;
    l.push(pack(t, v));
    return true;
  }, [kind]);

  useEffect(() => {
    const look = lookOf(pet);
    const lanes = feedLanes(round.seed), likes = rubLikes(round.seed), flights = fetchFlights(round.seed);
    const clock = new TickClock(performance.now());
    let t = 0, caught = 0, good = 0, pts = 0;
    const done = new Set<number>();
    const draw = () => {
      const c = canvas.current?.getContext("2d");
      if (!c) return;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.imageSmoothingEnabled = false;
      // backdrop: a sky, a lawn
      c.fillStyle = kind === "pat" ? "#fbe9d0" : "#cfe9f7";
      c.fillRect(0, 0, W, H);
      c.fillStyle = "#7cc36a";
      c.fillRect(0, GROUND, W, H - GROUND);
      c.fillStyle = "#63a955";
      for (let x = (t * (reduced ? 0 : 1)) % 12; x < W; x += 12) c.fillRect(Math.round(x), GROUND, 2, 2);
      if (kind === "feed") {
        for (let l = 0; l < FEED.lanes; l++) { c.fillStyle = "rgba(255,255,255,0.25)"; c.fillRect(laneX(l) - 20, 0, 40, GROUND); }
        for (let i = 0; i < FEED.foods; i++) {
          const s = feedSpawn(i), land = feedLand(i);
          if (t < s || t > land) continue;
          const y = 6 + ((t - s) / FEED.fall) * (GROUND - 16);
          treat(c, pet.species, laneX(lanes[i]), y);
        }
        const bx = laneX(cur.current);
        drawPet(c, look, "down", 0, bx, GROUND - 6, t * 16, reduced);
        c.fillStyle = "#b8412f"; c.fillRect(bx - 11, GROUND - 8, 22, 6);
        c.fillStyle = "#e05a44"; c.fillRect(bx - 12, GROUND - 9, 24, 2);
        c.fillStyle = "#7a2a1f"; c.fillRect(bx - 9, GROUND - 2, 18, 2);
      } else if (kind === "pat") {
        c.save();
        c.setTransform(5, 0, 0, 5, 125 - 5 * 11, 0);
        const wig = !reduced && cur.current > 0 && cur.current === likes[Math.min(4, Math.max(0, Math.floor((t - RUB.lead) / RUB.seg)))] + 1;
        drawPet(c, { ...look, happy: true }, "right", wig && t % 16 < 8 ? 1 : 0, 11, 26, t * 16, reduced);
        c.restore();
        SPOTS.forEach((sp, i) => {
          const on = cur.current === i + 1;
          c.strokeStyle = on ? "#e2436b" : "rgba(90,50,30,0.35)";
          c.lineWidth = on ? 2 : 1;
          c.beginPath(); c.arc(sp.x, sp.y, 12, 0, Math.PI * 2); c.stroke();
          c.fillStyle = "rgba(90,50,30,0.55)"; c.font = "8px monospace"; c.textAlign = "center";
          c.fillText(String(i + 1), sp.x, sp.y + 3);
        });
        if (cur.current > 0) {
          const sp = SPOTS[cur.current - 1];
          c.fillStyle = "#fff3e2"; c.fillRect(sp.x - 4 + (t % 8 < 4 ? -2 : 2), sp.y - 4, 8, 8);         // the rubbing hand
          c.fillStyle = "#e8c9a6"; c.fillRect(sp.x - 3 + (t % 8 < 4 ? -2 : 2), sp.y + 4, 6, 2);
        }
      } else {
        const px = 205;
        const jt = t - jumpAt.current;
        const jy = jt >= 0 && jt < 20 ? Math.round(Math.sin((jt / 20) * Math.PI) * 26) : 0;
        drawPet(c, look, "left", jy ? 1 : 0, px, GROUND - jy, t * 16, reduced);
        // the thrower's hand at the left
        c.fillStyle = "#e8c9a6"; c.fillRect(14, GROUND - 40, 10, 8);
        for (let i = 0; i < FETCH.throws; i++) {
          const s = fetchStart(i), land = s + flights[i];
          if (t < s || t >= s + FETCH.gap) continue;
          // the landing marker (a shadow growing as the ball comes down)
          const k = Math.min(1, (t - s) / flights[i]);
          c.fillStyle = `rgba(0,0,0,${0.15 + 0.25 * k})`;
          c.fillRect(px - 4 - Math.round(4 * k), GROUND - 1, 8 + Math.round(8 * k), 2);
          if (t <= land) {
            const bx = 22 + k * (px - 22), by = GROUND - 36 * (1 - k) - Math.sin(k * Math.PI) * 70 - 4;
            c.fillStyle = "#f2d33a"; c.fillRect(Math.round(bx) - 3, Math.round(by) - 3, 6, 6);
            c.fillStyle = "#c79a14"; c.fillRect(Math.round(bx) - 3, Math.round(by), 6, 1);
          } else if (!done.has(i)) {
            const r = t - land;
            c.fillStyle = "#f2d33a"; c.fillRect(px + r * 2, GROUND - 6 - Math.abs(Math.round(Math.sin(r / 4) * 8)), 6, 6);
          }
        }
      }
      drawFx(c, fx.current, t);
    };
    let raf = requestAnimationFrame(function loop(now: number) {
      const due = Math.min(clock.advance(now), round.ticks);
      while (t < due) {
        // this tick's input
        if (kind === "play") {
          if (press.current) {
            press.current = false;
            const l = inputs.current, n = l.length;
            if ((n === 0 || l[n - 1] < t) && n < FETCH.maxInputs && (n < FETCH.rate || t - l[n - FETCH.rate] >= 60)) {
              l.push(t);
              jumpAt.current = t;
              const i = Math.floor((t - FETCH.first) / FETCH.gap);
              if (t >= FETCH.first && i < FETCH.throws && !done.has(i)) {
                done.add(i);
                const d = Math.abs(t - (fetchStart(i) + flights[i]));
                const p = d <= 6 ? 2 : d <= 13 ? 1 : 0;
                pts += p;
                fx.current.push({ x: 205, y: GROUND - 40, t0: t, text: p === 2 ? "Tuyệt!" : p === 1 ? "Được!" : "Hụt", color: p ? "#1f7a3a" : "#8a2a1f" });
              }
            }
          }
        } else if (want.current !== null && want.current !== cur.current) {
          if (record(t, want.current)) cur.current = want.current;
          want.current = null;
        } else {
          want.current = null;
        }
        // this tick's play
        if (kind === "feed") {
          for (let i = 0; i < FEED.foods; i++) {
            if (feedLand(i) !== t) continue;
            if (cur.current === lanes[i]) {
              caught++;
              fx.current.push({ x: laneX(lanes[i]), y: GROUND - 20, t0: t, text: "+1", color: "#1f7a3a" });
            } else {
              fx.current.push({ x: laneX(lanes[i]), y: GROUND - 4, t0: t, text: "bẹp", color: "#8a5a2a" });
            }
          }
        } else if (kind === "pat" && t >= RUB.lead) {
          const seg = Math.floor((t - RUB.lead) / RUB.seg);
          if (cur.current === likes[seg] + 1) {
            good++;
            if (t % 7 === 0) { const sp = SPOTS[cur.current - 1]; fx.current.push({ x: sp.x + ((t * 13) % 17) - 8, y: sp.y - 6, t0: t, text: "♥", color: "#e2436b" }); }
          } else if (cur.current > 0 && t % 30 === 0) {
            const sp = SPOTS[cur.current - 1];
            fx.current.push({ x: sp.x, y: sp.y - 8, t0: t, text: "?", color: "#6b5a4a" });
          }
        }
        t++;
      }
      fx.current = fx.current.filter((f) => t - f.t0 < 40);
      draw();
      setHud({ tick: t, score: kind === "feed" ? caught : kind === "pat" ? good : pts });
      if (t >= round.ticks) {
        if (!over.current) {
          over.current = true;
          const list = inputs.current.slice();
          cb.current(list, round.ticks, replayCare(kind, round.seed, list).score);
        }
        return;
      }
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [round, pet, kind, reduced, record]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.key === "Escape") { onQuit(); return; }
      if (kind === "feed") {
        if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") { e.preventDefault(); want.current = Math.max(0, (want.current ?? cur.current) - 1); }
        if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") { e.preventDefault(); want.current = Math.min(FEED.lanes - 1, (want.current ?? cur.current) + 1); }
      } else if (kind === "pat") {
        if (/^[1-5]$/.test(e.key)) want.current = Number(e.key);
      } else if (e.code === "Space" || e.key === "e" || e.key === "E") {
        e.preventDefault();
        if (!e.repeat) press.current = true;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (kind === "pat" && /^[1-5]$/.test(e.key) && cur.current === Number(e.key)) want.current = 0;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [kind, onQuit]);

  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const spotAt = (x: number, y: number) => {
    const i = SPOTS.findIndex((s) => (s.x - x) ** 2 + (s.y - y) ** 2 <= 16 * 16);
    return i < 0 ? 0 : i + 1;
  };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = at(e);
    if (kind === "feed") want.current = Math.max(0, Math.min(FEED.lanes - 1, Math.floor(p.x / 50)));
    else if (kind === "pat") { e.currentTarget.setPointerCapture(e.pointerId); want.current = spotAt(p.x, p.y); }
    else press.current = true;
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (kind !== "pat" || e.buttons === 0) return;
    const p = at(e);
    want.current = spotAt(p.x, p.y);
  };
  const onUp = () => { if (kind === "pat") want.current = 0; };

  const secs = Math.max(0, Math.ceil((round.ticks - hud.tick) / 60));
  const scoreText = kind === "feed" ? `Hứng được ${hud.score}/${FEED.foods}`
    : kind === "pat" ? `Bé sướng ${Math.min(100, Math.floor(hud.score / 4))}%` : `Điểm ${hud.score}/${2 * FETCH.throws}`;
  return (
    <>
      <p className="text-base">{CARE_HELP[kind]}</p>
      <canvas ref={canvas} width={W} height={H} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        className="w-full max-w-[500px] touch-none select-none rounded border-2 border-[#3a2418] [image-rendering:pixelated]"
        role="img" aria-label={CARE_TITLE[kind]} />
      <p aria-live="polite">{scoreText} · còn {secs}s</p>
      <button type="button" className="pch-btn" onClick={onQuit}>Thôi (Esc)</button>
    </>
  );
}

type Phase = { k: "starting" } | { k: "playing"; round: CareRound } | { k: "sending" } | { k: "done"; outcome: CareOutcome } | { k: "error"; msg: string };

/** The care minigame overlay: starts a round on open, plays it, sends it, shows what the pet got. */
export default function CareGame({ token, pet, kind, onPets, onClose }: {
  token: string; pet: Pet; kind: CareKind; onPets: (s: PetsState) => void; onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ k: "starting" });
  const started = useRef(false);
  const cbPets = useRef(onPets);
  useEffect(() => { cbPets.current = onPets; });
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    careStart(token, pet.id, kind).then(
      (s) => { cbPets.current(s); setPhase({ k: "playing", round: s.round }); },
      (e) => setPhase({ k: "error", msg: errText(e) }));
  }, [token, pet.id, kind]);

  const onEnd = useCallback((inputs: number[], ticks: number, score: number) => {
    setPhase({ k: "sending" });
    careFinish(token, inputs, ticks, score).then(
      (s) => { cbPets.current(s); setPhase({ k: "done", outcome: s.outcome }); },
      (e) => setPhase({ k: "error", msg: errText(e) }));
  }, [token]);

  useEffect(() => {
    if (phase.k === "playing" || phase.k === "sending") return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !isTyping(e.target)) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase.k, onClose]);

  const base = CARE_BASE[kind];
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-3" role="dialog" aria-modal="true" aria-label={CARE_TITLE[kind]}>
      <style>{PET_ANIM_CSS}</style>
      <div className="pch flex w-[540px] max-w-full flex-col items-center gap-2 p-3 text-center font-vt text-lg leading-tight">
        <h2 className="font-vt text-2xl leading-none text-burgundy">{CARE_TITLE[kind]} · {SPECIES[pet.species].icon} {pet.name}</h2>
        {phase.k === "starting" && <p role="status">Chuẩn bị…</p>}
        {phase.k === "playing" && <Playing round={phase.round} pet={pet} onEnd={onEnd} onQuit={onClose} />}
        {phase.k === "sending" && <p role="status">Bé đang tận hưởng…</p>}
        {phase.k === "done" && (
          <>
            {phase.outcome.result === "done" ? (
              <div role="status" className="flex flex-col items-center gap-1">
                <p className="text-2xl text-burgundy motion-safe:animate-[pmg-pop_0.4s_ease-out]">
                  {"★".repeat(1 + Math.floor(phase.outcome.permille / 334))}{"☆".repeat(3 - 1 - Math.floor(phase.outcome.permille / 334))}
                  {" "}{CARE_CHEER[kind][phase.outcome.permille >= 900 ? 0 : phase.outcome.permille >= 500 ? 1 : 2]}
                </p>
                <p>+{phase.outcome.affection} thân thiết · +{phase.outcome.xp} XP
                  <span className="opacity-70"> (tối đa +{careGain(base.affection, 1000)} / +{careGain(base.xp, 1000)})</span></p>
                {phase.outcome.xp < careGain(base.xp, phase.outcome.permille) && <p className="text-base opacity-80">Hôm nay bé đã nhận gần đủ XP chăm sóc.</p>}
              </div>
            ) : (
              <p role="status">{phase.outcome.why === "expired" ? "Lượt chơi quá lâu, bé chán mất rồi." : "Lượt chơi không hợp lệ."}</p>
            )}
            <button type="button" className="pch-btn pch-btn-primary" onClick={onClose}>Đóng</button>
          </>
        )}
        {phase.k === "error" && (
          <>
            <p role="alert" className="text-burgundy">{phase.msg}</p>
            <button type="button" className="pch-btn" onClick={onClose}>Đóng</button>
          </>
        )}
      </div>
    </div>
  );
}
