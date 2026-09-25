import { ripeAfterHours, type Variety } from "./catalog";
import { cropModel, cropPhase } from "./crop";
import type { CropView } from "./state";

// Sổ tay nhà nông (spec §8.9): six tabs of static Vietnamese; the timings are worked out per variety from the catalog.
// Pure.

export type HandbookTab = "process" | "fertilizer" | "pests" | "water" | "varieties" | "tips";

export const HANDBOOK_TABS: ReadonlyArray<[HandbookTab, string]> = [
  ["process", "Quy trình"], ["fertilizer", "Phân bón"], ["pests", "Sâu bệnh"], ["water", "Nước"], ["varieties", "Giống lúa"], ["tips", "Mẹo"],
];

export interface HandbookSection { title: string; lines: string[] }

// The hour marks stay inside the model's windows, whose edges scale with the variety (lúa thơm top-dresses at
// 2.3–11.5 h): a window's start rounds up and its end or deadline rounds down, so acting at a printed hour is never
// early or late.
const start = (x: number) => `${Math.ceil(x)}`;
const end = (x: number) => `${Math.floor(x)}`;

/** The hour marks of a season for one variety (hours after transplanting unless said). */
function timings(v: Variety): string {
  const s = v.scale;
  return `${v.name}: cấy khi mạ ${start(8 * s)}–${end(14 * s)} giờ tuổi · bón thúc ${start(2 * s)}–${end(10 * s)} giờ sau cấy · `
    + `phơi ruộng ${start(14 * s)}–${end(18 * s)} · đón đòng ${start(18 * s)}–${end(24 * s)} · rút nước từ ${start(40 * s)} · `
    + `chín ${start(48 * s)} giờ sau cấy (~${ripeAfterHours(v)} giờ từ lúc ngâm).`;
}

