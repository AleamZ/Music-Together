"use client";

import { useEffect, useRef } from "react";
import { ICON_SIZE, iconMatrixFor } from "@/lib/game/art/icons";
import type { TankFish } from "@/lib/game/pets/v2";
import { useReducedMotion } from "./petArt";

// v22 pets: a living tank — the fish wander with idle pauses and turns, bubbles rise from the stones, and "Rắc thức ăn"
// drops flakes the fish swim up to and eat. Pure show (no server call): the tank's fish are 0074's.

const W = 200, H = 110, FLOOR = 96;
interface Swimmer { x: number; y: number; vx: number; vy: number; tx: number; ty: number; rest: number; face: 1 | -1; mat: string[][] | null; rare: boolean }
interface Flake { x: number; y: number; eaten: boolean }

function rnd(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 10000) / 10000; };
}

export default function AquariumTank({ fish, decor, feedSignal }: { fish: readonly TankFish[]; decor: readonly string[]; feedSignal: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  const flakes = useRef<Flake[]>([]);
  const lastFeed = useRef(feedSignal);
  useEffect(() => {
    if (feedSignal === lastFeed.current) return;
    lastFeed.current = feedSignal;
    for (let i = 0; i < 8; i++) flakes.current.push({ x: 40 + ((feedSignal * 37 + i * 53) % 120), y: 4 - i * 3, eaten: false });
  }, [feedSignal]);

  useEffect(() => {
    const r = rnd(fish.length * 7919 + 13);
    const sw: Swimmer[] = fish.map((f) => ({
      x: 20 + r() * (W - 40), y: 20 + r() * (FLOOR - 40), vx: 0, vy: 0, tx: 20 + r() * (W - 40), ty: 16 + r() * (FLOOR - 36),
      rest: Math.floor(r() * 60), face: r() < 0.5 ? 1 : -1, mat: iconMatrixFor(f.speciesId), rare: f.rarity >= 3,
    }));
    const bubbles: Array<{ x: number; y: number; s: number }> = [];
    let t = 0, raf = 0;
    const draw = () => {
      const c = ref.current?.getContext("2d");
      if (!c) return;
      c.imageSmoothingEnabled = false;
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#7fd0ea"); g.addColorStop(1, "#2f7fb0");
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      // light rays
      c.fillStyle = "rgba(255,255,255,0.07)";
      for (let i = 0; i < 4; i++) c.fillRect(20 + i * 50 + Math.round(Math.sin((t + i * 40) / 90) * 6), 0, 10, FLOOR);
      // sand, stones, decor
      c.fillStyle = "#e6cf95"; c.fillRect(0, FLOOR, W, H - FLOOR);
      c.fillStyle = "#c9ae70"; for (let x = 3; x < W; x += 9) c.fillRect(x, FLOOR + 3 + (x % 4), 2, 1);
      c.fillStyle = "#8a8f96"; c.fillRect(150, FLOOR - 5, 12, 5); c.fillRect(154, FLOOR - 8, 8, 3);
      const sway = reduced ? 0 : Math.round(Math.sin(t / 30) * 2);
      if (decor.includes("rong")) { c.fillStyle = "#2f8f4e"; for (let k = 0; k < 4; k++) c.fillRect(24 + k * 4 + (k % 2 ? sway : -sway), FLOOR - 26 + k * 3, 2, 26 - k * 3); }
      if (decor.includes("da")) { c.fillStyle = "#6f747b"; c.fillRect(60, FLOOR - 7, 16, 7); c.fillRect(64, FLOOR - 11, 9, 4); }
      if (decor.includes("san_ho")) { c.fillStyle = "#f07a7a"; c.fillRect(100, FLOOR - 16, 3, 16); c.fillRect(96, FLOOR - 12, 11, 3); c.fillRect(106, FLOOR - 20, 3, 8); }
      if (decor.includes("ruong")) { c.fillStyle = "#8a5a2a"; c.fillRect(172, FLOOR - 9, 16, 9); c.fillStyle = "#f2c93a"; c.fillRect(178, FLOOR - 6, 4, 3); }
      if (decor.includes("lau_dai")) { c.fillStyle = "#b9b2a2"; c.fillRect(118, FLOOR - 24, 20, 24); c.fillRect(116, FLOOR - 28, 4, 4); c.fillRect(126, FLOOR - 28, 4, 4); c.fillRect(134, FLOOR - 28, 4, 4); c.fillStyle = "#3a3a44"; c.fillRect(125, FLOOR - 9, 6, 9); }
      // bubbles
      c.fillStyle = "rgba(255,255,255,0.7)";
      for (const b of bubbles) c.fillRect(Math.round(b.x), Math.round(b.y), b.s, b.s);
      // flakes
      c.fillStyle = "#e0a040";
      for (const f of flakes.current) if (!f.eaten && f.y > 0) c.fillRect(Math.round(f.x), Math.round(f.y), 2, 2);
      // fish
      for (const s of sw) {
        if (!s.mat) continue;
        c.save();
        c.translate(Math.round(s.x), Math.round(s.y + (reduced ? 0 : Math.sin((t + s.x) / 20))));
        if (s.face < 0) c.scale(-1, 1);
        s.mat.forEach((row, y) => row.forEach((col, x) => { if (col) { c.fillStyle = col; c.fillRect(x - ICON_SIZE / 2, y - ICON_SIZE / 2, 1, 1); } }));
        c.restore();
        if (s.rare && !reduced && t % 50 < 10) { c.fillStyle = "#fff6a8"; c.fillRect(Math.round(s.x) + 6, Math.round(s.y) - 8, 2, 2); }
      }
      // the glass
      c.strokeStyle = "#3a2418"; c.lineWidth = 2; c.strokeRect(1, 1, W - 2, H - 2);
      c.fillStyle = "rgba(255,255,255,0.18)"; c.fillRect(6, 4, 3, H - 12);
    };
    const step = () => {
      t++;
      if (t % 24 === 0) bubbles.push({ x: 156 + (t % 5), y: FLOOR - 8, s: 1 + (t % 3 === 0 ? 1 : 0) });
      for (const b of bubbles) { b.y -= 0.6; b.x += Math.sin((b.y + t) / 8) * 0.2; }
      while (bubbles.length && bubbles[0].y < 2) bubbles.shift();
      for (const f of flakes.current) if (!f.eaten) f.y = Math.min(FLOOR - 1, f.y + 0.25);
      for (const s of sw) {
        const food = flakes.current.filter((f) => !f.eaten && f.y > 2).sort((a, b) => Math.hypot(a.x - s.x, a.y - s.y) - Math.hypot(b.x - s.x, b.y - s.y))[0];
        if (food) { s.tx = food.x; s.ty = food.y; s.rest = 0; }
        if (s.rest > 0) { s.rest--; s.vx *= 0.9; s.vy *= 0.9; }
        else {
          const dx = s.tx - s.x, dy = s.ty - s.y, d = Math.hypot(dx, dy);
          const sp = food ? 0.9 : 0.35;
          if (d < 3) {
            if (food) food.eaten = true;
            s.rest = 30 + ((t * 7 + s.x) % 90);
            s.tx = 16 + ((t * 13 + s.y * 7) % (W - 32));
            s.ty = 14 + ((t * 5 + s.x * 3) % (FLOOR - 32));
          } else { s.vx += (dx / d) * sp * 0.08; s.vy += (dy / d) * sp * 0.05; }
          const v = Math.hypot(s.vx, s.vy);
          if (v > sp) { s.vx = (s.vx / v) * sp; s.vy = (s.vy / v) * sp; }
        }
        s.x = Math.max(10, Math.min(W - 10, s.x + s.vx));
        s.y = Math.max(10, Math.min(FLOOR - 8, s.y + s.vy));
        if (Math.abs(s.vx) > 0.05) s.face = s.vx > 0 ? 1 : -1;
      }
      flakes.current = flakes.current.filter((f) => !f.eaten && f.y < FLOOR - 1);
    };
    if (reduced) {
      draw();
      return;
    }
    raf = requestAnimationFrame(function loop() {
      step();
      draw();
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [fish, decor, reduced]);

  return <canvas ref={ref} width={W} height={H} className="w-full max-w-[400px] rounded [image-rendering:pixelated]" role="img" aria-label={`Bể cá: ${fish.length} con`} />;
}
