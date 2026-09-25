import { ripeAfterHours, uplandHours, type FarmItem, type UplandCrop, type Variety } from "./catalog";
import { cropModel, cropPhase } from "./crop";
import { bedLevelsText } from "./messages";
import type { CropView } from "./state";

// Sổ tay nhà nông (spec §8.9, v15.2 §14): the six rice tabs, one tab per hoa-màu crop worked out from its config, and
// "Nông cụ"; the rice timings are worked out per variety from the catalog. Pure.

/** A rice tab, "tools", or a hoa-màu crop's id. */
export type HandbookTab = string;

/** The rice tabs. */
export const HANDBOOK_TABS: ReadonlyArray<[HandbookTab, string]> = [
  ["process", "Quy trình"], ["fertilizer", "Phân bón"], ["pests", "Sâu bệnh"], ["water", "Nước"], ["varieties", "Giống lúa"], ["tips", "Mẹo"],
];

/** Every tab (§14): the rice ones, a tab per hoa-màu crop, then Nông cụ. */
export function handbookTabs(uplands: readonly UplandCrop[]): ReadonlyArray<[HandbookTab, string]> {
  return [...HANDBOOK_TABS, ...uplands.map((u): [HandbookTab, string] => [u.id, u.name]), ["tools", "Nông cụ"]];
}

export interface HandbookSection { title: string; lines: string[] }

// The hour marks stay inside the model's windows, whose edges scale with the variety (lúa thơm top-dresses at
// 2.3–11.5 h): a window's start rounds up and its end or deadline rounds down, so acting at a printed hour is never
// early or late.
const start = (x: number) => `${Math.ceil(x)}`;
const end = (x: number) => `${Math.floor(x)}`;
const pct = (x: number) => `${Math.round(x * 100)}`;
const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** The crop tips (§14), by crop id. */
const UPLAND_TIPS: Record<string, string> = {
  khoai: "Mẹo: tưới cho Ẩm lúc tượng củ để sùng khỏi chui vào củ, nhưng đừng tưới tới Đẫm.",
  bap: "Mẹo: bắp ưa nước — tưới lên Đẫm là giữ được cả ngày; lúc chắc hạt thì cho ráo.",
  ot: "Mẹo: ớt nhiều việc nhất mà lời nhất; tháo nước về Ẩm trước mỗi lứa hái.",
};

