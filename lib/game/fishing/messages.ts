import type { Interactable } from "@/lib/game/maps/types";
import { formatXu } from "./catalog";
import { castWaitMin, digWaitSec, type CastBlocker, type FishingState } from "./state";

// The fishing HUD's Vietnamese texts (spec §6, §10.1, §13). Pure.

export const SPOT_TAKEN = "Chỗ này có người câu rồi.";
export const NOT_LOADED = "Chưa tải được giỏ đồ — bấm “Tải lại giỏ đồ” nhé.";
export const LOADING = "Đang tải giỏ đồ…";
export const BAIT_FULL = "Hộp mồi đầy rồi.";
export const SONG_BONUS = "🎵 Bài bạn gọi đã phát xong: +10 xu";

export function dailyText(amount: number): string {
  return `🪙 Điểm danh hôm nay: +${amount} xu`;
}

export function digText(gained: number): string {
  return `🪱 Đào được ${gained} trùn đất!`;
}

export function digWaitText(sec: number): string {
  return `Đất còn cứng, chờ ${sec} giây nữa nhé.`;
}

export function saleText(sold: number, earned: number): string {
  return `Bán ${sold} con · +${formatXu(earned)}`;
}

/** Why a cast cannot start (same wording as the server errors, spec §8.6). */
export function blockerText(b: CastBlocker, waitMin: number): string {
  switch (b) {
    case "no_bait": return "Hết mồi — đào trùn hoặc mua mồi ở tiệm nhé.";
    case "hands_full": return "Tay đang cầm cá — ra vựa bán hoặc sắm xô nhé!";
    case "bucket_full": return "Xô đầy rồi — ra vựa bán bớt nhé!";
    case "cast_limit": return `Câu nhiều quá rồi, nghỉ tay chút nhé (còn ${Math.max(1, waitMin)} phút).`;
  }
}

/** The HUD prompt for an interactable: a dig spot counts down its cooldown, a fishing spot the hourly cap. */
export function promptText(it: Interactable, s: FishingState | null, now: number | null): string {
  if (!s || now === null) return it.prompt;
  if (it.kind === "dig_spot") {
    const sec = digWaitSec(s, now);
    return sec > 0 ? `${it.prompt} (còn ${sec} giây)` : it.prompt;
  }
  if (it.kind === "fish_spot") {
    const min = castWaitMin(s, now);
    return min > 0 ? `Nghỉ tay — còn ${min} phút` : it.prompt;
  }
  return it.prompt;
}
