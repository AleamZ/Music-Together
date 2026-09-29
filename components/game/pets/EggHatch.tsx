"use client";

import { useEffect, useState } from "react";
import { isPetSpecies, SPECIES } from "@/lib/game/pets/catalog";
import { rarityOf } from "@/lib/game/pets/v2";
import { PET_ANIM_CSS, PetCanvas, useReducedMotion } from "./petArt";

// v22 pets: the egg machine's hatching — the machine shakes, an egg drops, wobbles and cracks, then bursts in the
// rarity's colour and the pet appears. Pure show: the result was the server's roll before the animation began.

export interface Rolled { rarity: number; species: string; variant: string }

/** The egg: cream, with spots and (once cracking) a zigzag crack. */
function Egg({ crack, color }: { crack: number; color: string }) {
  return (
    <svg width="56" height="68" viewBox="0 0 14 17" shapeRendering="crispEdges" aria-hidden="true">
      <path d="M5 0h4v1h1v2h1v2h1v3h1v5h-1v2h-1v1h-2v1H5v-1H3v-1H2v-2H1V8h1V5h1V3h1V1h1z" fill="#fbf1dc" stroke="#6b4a2e" strokeWidth="0.5" />
      <rect x="4" y="5" width="2" height="2" fill={color} /><rect x="8" y="9" width="2" height="2" fill={color} /><rect x="5" y="12" width="1" height="1" fill={color} />
      {crack > 0 && <path d="M2 8l2 1 1-2 2 2 1-2 2 2 1-1 1 1" fill="none" stroke="#3a2418" strokeWidth="0.6" />}
      {crack > 1 && <path d="M4 3l1 2-1 1M10 4l-1 2 1 1" fill="none" stroke="#3a2418" strokeWidth="0.5" />}
    </svg>
  );
}

/** The whole show (about 2.6 s; instant with reduced motion). `rolled` null: the machine is working. */
export default function EggHatch({ rolled, rolling }: { rolled: Rolled | null; rolling: boolean }) {
  const reduced = useReducedMotion();
  const [stage, setStage] = useState<{ for: Rolled | null; n: number }>({ for: null, n: 0 });
  useEffect(() => {
    if (!rolled) return;
    const plan = reduced ? [[0, 5]] : [[0, 1], [500, 2], [1100, 3], [1700, 4], [2100, 5]];
    const ids = plan.map(([ms, n]) => setTimeout(() => setStage({ for: rolled, n }), ms));
    return () => ids.forEach(clearTimeout);
  }, [rolled, reduced]);
  const n = stage.for === rolled ? stage.n : 0;
  const r = rolled ? rarityOf(rolled.rarity) : null;
  const color = r?.color ?? "#c9a45a";
  // 1 drop · 2 wobble · 3 crack · 4 burst · 5 reveal
  return (
    <div className="relative flex h-44 items-end justify-center overflow-hidden rounded-sm border-2 border-gold-300 bg-gradient-to-b from-amber-50 to-amber-100" data-testid="egg-hatch">
      <style>{PET_ANIM_CSS}</style>
      {/* the machine */}
      <div className="absolute left-3 top-3 flex flex-col items-center" style={{ animation: rolling || n === 1 ? "pmg-shake 0.25s linear infinite" : undefined }} aria-hidden="true">
        <div className="h-14 w-14 rounded-t-full border-4 border-[#7a2a1f] bg-sky-100/70">
          <div className="mx-auto mt-3 flex w-10 flex-wrap gap-0.5">
            {["#f7b6c8", "#bde3f7", "#fbe39b", "#c9f0c4", "#e7c9f7", "#fbd0a8"].map((c) => <span key={c} className="h-3 w-3 rounded-full" style={{ background: c }} />)}
          </div>
        </div>
        <div className="h-8 w-16 rounded-b border-4 border-t-0 border-[#7a2a1f] bg-[#c0392b]" />
      </div>
      {rolled && n >= 1 && n <= 4 && (
        <div className="mb-6" style={{ animation: n === 1 ? "pmg-drop 0.5s ease-out" : n === 2 ? "pmg-wobble 0.3s ease-in-out infinite" : n === 3 ? "pmg-wobble 0.15s linear infinite" : undefined }}>
          <Egg crack={n >= 3 ? 2 : 0} color={color} />
        </div>
      )}
      {rolled && n === 4 && (
        <>
          <div className="absolute bottom-6 h-24 w-24 rounded-full" style={{ background: `radial-gradient(circle, #fff 0%, ${color} 45%, transparent 70%)`, animation: "pmg-burst 0.45s ease-out forwards" }} aria-hidden="true" />
        </>
      )}
      {rolled && n >= 5 && isPetSpecies(rolled.species) && (
        <div className="relative mb-2 flex flex-col items-center" role="status">
          <div className="absolute -top-6 h-40 w-40 opacity-50" style={{ background: `repeating-conic-gradient(${color} 0deg 12deg, transparent 12deg 30deg)`, animation: reduced ? undefined : "pmg-rays 6s linear infinite", borderRadius: "50%" }} aria-hidden="true" />
          <div className="relative" style={{ animation: reduced ? undefined : "pmg-pop 0.45s ease-out" }}>
            <PetCanvas look={{ species: rolled.species, variant: rolled.variant, head: null, neck: null, body: null, happy: true }} scale={4} />
          </div>
          <span className="relative text-xl font-bold text-burgundy">Chào mừng bạn nhỏ! {SPECIES[rolled.species].icon} {SPECIES[rolled.species].name}</span>
          <span className="relative rounded px-1 text-base font-bold text-white" style={{ background: color }}>{"★".repeat(r!.tier)} {r!.name}</span>
        </div>
      )}
      {!rolled && !rolling && <p className="mb-6 text-base opacity-70">Máy trứng đang chờ xu…</p>}
      {rolling && !rolled && <p className="mb-6 text-base" role="status">Máy đang lắc…</p>}
    </div>
  );
}
