"use client";

import { useEffect, useRef, useState } from "react";
import { FISH_ICONS } from "@/lib/game/art/fish";
import { RARITY_COLOR, type Rarity } from "@/lib/game/fishing/catalog";
import { createReel, fishFloor, stepReel, zoneHeight, type ReelParams } from "@/lib/game/fishing/reel";
import { isTyping } from "@/lib/game/keys";

/** An unknown rarity (the bobber does not reveal it) shows a grey fish. */
const UNKNOWN = "#6b6f74";
const SILHOUETTE = FISH_ICONS.ca_ro.rows;

/** A fish shape in one colour (16 × 16). */
function FishSilhouette({ color }: { color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (!c) return;
    c.clearRect(0, 0, 16, 16);
    c.fillStyle = color;
    SILHOUETTE.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch !== ".") c.fillRect(x, y, 1, 1);
    }));
  }, [color]);
  return <canvas ref={ref} width={16} height={16} aria-hidden="true" style={{ width: 32, height: 32, imageRendering: "pixelated" }} />;
}

/** The reel minigame (spec §6.2, §10.3): hold (mouse, touch or Space) to lift the green zone and keep the fish in it. */
export default function ReelOverlay({ params, rarity, onDone }: {
  params: ReelParams;
  /** Known only when the bobber reveals it. */
  rarity: Rarity | null;
  onDone: (caught: boolean) => void;
}) {
  const [s, setS] = useState(() => createReel(params));
  const holding = useRef(false);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    let cur = createReel(params);
    let last = performance.now();
    let raf = requestAnimationFrame(function loop(t: number) {
      cur = stepReel(cur, params, Math.max(0, t - last) / 1000, holding.current);
      last = t;
      setS(cur);
      if (cur.outcome) {
        onDoneRef.current(cur.outcome === "caught");
        return;
      }
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [params]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || isTyping(e.target)) return;
      e.preventDefault();
      holding.current = true;
    };
    // A release always lets go, like the engine's keyup: a hold never sticks when focus moved into a text field.
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") holding.current = false;
    };
    const blur = () => { holding.current = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const zh = zoneHeight(params);
  const inside = s.fish >= s.zone && s.fish <= s.zone + zh;
  const hold = (on: boolean) => () => { holding.current = on; };
  return (
    <div
      className="fixed inset-0 z-30 touch-none select-none"
      onPointerDown={hold(true)}
      onPointerUp={hold(false)}
      onPointerCancel={hold(false)}
      onPointerLeave={hold(false)}
      role="dialog"
      aria-label="Kéo cá"
    >
      <div className="pch absolute left-1/2 top-1/2 flex -translate-y-1/2 translate-x-8 items-stretch gap-2 p-2 font-vt text-lg leading-none">
        <div className="relative h-56 w-10 overflow-hidden rounded-sm border-2 border-ink bg-[#2f6e8f]" aria-hidden="true">
          <div
            className={`absolute inset-x-0 ${inside ? "bg-[#6fd06f]/80" : "bg-[#4caf50]/60"}`}
            style={{ bottom: `${s.zone * 100}%`, height: `${zh * 100}%` }}
          />
          <div className="absolute inset-x-0 border-t border-dashed border-white/30" style={{ bottom: `${fishFloor(params) * 100}%` }} />
          <div className="absolute left-1/2 -translate-x-1/2 translate-y-1/2" style={{ bottom: `${s.fish * 100}%` }}>
            <FishSilhouette color={rarity ? RARITY_COLOR[rarity] : UNKNOWN} />
          </div>
        </div>
        <div className="relative w-3 overflow-hidden rounded-sm border-2 border-ink bg-parchment-300" role="progressbar"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(s.progress * 100)} aria-label="Tiến độ kéo cá">
          <div className="absolute inset-x-0 bottom-0 bg-burgundy" style={{ height: `${s.progress * 100}%` }} />
        </div>
        <p className="w-24 self-center text-base">Giữ chuột, chạm hoặc Space để nâng vùng xanh.</p>
      </div>
    </div>
  );
}
