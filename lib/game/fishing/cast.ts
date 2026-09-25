import type { FishPhase } from "@/lib/game/net/protocol";
import type { Rarity } from "./catalog";
import type { ReelParams } from "./reel";

// The cast timeline after start_cast answers (spec §6.1): wait for the bite, then a short window to hook. Pure.

export interface CastInfo {
  castId: string; biteMs: number; windowMs: number; difficulty: number; minReelMs: number; zonePct: number;
  /** Shown by Phao xốp / Phao đèn only. */
  rarity: Rarity | null;
}

export type CastPhase = "waiting" | "bite" | "missed";

/** Phase `sinceAnswerMs` after the start_cast answer arrived. */
export function castPhase(info: CastInfo, sinceAnswerMs: number): CastPhase {
  if (sinceAnswerMs < info.biteMs) return "waiting";
  if (sinceAnswerMs < info.biteMs + info.windowMs) return "bite";
  return "missed";
}

export function canHook(info: CastInfo, sinceAnswerMs: number): boolean {
  return castPhase(info, sinceAnswerMs) === "bite";
}

/** ms until the phase changes, or null once the bite was missed. */
export function msToNextPhase(info: CastInfo, sinceAnswerMs: number): number | null {
  if (sinceAnswerMs < info.biteMs) return info.biteMs - sinceAnswerMs;
  if (sinceAnswerMs < info.biteMs + info.windowMs) return info.biteMs + info.windowMs - sinceAnswerMs;
  return null;
}

export function reelParamsFor(info: CastInfo, seed: number): ReelParams {
  return { zonePct: info.zonePct, difficulty: info.difficulty, minReelMs: info.minReelMs, seed };
}

/** What the local player is doing with the rod, as the engine draws it (spec §6.1). */
export type LocalPhase = "idle" | "casting" | "waiting" | "bite" | "reeling";

/** The `f` code the others see (spec §9.3): the cast swing shows nothing yet. */
export function phaseCode(p: LocalPhase): FishPhase {
  return p === "waiting" ? 1 : p === "bite" ? 2 : p === "reeling" ? 3 : 0;
}
