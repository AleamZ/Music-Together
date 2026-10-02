import { npcCutNote } from "@/lib/game/economy/npc";
import type { Interactable } from "@/lib/game/maps/types";
import { formatWeight, formatXu } from "./catalog";
import type { LostWhy, Snap } from "./rpc";
import { castBlocker, digWaitSec, type CastBlocker, type FishingState } from "./state";

// The fishing HUD's Vietnamese texts (spec §6, §10.1, §13). Pure.

export const SPOT_TAKEN = "Chỗ này có người câu rồi.";
export const NOT_LOADED = "Chưa tải được giỏ đồ — bấm “Tải lại giỏ đồ” nhé.";
export const LOADING = "Đang tải giỏ đồ…";
export const BAIT_FULL = "Hộp mồi đầy rồi.";
export const SONG_BONUS = "🎵 Bài bạn gọi đã phát xong: +10 xu";
/** An old server's daily cast cap error (0047 removed the cap; casts now cost hunger and thirst). */
export const DAILY_LIMIT_TEXT = "Câu mệt rồi — nghỉ chút rồi câu tiếp nhé!";

/** 0110: a bare rod without its hook and line (start_cast's 'rod needs parts'). */
export const NEEDS_PARTS = "Cần này chưa đủ đồ — lắp lưỡi và dây câu (mở Giỏ đồ) rồi hãy quăng.";

/** 0110: a won reel broke the rig — the line (gone after its last snap) or the rod (repairable at chú Tư's). */
export function snapText(why: "line_snap" | "rod_snap", snap: Snap | null | undefined, name: string): string {
  const fish = snap ? `${name} nặng ${formatWeight(snap.weightG)}` : "Con cá quá nặng";
  if (why === "rod_snap") return `💥 ${fish} bẻ gãy cần — đã đổi sang cần gỗ. Mang tới tiệm chú Tư sửa nhé!`;
  const lim = snap && snap.limitG > 0 ? ` (dây chịu ${formatWeight(snap.limitG)})` : "";
  return snap?.lineGone ? `🧵 ${fish} làm đứt dây${lim} — dây câu hỏng hẳn rồi, mua dây mới nhé.`
    : `🧵 ${fish} làm đứt dây${lim} — cá thoát mất!`;
}

/** 0110: a groundbait thrown. */
export function groundbaitText(name: string): string {
  return `🌾 Đã rải ${name} — ổ thính ở đây thêm 10 phút; ai câu quanh ổ cũng được loài ưa thính này tụ về.`;   // 0117: the spot's
}
/** 0110: a groundbait from the bag with no spot yet. */
export const GROUNDBAIT_WHERE = "Quăng cần một lần ở chỗ muốn câu (hoặc đứng ở mép ao), rồi hãy rải thính.";

/** 0110: the multi-hook's other fish, landed with the first. */
export function extraText(names: string[]): string {
  return `🎣 Lưỡi nhiều mũi dính thêm ${names.length} con: ${names.join(", ")}!`;
}

/** v18.2: the rod wore down to 0 on this cast. */
export const ROD_BROKE = "💥 Cần câu gãy rồi — đã đổi sang cần gỗ. Mang tới tiệm chú Tư sửa nhé!";
/** Econ v2 (0101): the shop's line by the bait — a better bait brings rarer fish, which the wooden rod cannot hold. */
export const BAIT_HINT = "Mồi xịn hợp với cần xịn — cần tre trở lên mới giữ được cá hiếm.";
/** 0110: the shop's line by the rods — a rod is sold bare. */
export const ROD_HINT = "Cần bán trơn (trừ cần gỗ): lắp thêm lưỡi và dây câu mới quăng được; máy xoay, phao tùy chọn.";
/** v18.2: net texts. */
export const NO_NET = "Bạn chưa có lưới — tiệm chú Tư có bán.";
export const NET_TOO_EARLY = "Kéo lưới vội quá, cá thoát hết rồi.";
export const NET_EXPIRED = "Lưới trôi mất rồi.";
/** 0056: the server's replay refused the throw or the pull. */
export const NET_INVALID = "Lưới vướng rồi — quăng lại nhé.";
/** 0056: a page from before the net replay (the server answered 'outdated'). */
export const NET_OUTDATED = "Cập nhật trang để quăng lưới tiếp.";

