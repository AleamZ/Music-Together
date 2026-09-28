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

/** v18.2: the rod wore down to 0 on this cast. */
export const ROD_BROKE = "💥 Cần câu gãy rồi — đã đổi sang cần gỗ. Mang tới tiệm chú Tư sửa nhé!";
/** v18.2: net texts. */
export const NO_NET = "Bạn chưa có lưới — tiệm chú Tư có bán.";
export const NET_TOO_EARLY = "Kéo lưới vội quá, cá thoát hết rồi.";
export const NET_EXPIRED = "Lưới trôi mất rồi.";

export function netText(count: number): string {
  return count > 0 ? `🕸️ Kéo lưới được ${count} con cá!` : "🕸️ Lưới rỗng — cá thoát hết rồi.";
}

export function repairText(name: string, cost: number): string {
  return `🔧 Đã sửa ${name} · −${formatXu(cost)}`;
}

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
/** v18.1: a shore cast that got no bite. */
export const NO_BITE = "Chẳng có cá nào cắn câu… ra cầu ao câu dễ hơn đó.";
/** v18.1: a cast from a cell the server does not accept. */
export const BAD_SPOT = "Chỗ này không quăng cần được.";

/** v18.1: a big fish pulled me into the pond (the rod's name when it was lost). */
export function overboardText(hunger: number, lostRod: string | null): string {
  const base = `🌊 Cá lớn kéo bạn xuống ao! Mất cá, đói thêm ${hunger}.`;
  return lostRod ? `${base} ${lostRod} trôi mất rồi…` : `${base} Bơi vào bờ nhé!`;
}

/** Why a cast may not start here and now (null = go): the state, the server's checks, then the spot (spec §6.1). */
export function castRefusal(s: FishingState | null, failed: boolean, now: number, spotTaken: boolean): string | null {
  if (!s) return failed ? NOT_LOADED : LOADING;
  const b = castBlocker(s, now);
  if (b) return blockerText(b, castWaitMin(s, now));
  return spotTaken ? SPOT_TAKEN : null;
}

/** 0046: finish_cast got a won reel without its input (a page from before the server replay). */
export const OUTDATED = "Cập nhật trang để câu tiếp";

/** A cast ended without a fish: a missed bite, "Thu cần", or a reel the fish won — or, after a won reel, the server
 *  still said no (a full hand or bucket, or the time gate). */
export function lostText(cause: "missed" | "reeled_in" | "reel" | "nobite", why: LostWhy | null, fishCap: number): string {
  if (cause === "nobite" || why === "no_bite") return NO_BITE;
  if (cause === "missed") return MISSED;
  if (cause === "reeled_in") return REELED_IN;
  if (why === "full") return blockerText(fishCap <= 1 ? "hands_full" : "bucket_full", 0);
  if (why === "outdated") return OUTDATED;
  return ESCAPED;
}
