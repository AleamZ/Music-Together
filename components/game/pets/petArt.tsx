"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { drawPet } from "@/lib/game/art/pets";
import type { PetLook } from "@/lib/game/pets/model";

// v22 pets: small shared bits for the minigames and animations (the reduced-motion flag, a pet canvas, keyframes).

const RM = "(prefers-reduced-motion: reduce)";
function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const m = window.matchMedia(RM);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}
/** The player asked the OS for less motion. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => typeof window.matchMedia === "function" && window.matchMedia(RM).matches, () => false);
}

/** A pet sprite on a small canvas (feet at the bottom centre). */
export function PetCanvas({ look, scale = 3, flip = false, className, style }: {
  look: PetLook | null; scale?: number; flip?: boolean; className?: string; style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (!c) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, 22 * scale, 26 * scale);
    if (!look) return;
    c.setTransform(scale, 0, 0, scale, 0, 0);
    drawPet(c, look, flip ? "left" : "right", 0, 11, 24, 0, true);
  }, [look, scale, flip]);
  return <canvas ref={ref} width={22 * scale} height={26 * scale} className={`[image-rendering:pixelated] ${className ?? ""}`} style={style} aria-hidden="true" />;
}

/** The keyframes the pet animations use (scoped names). */
export const PET_ANIM_CSS = `
@keyframes pmg-shake { 0%,100% { transform: translateX(0) rotate(0) } 20% { transform: translateX(-3px) rotate(-2deg) } 40% { transform: translateX(3px) rotate(2deg) } 60% { transform: translateX(-2px) rotate(-1deg) } 80% { transform: translateX(2px) rotate(1deg) } }
@keyframes pmg-wobble { 0%,100% { transform: rotate(0) } 25% { transform: rotate(-12deg) } 75% { transform: rotate(12deg) } }
@keyframes pmg-drop { 0% { transform: translateY(-40px); opacity: 0 } 60% { transform: translateY(4px); opacity: 1 } 100% { transform: translateY(0) } }
@keyframes pmg-burst { 0% { transform: scale(0.2); opacity: 1 } 100% { transform: scale(2.4); opacity: 0 } }
@keyframes pmg-rays { from { transform: rotate(0) } to { transform: rotate(360deg) } }
@keyframes pmg-pop { 0% { transform: scale(0) } 70% { transform: scale(1.2) } 100% { transform: scale(1) } }
@keyframes pmg-float { 0% { transform: translateY(0); opacity: 1 } 100% { transform: translateY(-28px); opacity: 0 } }
@keyframes pmg-knock { 0%,100% { transform: translateX(0) } 15% { transform: translateX(-3px) } 30% { transform: translateX(2px) } 45% { transform: translateX(-3px) } 60% { transform: translateX(2px) } }
@keyframes pmg-fist { 0%,100% { transform: translateX(0) rotate(0) } 15%,45% { transform: translateX(-6px) rotate(-10deg) } 30%,60% { transform: translateX(0) rotate(0) } }
@keyframes pmg-faint { 0% { transform: rotate(0); opacity: 1 } 100% { transform: rotate(90deg) translateX(10px); opacity: 0.35 } }
@keyframes pmg-flash { 0%,100% { filter: none } 30% { filter: brightness(3) saturate(0) } 60% { filter: sepia(1) saturate(6) hue-rotate(-40deg) } }
`;