/** A lost throw or pull (net_haul / finish_net). */
export function netLostText(why: "expired" | "too_early" | "net_invalid" | "outdated"): string {
  return why === "expired" ? NET_EXPIRED : why === "net_invalid" ? NET_INVALID : why === "outdated" ? NET_OUTDATED : NET_TOO_EARLY;
}

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

/** A sale's toast; `cut` (econ v2, 0101): what the thương lái kept back, said after the pay when there was any. */
export function saleText(sold: number, earned: number, cut = 0): string {
  const note = npcCutNote(cut);
  return `Bán ${sold} con · +${formatXu(earned)}${note ? ` — ${note}` : ""}`;
}

/** Why a cast cannot start (same wording as the server errors, spec §8.6). */
export function blockerText(b: CastBlocker, waitMin: number): string {
  switch (b) {
    case "no_bait": return "Hết mồi — đào trùn hoặc mua mồi ở tiệm nhé.";
    case "hands_full": return "Tay đang cầm cá — ra vựa bán hoặc sắm xô nhé!";
    case "bucket_full": return "Xô đầy rồi — ra vựa bán bớt nhé!";
    case "cast_limit": return waitMin > 0 ? `Câu mệt rồi — nghỉ chút nhé (còn ${waitMin} phút).` : DAILY_LIMIT_TEXT;
    case "daily_limit": return DAILY_LIMIT_TEXT;
    case "needs_parts": return NEEDS_PARTS;
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
  return it.prompt;                                               // 0047: no cast caps to count down
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

/** 0059: a hooked cast left unfinished was given up when I cast again (the rod's name when it was lost). */
export function abandonedText(a: { big: boolean; hunger: number; rodLost: boolean }, rodName: string): string {
  if (!a.big) return "🎣 Con cá đã cắn câu lần trước thoát mất rồi.";
  return a.rodLost ? `🌊 Con cá lớn lần trước giật mất ${rodName}! Đói thêm ${a.hunger}.`
    : `🌊 Con cá lớn lần trước giật cần một phen — đói thêm ${a.hunger}.`;
}

/** Why a cast may not start here and now (null = go): the state, the server's checks, then the spot (spec §6.1). */
export function castRefusal(s: FishingState | null, failed: boolean, spotTaken: boolean): string | null {
  if (!s) return failed ? NOT_LOADED : LOADING;
  const b = castBlocker(s);
  if (b) return blockerText(b, 0);
  return spotTaken ? SPOT_TAKEN : null;
}

/** 0046: finish_cast got a won reel without its input (a page from before the server replay). */
export const OUTDATED = "Cập nhật trang để câu tiếp";

/** A cast ended without a fish: a missed bite, "Thu cần", or a reel the fish won — or, after a won reel, the server
 *  still said no (a full hand or bucket, or the time gate). */
export function lostText(cause: "missed" | "reeled_in" | "reel" | "nobite", why: LostWhy | null, fishCap: number,
                         snap?: Snap | null, fishName = ""): string {
  if (cause === "nobite" || why === "no_bite") return NO_BITE;
  if (cause === "missed") return MISSED;
  if (cause === "reeled_in") return REELED_IN;
  if (why === "line_snap" || why === "rod_snap") return snapText(why, snap, fishName);   // 0110
  if (why === "full") return blockerText(fishCap <= 1 ? "hands_full" : "bucket_full", 0);
  if (why === "outdated") return OUTDATED;
  return ESCAPED;
}
