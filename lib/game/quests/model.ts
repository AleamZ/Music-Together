// v21 quests (0071_quests.sql): the pure pieces the SQL pins. tests/unit/v21-quests.test.ts reads the migration and
// checks these copies are equal, so a change on one side fails the tests.
import type { Look } from "@/lib/game/types";

/** bác Ba Làng, the quest giver on the hall (0071 `_quest_giver`: map, x, y, reach). */
export const QUEST_GIVER = { map: "hall", x: 368, y: 216, reach: 72 } as const;

export const BAC_BA_LANG_LOOK: Look = {
  skin: "tan", hair: "short", hairColor: "silver",
  hat: "hat_nonla", top: "top_baba_yellow", bottom: "bottom_pants_black", shoes: "shoes_dep_brown", neck: "neck_khanran", gender: "nam",
};

/** The 7-day login calendar (0071 `_login_rewards`), in xu. */
export const LOGIN_REWARDS: readonly number[] = [20, 30, 40, 50, 60, 80, 150];

/** Economy v2 (0104 `_company_share`): a finished company goal's pool (its `coins`, 3 000) is shared by contribution. A
 *  contributor with at least COMPANY_MIN_PCT % of the goal gets floor(pool × mine / total), at most COMPANY_SHARE_MAX, and
 *  the goal's XP; under that, nothing. `total` is everyone's contribution (the last one may pass the goal); while the goal is
 *  open the estimate uses the goal. */
export const COMPANY_SHARE_MAX = 300;
export const COMPANY_MIN_PCT = 1;
export function companyShare(pool: number, mine: number, goal: number, total: number = goal): number {
  if (!(goal > 0) || mine * 100 < goal * COMPANY_MIN_PCT) return 0;
  return Math.min(COMPANY_SHARE_MAX, Math.floor((pool * mine) / Math.max(goal, total)));
}

/** Album limits (0071 photo_save). */
export const PHOTO_MAX_CHARS = 150_000;
export const PHOTO_MAX_COUNT = 24;

/** The day of the 7-day calendar that today's claim would be (1–7) from the current streak (0 = broken / none). */
export function nextLoginSlot(streak: number, claimedToday: boolean): number {
  const s = Math.max(0, Math.floor(streak));
  if (claimedToday) return ((Math.max(1, s) - 1) % 7) + 1;
  return (s % 7) + 1;
}

export type QuestCat = "daily" | "weekly" | "npc" | "explore";
export type QuestStatus = "locked" | "available" | "active" | "done" | "claimed";

const ERRORS: Record<string, string> = {
  "too far": "Hãy đứng cạnh bác Ba Làng ở Sảnh.",
  "quest locked": "Làm xong nhiệm vụ trước đã.",
  "too many quests": "Bạn đang nhận 3 nhiệm vụ của bác Ba — làm xong bớt đã.",
  "not done": "Chưa hoàn thành.",
  "already claimed": "Đã nhận thưởng rồi.",
  "nothing to claim": "Không có thưởng để nhận.",
  "bad photo": "Ảnh không hợp lệ hoặc quá lớn.",
  "album full": `Album đã đầy (${PHOTO_MAX_COUNT} ảnh) — xoá bớt ảnh cũ.`,
  "too many photos": "Chụp chậm thôi — tối đa 12 ảnh mỗi 10 phút.",
  "bad name": "Tên đội 2–24 ký tự.",
  "already in a team": "Bạn đã có đội.",
  "unknown team": "Không có đội với mã này.",
  "team full": "Đội đã đủ 2 người.",
  "team not full": "Cả hai đội phải đủ 2 người.",
  "same team": "Không thể thách đấu đội mình.",
  "bad stake": "Tiền cược 0–500 xu.",
  "team busy": "Một trong hai đội đang có loạt đấu.",
  "pair cap": "Hai đội đã cược với nhau 3 lần hôm nay.",
  "insufficient funds": "Không đủ xu.",
  "series gone": "Lời thách đấu không còn.",
  "not your challenge": "Không phải lời thách của đội bạn.",
  "roster changed": "Đội hình đã thay đổi — lời thách bị huỷ và hoàn tiền.",
  "series running": "Đội đang có loạt đấu.",
  "no team": "Bạn chưa có đội.",
  "account locked": "Tài khoản đang bị khoá tạm thời.",
  "client outdated": "Trang đã cũ — hãy tải lại.",
};

export function questErrorMessage(msg: string): string {
  for (const [k, v] of Object.entries(ERRORS)) if (msg.includes(k)) return v;
  return "Có lỗi, thử lại sau.";
}