/** A crop's tab (§14), worked out from its config; `items` name the fertilizers and pesticides. */
export function uplandHandbook(u: UplandCrop, items: readonly FarmItem[]): HandbookSection[] {
  const itemName = (id: string) => lc(items.find((i) => i.id === id)?.name ?? id);
  const n = u.pickings.length;
  const total = (u.nurseryReadyH ?? 0) + uplandHours(u, n);
  const how = u.method === "cutting" ? `3. ${u.plantLabel} khi đất Ẩm.`
    : u.method === "direct" ? `3. ${u.plantLabel} thẳng xuống luống khi đất Ẩm — không cần ươm.`
    : `3. ${u.plantLabel} ở góc luống khi đất Ẩm, giữ Ẩm. ${u.transplantLabel ?? ""} khi cây ${start(u.nurseryReadyH ?? 0)}–`
      + `${end(u.nurseryOldH ?? 0)} giờ tuổi, đất Ẩm; cây già quá mất 3% mỗi giờ (tối đa 30%).`;
  const cares = u.cares.map((c, i) => `${4 + i}. ${c.name}: ` + (c.kind === "fert"
    ? `${c.items.map(itemName).join(" hoặc ")}, ${start(c.fromH)}–${end(c.toH)} giờ sau trồng. Sai lúc hoặc sai loại được nửa công `
      + `(mất ${pct(c.penHalf)}%); bỏ trống mất ${pct(c.penMissing)}%.`
    : `${start(c.fromH)}–${end(c.toH)} giờ sau trồng; trễ tới ${end(c.halfToH)} giờ được nửa công (mất ${pct(c.penHalf)}%); `
      + `không làm mất ${pct(c.penMissing)}%.`));
  // stages in a row that want the same levels read as one group
  const groups: Array<{ names: string[]; levels: string }> = [];
  for (const st of u.stages) {
    const levels = bedLevelsText(st.water), last = groups[groups.length - 1];
    if (last && last.levels === levels) last.names.push(st.name);
    else groups.push({ names: [st.name], levels });
  }
  const water = `Nước: ${groups.map((g) => `${g.names.join(", ")} ${g.levels}`).join("; ")}; từ lúc chín ${bedLevelsText(u.ripeWater)}. `
    + "Cứ 12 giờ nước tự rút một mức; mỗi giờ sai mức mất 1% (tối đa 20%).";
  const harvest = `${u.harvestLabel}: chín ${end(uplandHours(u, 1))} giờ sau trồng`
    + (n > 1 ? `, rồi cứ ${end(u.pickGapH ?? 0)} giờ một lứa (${u.pickings.map((p) => `${p}%`).join(" – ")})` : "")
    + `. Đất phải ${bedLevelsText(u.ripeWater)}. Chín quá ${end(u.ripeWindowH)} giờ mất ${pct(u.overRate)}% mỗi giờ; `
    + `để thêm ${end(u.lostAfterH)} giờ là ${n > 1 ? "lứa đó" : "cả vụ"} hư.`;
  const mult = (x: number) => x.toLocaleString("vi-VN");
  const pests = u.pests.map((p) => `${p.name}: hay tới ${start(p.fromH)}–${end(p.toH)} giờ sau trồng`
    + (p.dryMult > 1 ? `; đất Khô dễ bị gấp ${mult(p.dryMult)}` : "") + (p.wetMult > 1 ? `; đất Đẫm dễ bị gấp ${mult(p.wetMult)}` : "")
    + `. Xịt ${itemName(p.remedy)}.`);
  const rot = u.rotFromH === null ? [] : [
    `Từ ${start(u.rotFromH)} giờ sau trồng, đất Đẫm hay Ngập là úng, thối củ: mất ${pct(u.rotRate ?? 0)}% mỗi giờ `
      + `(tối đa ${pct(u.rotCap ?? 0)}%).`,
  ];
  return [
    {
      title: `Cách trồng ${lc(u.name)} (~${end(total)} giờ${n > 1 ? `, hái ${n} lứa` : ""})`,
      lines: [
        "1. Lên luống: đắp luống cao cho ráo nước; đất sẵn Ẩm.",
        "2. Bón lót: phân chuồng hoai và phân lân trước khi trồng. Thiếu mỗi loại mất 5%.",
        how, ...cares, water, harvest,
      ],
    },
    {
      title: "Sâu bệnh và lưu ý",
      lines: [
        ...pests, ...rot,
        "Bón đạm (urê, NPK) ngoài các đợt bón thúc, hoặc hai lần trong một đợt, là dư đạm: mất 10%, sâu bệnh dễ tới gấp rưỡi.",
        ...(UPLAND_TIPS[u.id] ? [UPLAND_TIPS[u.id]] : []),
      ],
    },
  ];
}

