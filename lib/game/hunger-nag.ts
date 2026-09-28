// 0047: fishing costs hunger and thirst, so a low bar nags me to go eat at Chợ Lớn — a speech bubble over my own head
// every NAG_EVERY_MS, local only (never sent to chat, never broadcast). Pure.

import type { Vitals } from "./vitals";

/** At or below this (either bar) the nag runs. */
export const NAG_AT = 20;
export const NAG_EVERY_MS = 10_000;
/** The HUD hint next to the bars while a bar is at or below NAG_AT. */
export const NAG_HINT = "🍜 Ra Chợ Lớn ăn uống";

export const HUNGER_LINES: readonly string[] = [
  "Đói quá… đi Chợ Lớn ăn thôi!",
  "Bụng réo rồi… ra Chợ Lớn kiếm gì ăn thôi!",
];
export const THIRST_LINES: readonly string[] = [
  "Khát khô cổ… ra Chợ Lớn uống nước thôi!",
  "Khát quá… ghé Chợ Lớn uống gì đi!",
];

type Bars = Pick<Vitals, "hunger" | "thirst">;

/** Which bars are low, hunger first. */
export function nagNeeds(v: Bars): ("hunger" | "thirst")[] {
  const out: ("hunger" | "thirst")[] = [];
  if (v.hunger <= NAG_AT) out.push("hunger");
  if (v.thirst <= NAG_AT) out.push("thirst");
  return out;
}

export const shouldNag = (v: Bars | null): boolean => v !== null && nagNeeds(v).length > 0;

/** The n-th nag's line (n = 0, 1, …): hunger first; both low → hunger and thirst alternate; each kind rotates its
 *  lines. null when neither bar is low. */
export function nagLine(v: Bars, n: number): string | null {
  const needs = nagNeeds(v);
  if (needs.length === 0) return null;
  const i = Math.max(0, Math.floor(n));
  const kind = needs[i % needs.length];
  const lines = kind === "hunger" ? HUNGER_LINES : THIRST_LINES;
  return lines[Math.floor(i / needs.length) % lines.length];
}
