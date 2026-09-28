// v20 Võ đài: keyboard and touch → the 10-bit input mask (spec §v20.1 "Input mask"). Left and right are absolute on
// the wire; the engine turns them into back and forward from the fighter's facing.

import { IN_BL, IN_DOWN, IN_HK, IN_HP, IN_LEFT, IN_LK, IN_LP, IN_RIGHT, IN_SK, IN_UP } from "./engine";

/** KeyboardEvent.code → bit (layout-independent). */
export const KEY_BITS: Readonly<Record<string, number>> = {
  KeyA: IN_LEFT, ArrowLeft: IN_LEFT,
  KeyD: IN_RIGHT, ArrowRight: IN_RIGHT,
  KeyW: IN_UP, ArrowUp: IN_UP,
  KeyS: IN_DOWN, ArrowDown: IN_DOWN,
  KeyU: IN_LP, KeyI: IN_HP, KeyJ: IN_LK, KeyK: IN_HK, KeyL: IN_BL, KeyO: IN_SK,
};

export function maskFromKeys(keys: Iterable<string>): number {
  let m = 0;
  for (const k of keys) m |= KEY_BITS[k] ?? 0;
  return m;
}

/** The touch pad's eight directions (null: neutral). */
export type PadDir = "u" | "ur" | "r" | "dr" | "d" | "dl" | "l" | "ul";
const PAD_BITS: Readonly<Record<PadDir, number>> = {
  u: IN_UP, ur: IN_UP | IN_RIGHT, r: IN_RIGHT, dr: IN_DOWN | IN_RIGHT, d: IN_DOWN, dl: IN_DOWN | IN_LEFT, l: IN_LEFT, ul: IN_UP | IN_LEFT,
};
export const padMask = (d: PadDir | null): number => (d ? PAD_BITS[d] : 0);

/** The pad direction of a touch at (dx, dy) from the pad's centre; within `dead` px it is neutral. */
export function padDirAt(dx: number, dy: number, dead: number): PadDir | null {
  if (dx * dx + dy * dy < dead * dead) return null;
  const a = Math.atan2(-dy, dx);                                      // screen y points down
  const sector = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  return (["r", "ur", "u", "ul", "l", "dl", "d", "dr"] as const)[sector];
}

/** The six touch buttons on the right, with their keys. */
export const BUTTONS: readonly { bit: number; key: string; label: string }[] = [
  { bit: IN_LP, key: "U", label: "Đấm nhẹ" },
  { bit: IN_HP, key: "I", label: "Đấm nặng" },
  { bit: IN_LK, key: "J", label: "Đá nhẹ" },
  { bit: IN_HK, key: "K", label: "Đá nặng" },
  { bit: IN_BL, key: "L", label: "Đỡ" },
  { bit: IN_SK, key: "O", label: "Chiêu" },
];

/** The key legend under the arena. */
export const LEGEND: readonly [string, string][] = [
  ["A D / ← →", "đi (giữ lùi để đỡ)"],
  ["W / ↑", "nhảy"],
  ["S / ↓", "ngồi"],
  ["U · I", "đấm nhẹ · nặng"],
  ["J · K", "đá nhẹ · nặng"],
  ["L", "đỡ"],
  ["U + J", "quật (ôm vật)"],
  ["O", "chiêu (+100 nội lực) · O+← O+↓ O+→ O+L"],
  ["↓ ↘ → + đấm", "Cú đấm bụi đời"],
];