/** The Nông cụ tab (§14), verbatim. */
const TOOLS_PAGE: HandbookSection[] = [
  {
    title: "Liềm và gặt lúa",
    lines: [
      "Lúa chín phải gặt bằng liềm hoặc máy gặt, và phải rút nước (Khô–Ẩm) trước.",
      "Liềm (1.500 xu, mua một lần ở tiệm anh Hai). Ruộng lúa chia 6 phần; mỗi phần gặt bằng một lượt tay.",
      "Mỗi lượt có 8 bó: giữ cho lực liềm lên, thả khi vạch nằm trong vùng xanh. Chuẩn được 1 điểm, được nửa điểm, lệch 0 điểm. Từ 4 điểm trở lên là xong 1 phần; hụt thì thử lại ngay, không mất gì.",
      "Mỗi phần cho 1/6 sản lượng lúc cắt: lúa chín quá thì phần cắt sau ít hơn. Điểm cao không làm tăng sản lượng — chỉ cần đạt.",
      "Đang gặt dở thì chưa bón, tưới hay xịt được — gặt cho xong.",
    ],
  },
  {
    title: "Máy gặt",
    lines: [
      "Thuê ở Hợp tác xã (chú Tám): 500 xu mỗi phần còn lại, cả thửa 3.000 xu. Gặt hết trong 30 giây, không cần liềm, không huỷ được.",
      "Thuê được cả khi đã gặt tay dở. Ruộng thuê phải gặt xong trước khi hết hạn.",
    ],
  },
  {
    title: "Bình phun",
    lines: [
      "Bình phun (5.000 xu, mua một lần): nạp 1 chai thuốc được 3 lần xịt.",
      "Xịt đúng loại thuốc trong bình thì dùng bình; loại khác thì lấy chai trong giỏ.",
      "Nạp loại khác là đổ bỏ phần thuốc còn lại trong bình.",
    ],
  },
  { title: "Hoa màu", lines: ["Khoai, bắp, ớt không cần liềm: đào, bẻ, hái bằng tay trong 3 giây."] },
];

/** The hour marks of a season for one variety (hours after transplanting unless said). */
function timings(v: Variety): string {
  const s = v.scale;
  return `${v.name}: cấy khi mạ ${start(8 * s)}–${end(14 * s)} giờ tuổi · bón thúc ${start(2 * s)}–${end(10 * s)} giờ sau cấy · `
    + `phơi ruộng ${start(14 * s)}–${end(18 * s)} · đón đòng ${start(18 * s)}–${end(24 * s)} · rút nước từ ${start(40 * s)} · `
    + `chín ${start(48 * s)} giờ sau cấy (~${ripeAfterHours(v)} giờ từ lúc ngâm).`;
}

export function handbookPage(tab: HandbookTab, varieties: readonly Variety[], uplands: readonly UplandCrop[] = [],
  items: readonly FarmItem[] = []): HandbookSection[] {
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
            "11. Gặt: lúa chín và đã rút nước thì gặt bằng liềm hoặc thuê máy gặt. Ruộng chia 6 phần; mỗi lượt gặt tay có 8 bó — được từ 4 điểm trở lên (chuẩn 1, được nửa điểm, lệch 0) là xong 1 phần. Lúa chín quá vẫn mất 2% mỗi giờ tới lúc cắt từng phần; để 2 ngày thì rụng hết. Gặt xong phơi 3 giờ rồi bán cô Út.",
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
            "Hoa màu có sâu bệnh riêng — xem tab từng cây.",
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
          "Làm đất có hai cách: làm ruộng lúa hoặc lên luống trồng màu — xen vụ lúa với vụ màu cho đỡ nhàm.",
          "Nạp thuốc trừ sâu vào bình phun là lợi nhất: nó trị sâu cuốn lá, sùng khoai, sâu keo và bọ trĩ.",
        ],
      }];
    case "tools":
      return TOOLS_PAGE;
    default: {
      const u = uplands.find((x) => x.id === tab);
      return u ? uplandHandbook(u, items) : [];
    }
  }
}

/** The tab the plot panel links to: what matters on this crop now — the crop's tab for beds, Nông cụ for ripe or partly
 *  cut rice (§13.1). */
export function handbookTabFor(crop: CropView | null, v: Variety | null, now: number): HandbookTab {
  if (!crop) return "process";
  if (crop.kind === "upland") return crop.upland ?? "process";
  if (crop.pests.some((p) => p.treatedAt === null)) return "pests";
  const ph = cropPhase(cropModel(crop), v, now);
  if (ph === "ripe" || ph === "overripe" || crop.parts > 0) return "tools";
  return ph === "tillering" || ph === "panicle" ? "fertilizer" : "process";
}
