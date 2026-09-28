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
  // v20.3 the rings (refusals are answers; a few malformed calls raise)
  ["ring busy", "Sàn đang bận, hoặc đã đủ số trận đang diễn ra — chờ chút nhé."],
  ["daily fight limit", "Hôm nay đã đấu đủ số trận cho phép rồi."],
  ["not enough xu", "Không đủ xu cho mức cược này."],
  ["pvp locked", "Đang tạm khóa đấu cược 7 ngày — vẫn đấu giao hữu được."],
  ["offer changed", "Mức cược vừa đổi — xem lại rồi đồng ý nhé."],
  ["offer lapsed", "Lời mời cược đã hết hạn."],
  ["corner taken", "Góc này có người đứng rồi."],
  ["no opponent", "Chưa có đối thủ ở góc bên kia."],
  ["already in a corner", "Bạn đang đứng ở một góc sàn khác."],
  ["in a match", "Bạn đang trong một trận đấu."],
  ["not in ring", "Bạn không đứng ở sàn này."],
  ["not a ring match", "Trận này không phải trận trên sàn."],
  ["bad stake", "Mức cược không hợp lệ."],
  ["bad ring", "Không có sàn hay góc này."],
  ["bad delay", "Độ trễ mạng không hợp lệ."],
  ["account locked", "Tài khoản đang bị khóa tạm thời."],
  ["locked", "Tài khoản đang bị khóa tạm thời."],
];

/** v20.3: a refusal from a ring action names whose side it concerns. */
export function ringRefusalText(code: string, who: "red" | "blue" | null, mine: "red" | "blue" | null): string {
  const base = fightErrorMessage(code);
  if (!who || !mine) return base;
  if (code === "not enough xu") return who === mine ? "Bạn không đủ xu cho mức cược này." : "Đối thủ không đủ xu cho mức cược này.";
  return who === mine ? base : `Đối thủ: ${base.charAt(0).toLowerCase()}${base.slice(1)}`;
}

/** The copy for an RPC error (its message), else a generic line. */
export function fightErrorMessage(err: unknown): string {
  const msg = typeof err === "string" ? err : ((err as { message?: string } | null)?.message ?? "");
  for (const [k, v] of TEXT) if (msg === k || msg.includes(k)) return v;
  return "Có lỗi, thử lại sau nhé.";
}

export const ENROLL_TEXT = `Nhập môn · ${formatXu(TUITION)}`;
