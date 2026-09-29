// v22 world minigames: the one-line instructions and the result lines (Vietnamese). Display only.
import type { WildGame } from "./minigames";

export const WILD_HELP: Record<WildGame | "net", string> = {
  hunt: "Ngắm đón đầu con thú (tính cả gió) rồi bấm Space / chạm để bắn — tối đa 3 phát.",
  trap: "Chờ con thú bước vào bẫy rồi bấm Space / chạm để giật dây!",
  net: "Quét lưới (Space / chạm) đúng lúc con vật bay ngang vùng lưới!",
  photo: "Đưa thú vào giữa khung, Space / chạm để chụp (3 kiểu), E để phóng to — chụp lúc nó nhìn vào máy!",
};
export const DODGE_HELP = "Con thú lao tới — bấm E (hoặc nút Né) đúng lúc để né cú vồ!";
export const COMBO_HELP = "Bấm mũi tên đúng lúc nó chạm vòng; khi boss vung đòn, bấm Space (Né) để tránh.";

const pick = (xs: readonly string[], k: number) => xs[Math.abs(k) % xs.length];
const OK: Record<WildGame | "net" | "dodge" | "combo", readonly string[]> = {
  hunt: ["Trúng rồi, giỏi quá!", "Phát bắn đẹp đấy!", "Con mồi đã bị hạ!"],
  trap: ["Bẫy sập đúng lúc!", "Bắt được rồi nhé!", "Tay đặt bẫy khéo quá!"],
  net: ["Vào lưới rồi!", "Cú quét khéo quá!", "Bắt được rồi nhé!"],
  photo: ["Bức ảnh đẹp quá!", "Bắt trọn khoảnh khắc rồi!", "Thú lên hình xinh ghê!"],
  dodge: ["Né gọn ghê!", "Thoát cú vồ rồi!", "Phản xạ nhanh quá!"],
  combo: ["Chuỗi đòn thật đẹp!", "Giữ nhịp tốt lắm!", "Đòn đánh liền mạch quá!"],
};
const NO: typeof OK = {
  hunt: ["Trượt mất rồi!", "Con mồi chạy thoát!", "Thử ngắm lại nhé!"],
  trap: ["Thú né được bẫy!", "Kéo dây hơi lệch nhịp!", "Lần sau canh kỹ hơn nhé!"],
  net: ["Bay mất rồi!", "Lưới quét hơi sớm!", "Chậm một nhịp mất rồi!"],
  photo: ["Thú ra khỏi khung rồi!", "Ảnh bị lỡ khoảnh khắc!", "Thử canh khung lại nhé!"],
  dodge: ["Bị vồ trúng rồi!", "Chậm mất một nhịp!", "Chú ý dấu hiệu nhé!"],
  combo: ["Lỡ nhịp rồi!", "Chuỗi đòn bị ngắt!", "Thử bắt nhịp lại nhé!"],
};
export const okLine = (k: keyof typeof OK, seed: number) => pick(OK[k], seed);
export const noLine = (k: keyof typeof OK, seed: number) => pick(NO[k], seed);
export const JUDGE_TEXT: Record<string, string> = { perfect: "Hoàn hảo!", good: "Tốt", miss: "Trượt" };