export function handbookPage(tab: HandbookTab, varieties: readonly Variety[]): HandbookSection[] {
  switch (tab) {
    case "process":
      return [
        {
          title: "11 bước một vụ lúa",
          lines: [
            "1. Làm đất: cày bừa, cho nước vào ngập ruộng (mực Sâu).",
            "2. Bón lót: phân chuồng hoai và phân lân, trước khi cấy. Thiếu mỗi loại mất 5%.",
            "3. Ngâm ủ giống: 2 giờ là hạt nứt nanh.",
            "4. Gieo mạ: trong 6 giờ sau khi nứt nanh, ruộng phải Ẩm. Trễ mất 3% mỗi giờ; để quá 24 giờ hạt thối.",
            "5. Chăm mạ: giữ nước Ẩm cho tới khi mạ đủ tuổi.",
            "6. Cấy lúa: mạ đủ tuổi, nước Nông. Mạ già quá mất 3% mỗi giờ.",
            "7. Bón thúc đẻ nhánh: urê hoặc NPK, đúng lúc thì được trọn công.",
            "8. Phơi ruộng: tháo cạn nước mấy giờ cuối đẻ nhánh cho rễ ăn sâu.",
            "9. Bón đón đòng: kali hoặc NPK khi lúa làm đòng; giữ nước Nông–Sâu tới khi trổ bông.",
            "10. Rút nước: khi lúa vào chắc.",
            "11. Gặt: khi lúa chín; trễ mất 2% mỗi giờ, để 2 ngày thì lúa rụng hết. Gặt xong phơi 3 giờ rồi bán cô Út.",
          ],
        },
        { title: "Mốc giờ theo giống", lines: varieties.map(timings) },
      ];
    case "fertilizer":
      return [
        {
          title: "Loại phân và lúc bón",
          lines: [
            "Phân chuồng hoai, phân lân: bón lót, trước khi cấy. Sau khi cấy mới bón là phí.",
            "Phân urê (đạm): bón thúc đẻ nhánh.",
            "Phân kali: bón đón đòng.",
            "Phân NPK: dùng được cho cả hai lần bón thúc — chắc ăn nhất.",
          ],
        },
        {
          title: "Chấm điểm",
          lines: [
            "Mỗi lần bón thúc: đúng lúc được trọn công; sai lúc hoặc sai loại được nửa công (mất 10%); bỏ trống mất 20%.",
            "Bón nhiều lần một đợt chỉ tính lần tốt nhất.",
          ],
        },
        {
          title: "Dư đạm",
          lines: [
            "Bón urê lúc làm đòng, bón đạm hai lần trong một đợt, hoặc bón đạm từ lúc trổ bông trở đi là dư đạm.",
            "Dư đạm: sâu bệnh dễ tới hơn (gấp rưỡi) và lúa đổ ngã, mất 10% lúc gặt.",
          ],
        },
      ];
    case "pests":
      return [
        {
          title: "Nhận biết và chữa",
          lines: [
            "Ốc bươu vàng: trứng hồng bám thân lúa, ốc bò trong ruộng. Bắt ốc bằng tay (ai cũng bắt giúp được); nước Ẩm hay Khô thì ốc không phá.",
            "Sâu cuốn lá: lá cuộn trắng. Xịt thuốc trừ sâu.",
            "Rầy nâu: chấm nâu dưới gốc lúa. Xịt thuốc trừ rầy.",
            "Đạo ôn lá: đốm nâu hình thoi trên lá. Xịt thuốc trừ bệnh.",
            "Đạo ôn cổ bông: cổ bông trắng bạc. Xịt thuốc trừ bệnh.",
          ],
        },
        {
          title: "Thiệt hại",
          lines: [
            "Mỗi loại sâu bệnh chưa trị làm mất 1,5% mỗi giờ, tối đa 30%.",
            "Xịt sai thuốc hoặc xịt lúc không có sâu bệnh là phí thuốc.",
            "Dư đạm làm sâu bệnh dễ tới hơn; lúa thơm dễ bị đạo ôn hơn.",
          ],
        },
      ];
    case "water":
      return [
        {
          title: "Mực nước",
          lines: [
            "Bốn mức: Khô, Ẩm, Nông, Sâu. Cứ 12 giờ nước tự rút một mức.",
            "Bơm nước thêm một mức hoặc tháo bớt một mức ngay ở bảng thửa ruộng.",
          ],
        },
        {
          title: "Cần mức nào",
          lines: [
            "Mạ non: Ẩm.",
            "Đẻ nhánh: Nông; mấy giờ cuối tháo cạn để phơi ruộng.",
            "Làm đòng, trổ bông: Nông–Sâu (Sâu là tốt nhất).",
            "Vào chắc, chín: rút nước (Khô–Ẩm) — gặt phải rút nước trước.",
            "Mỗi giờ sai mức mất 1%, tối đa 20%.",
          ],
        },
      ];
    case "varieties":
      return [{
        title: "Giống lúa",
        lines: varieties.map((v) => `${v.name}: chín ~${ripeAfterHours(v)} giờ · ${v.baseKg} kg mỗi thửa · ${v.pricePerKg.toLocaleString("vi-VN")} xu/kg lúa khô`
          + (v.blastMult > 1 ? " · dễ bị đạo ôn" : "")),
      }];
    case "tips":
      return [{
        title: "Mẹo nhà nông",
        lines: [
          "Tháo nước xuống Ẩm là ốc bươu vàng hết phá.",
          "Không chắc bón gì thì bón NPK.",
          "Đừng bón đạm quá tay — dư đạm vừa hút sâu bệnh vừa làm lúa đổ.",
          "Phơi lúa cho khô rồi mới bán: lúa ướt cô Út chỉ trả bảy phần.",
          "Đất tư được thêm 10% lúa và không tốn tiền thuê.",
          "Gặt xong là trả ruộng thuê; muốn làm vụ nữa thì thuê lại.",
        ],
      }];
  }
}

/** The tab the plot panel links to: what matters on this crop now. */
export function handbookTabFor(crop: CropView | null, v: Variety | null, now: number): HandbookTab {
  if (!crop) return "process";
  if (crop.pests.some((p) => p.treatedAt === null)) return "pests";
  const ph = cropPhase(cropModel(crop), v, now);
  return ph === "tillering" || ph === "panicle" ? "fertilizer" : "process";
}
