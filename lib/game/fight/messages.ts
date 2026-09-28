// v20.2: the Vietnamese copy for the dojo's and the fight pipeline's refusals (0049, 0050, and the vitals guard).

import { formatXu } from "@/lib/game/fishing/catalog";
import { TUITION } from "./dojo";

const TEXT: readonly [string, string][] = [
  ["insufficient funds", "Không đủ xu."],
  ["already enrolled", "Bạn đã nhập môn võ phái này rồi."],
  ["not enrolled", "Bạn chưa nhập môn võ phái này."],
  ["unknown style", "Võ đường không dạy võ phái này."],
  ["no uniform", "Hãy mặc võ phục của võ phái này trước đã."],
  ["max rank", "Bạn đã lên đai cao nhất rồi!"],
  ["too soon", "Chưa đủ thời gian luyện tập ở đai hiện tại."],
  ["exam cooldown", "Vừa thi trượt — chờ hết thời gian nghỉ rồi thi lại nhé."],
  ["exam in progress", "Bạn đang có một bài thi dở dang."],
  ["exam not found", "Không tìm thấy bài thi."],
  ["too hungry to fight", "Đói quá không đánh nổi — ăn chút gì đã (cần no ≥ 10)."],
  ["too thirsty to fight", "Khát quá — uống nước đã (cần khát ≥ 10)."],
  ["too hungry", "Bạn đói lả rồi — ăn chút gì đã."],
  ["too thirsty", "Bạn khát khô cổ — uống nước đã."],
  ["fainted", "Bạn đang ngất, chờ hồi sinh…"],
  ["exhausted", "Hôm nay bạn kiệt sức rồi — mai quay lại nhé."],
  ["match not found", "Không tìm thấy trận đấu."],
  ["not your match", "Đây không phải trận của bạn."],
  ["no character", "Hãy tạo nhân vật trước đã."],
  ["uniform", "Võ phục do võ đường cấp — không mua, bán hay tặng được."],
  ["locked", "Tài khoản đang bị khóa tạm thời."],
];

/** The copy for an RPC error (its message), else a generic line. */
export function fightErrorMessage(err: unknown): string {
  const msg = typeof err === "string" ? err : ((err as { message?: string } | null)?.message ?? "");
  for (const [k, v] of TEXT) if (msg === k || msg.includes(k)) return v;
  return "Có lỗi, thử lại sau nhé.";
}

export const ENROLL_TEXT = `Nhập môn · ${formatXu(TUITION)}`;
