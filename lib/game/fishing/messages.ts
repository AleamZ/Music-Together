import type { Interactable } from "@/lib/game/maps/types";
import { formatXu } from "./catalog";
import type { LostWhy } from "./rpc";
import { castBlocker, castWaitMin, dayCapped, digWaitSec, type CastBlocker, type FishingState } from "./state";

// The fishing HUD's Vietnamese texts (spec §6, §10.1, §13). Pure.

export const SPOT_TAKEN = "Chỗ này có người câu rồi.";
export const NOT_LOADED = "Chưa tải được giỏ đồ — bấm “Tải lại giỏ đồ” nhé.";
export const LOADING = "Đang tải giỏ đồ…";
export const BAIT_FULL = "Hộp mồi đầy rồi.";
export const SONG_BONUS = "🎵 Bài bạn gọi đã phát xong: +10 xu";
/** The daily cast cap (anti-cheat spec §12.4). */
export const DAILY_LIMIT_TEXT = "Hôm nay bạn câu đủ 300 lần rồi — mai quay lại nhé!";

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
    case "daily_limit": return DAILY_LIMIT_TEXT;
  }
}

/** The HUD prompt for an interactable: a dig spot counts down its cooldown, a fishing spot the hourly cap and the daily
 *  cap. */
export function promptText(it: Interactable, s: FishingState | null, now: number | null): string {
  if (!s || now === null) return it.prompt;
  if (it.kind === "dig_spot") {
    const sec = digWaitSec(s, now);
    return sec > 0 ? `${it.prompt} (còn ${sec} giây)` : it.prompt;
  }
  if (it.kind === "fish_spot") {
    const min = castWaitMin(s, now);
    if (min > 0) return `Nghỉ tay — còn ${min} phút`;
    return dayCapped(s, now) ? "Hết lượt câu hôm nay" : it.prompt;
  }
  return it.prompt;
}

export const MISSED = "Cá ăn mồi rồi chạy mất!";
export const REELED_IN = "Đã thu cần.";
export const ESCAPED = "Cá đã thoát!";
export const BAIT_SWITCHED = "Hết mồi đang chọn — dùng trùn đất.";

/** Why a cast may not start here and now (null = go): the state, the server's checks, then the spot (spec §6.1). */
export function castRefusal(s: FishingState | null, failed: boolean, now: number, spotTaken: boolean): string | null {
  if (!s) return failed ? NOT_LOADED : LOADING;
  const b = castBlocker(s, now);
  if (b) return blockerText(b, castWaitMin(s, now));
  return spotTaken ? SPOT_TAKEN : null;
}

/** A cast ended without a fish: a missed bite, "Thu cần", or a reel the fish won — or, after a won reel, the server
 *  still said no (a full hand or bucket, or the time gate). */
export function lostText(cause: "missed" | "reeled_in" | "reel", why: LostWhy | null, fishCap: number): string {
  if (cause === "missed") return MISSED;
  if (cause === "reeled_in") return REELED_IN;
  if (why === "full") return blockerText(fishCap <= 1 ? "hands_full" : "bucket_full", 0);
  return ESCAPED;
}
