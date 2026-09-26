import { lockSeconds, lockText } from "@/lib/anticheat";
import type { UplandCrop } from "./catalog";
import type { PestKind, Phase } from "./state";

// The farm's Vietnamese texts (spec §8, §11.7, §13; v15.2 §11.7, §13): names, durations, toasts and the RPC errors.
// Pure.

export const PHASE_NAME: Record<Phase, string> = {
  prepared: "Đã làm đất", soaking: "Đang ngâm ủ", sprouted: "Hạt nứt nanh", seedling: "Mạ non", tillering: "Đẻ nhánh",
  panicle: "Làm đòng", heading: "Trổ bông", ripening: "Vào chắc", ripe: "Chín", overripe: "Chín quá",
};

export const PEST_NAME: Record<PestKind, string> = {
  snail: "Ốc bươu vàng", leaf_folder: "Sâu cuốn lá", hopper: "Rầy nâu", leaf_blast: "Đạo ôn lá", neck_blast: "Đạo ôn cổ bông",
  weevil: "Sùng khoai", armyworm: "Sâu keo mùa thu", thrips: "Bọ trĩ", anthracnose: "Thán thư",
};

/** The spray that treats each pest; snails are picked by hand (§8.5). The hoa-màu ones are the config's remedies. */
export const PEST_REMEDY: Record<PestKind, string | null> = {
  snail: null, leaf_folder: "spray_insect", hopper: "spray_hopper", leaf_blast: "spray_fungus", neck_blast: "spray_fungus",
  weevil: "spray_insect", armyworm: "spray_insect", thrips: "spray_insect", anthracnose: "spray_fungus",
};

export const WATER_NAME: readonly string[] = ["Khô", "Ẩm", "Nông", "Sâu"];
/** The same four levels on raised beds (v15.2 R22). */
export const BED_WATER_NAME: readonly string[] = ["Khô", "Ẩm", "Đẫm", "Ngập"];

/** A run of levels on beds: [1] → "Ẩm", [0, 1] → "Khô–Ẩm". */
export function bedLevelsText(levels: readonly number[]): string {
  if (levels.length === 0) return "";
  const lo = Math.min(...levels), hi = Math.max(...levels);
  return lo === hi ? BED_WATER_NAME[lo] : `${BED_WATER_NAME[lo]}–${BED_WATER_NAME[hi]}`;
}

/** The phases of a crop on beds (v15.2 §13.1); a stage is named by the crop's config. */
const UP_PHASE_NAME: Record<string, string> = {
  prepared: "Đã lên luống", nursery: "Đang ươm cây con", waiting: "Chờ lứa sau", ripe: "Chín", overripe: "Chín quá", done: "Hết lứa",
};
export function uplandPhaseName(u: UplandCrop | null, phase: string): string {
  return UP_PHASE_NAME[phase] ?? u?.stages.find((s) => s.id === phase)?.name ?? phase;
}

export const GIFT_TEXT = "🌾 Chú Tám tặng bạn 1 bao giống lúa ngắn ngày, 1 bao urê và 1 cây liềm — xem Sổ tay nhà nông nhé!";
export const NOT_OPEN = "Đồng ruộng chưa mở — chủ phòng cần chạy migration 0013.";
/** A v15.2 action against a database without 0016 (R28). */
export const NOT_OPEN_152 = "Nông cụ và hoa màu chưa mở — chủ phòng cần chạy migration 0016.";
export const FIELD_LOADING = "Đang tải đồng ruộng…";
export const FIELD_FAILED = "Chưa tải được đồng ruộng — thử lại nhé.";
export const FARM_LIMIT_TEXT = "Bạn đang canh tác 2 thửa rồi.";
export const NO_SEED = "Chưa có giống — ghé tiệm anh Hai.";
export const TOO_FAST = "Từ từ thôi…";
/** A harvest round past the server's window (`work expired`), or one left idle until then (v15.2 R6). */
export const WORK_EXPIRED = "Lượt gặt đã quá lâu — bắt đầu lại nhé.";
export const DRYING_LIMIT_TEXT = "Bạn đang phơi 2 mẻ rồi — thu lúa trước nhé.";

/** "45 phút", "3 giờ", "2 ngày 5 giờ" — rounded up, as a countdown reads. */
export function durationText(ms: number): string {
  if (ms <= 60_000) return "1 phút";
  const min = Math.ceil(ms / 60_000);
  if (min < 60) return `${min} phút`;
  const h = Math.ceil(ms / 3_600_000);
  if (h < 48) return `${h} giờ`;
  return `${Math.floor(h / 24)} ngày${h % 24 ? ` ${h % 24} giờ` : ""}`;
}

export function harvestText(kg: number, varietyName: string): string {
  return `🌾 Gặt được ${kg} kg ${varietyName.toLowerCase()} (lúa ướt) — đem phơi rồi bán cho cô Út nhé!`;
}

/** A won round's part (§13.2), and the sixth part's whole harvest. */
export function partText(k: number, kg: number): string {
  return `✅ Xong phần ${k}/6: ${kg} kg lúa.`;
}
export function partsDoneText(plot: number, total: number, varietyName: string): string {
  return `🌾 Gặt xong thửa ${plot}: tổng ${total} kg ${varietyName.toLowerCase()} (lúa ướt) — đem phơi rồi bán cho cô Út nhé!`;
}

/** The harvester's toasts (§13.4): at the rent, and at its end with the wet stock it brought (R15). */
export function harvesterStartText(plot: number): string {
  return `🚜 Máy gặt đang vào thửa ${plot} — 30 giây nữa xong.`;
}
export function harvesterDoneText(plot: number, kg: number, varietyName: string): string {
  return `🚜 Máy gặt gặt xong thửa ${plot}: ${kg} kg ${varietyName.toLowerCase()} (lúa ướt).`;
}

/** A picking (§13.6); "(lứa k/n)" only for a crop picked more than once. */
export function pickingText(kg: number, cropName: string, k: number, n: number): string {
  return `🧺 Thu hoạch ${kg} kg ${cropName.toLowerCase()}${n > 1 ? ` (lứa ${k}/${n})` : ""} — đem bán cho cô Út nhé!`;
}

export function produceSaleText(kg: number, cropName: string, earned: number): string {
  return `💰 Bán ${kg} kg ${cropName.toLowerCase()} được ${earned.toLocaleString("vi-VN")} xu.`;
}

/** Nạp thuốc (§13.5). */
export function loadedText(itemName: string): string {
  return `🧴 Đã nạp ${itemName.charAt(0).toLowerCase()}${itemName.slice(1)} vào bình phun — 3 lần xịt.`;
}

/** The HUD's rice line on the field: every variety together. */
export function riceSummary(rice: Record<string, { wet: number; dry: number }>): string {
  const all = Object.values(rice);
  const dry = all.reduce((a, r) => a + r.dry, 0), wet = all.reduce((a, r) => a + r.wet, 0);
  return dry + wet === 0 ? "🌾 Chưa có lúa" : `🌾 ${dry} kg khô · ${wet} kg ướt`;
}

/** The HUD's line (§13.6): the rice, then the hoa màu when there is any. */
export function produceSummary(rice: Record<string, { wet: number; dry: number }>, produce: Record<string, number>): string {
  const kg = Object.values(produce).reduce((a, x) => a + x, 0);
  return kg > 0 ? `${riceSummary(rice)} · 🧺 ${kg} kg màu` : riceSummary(rice);
}

export function boughtText(itemName: string, qty: number): string {
  return `🛒 Đã mua ${itemName}${qty > 1 ? ` × ${qty}` : ""}.`;
}

export function riceSaleText(kg: number, varietyName: string, dry: boolean, earned: number): string {
  return `💰 Bán ${kg} kg ${varietyName.toLowerCase()} ${dry ? "khô" : "ướt"} được ${earned.toLocaleString("vi-VN")} xu.`;
}

/** Vietnamese toast text for a farm RPC error (spec §11.7, v15.2 §11.7). `itemName` names the item a "no item" error is
 *  about; `action` = "harvest_part" reads a harvest round's refusals (the HarvestGame overlay). */
export function farmErrorMessage(err: unknown, itemName?: string, action?: string): string {
  const e = (err && typeof err === "object" ? err : {}) as { message?: unknown };
  const msg = typeof e.message === "string" ? e.message : "";
  const round = action === "harvest_part";
  switch (msg) {
    case "not your plot": return round ? "Hết hạn thuê — phần lúa chưa gặt đã mất." : "Thửa này không phải của bạn.";
    case "plot taken": return "Thửa này đã có người canh tác.";
    case "farm limit": return FARM_LIMIT_TEXT;
    case "already own land": return "Bạn đã có đất tư trong phòng này.";
    case "not for sale": return "Thửa này không rao bán.";
    case "price changed": return "Giá vừa đổi — xem lại nhé.";
    case "offer expired":
    case "offer not found": return "Đề nghị không còn nữa.";
    case "buyer cannot buy": return "Người mua không còn đủ điều kiện (xu hoặc đất).";
    case "crop exists": return "Đang có vụ trên thửa — thu hoạch hoặc bỏ vụ trước.";
    case "leased": return "Thửa đang cho thuê.";
    case "wrong phase": return "Chưa tới lúc làm việc này.";
    case "not prepared": return "Làm đất trước đã.";
    case "need water": return "Mực nước chưa đúng — xem Sổ tay.";
    case "no item": return `Chưa có ${itemName ?? "món này"} — ghé tiệm anh Hai.`;
    case "no snails": return "Không có ốc để bắt.";
    case "no crop": return "Thửa đang trống.";
    case "drying full": return "Sân phơi đã đầy.";
    case "drying limit": return DRYING_LIMIT_TEXT;
    case "not ready": return "Chưa xong.";
    case "not enough rice": return "Không đủ lúa.";
    case "not enough coins": return "Không đủ xu.";
    case "item not available": return "Món này không mua được.";
    case "invalid quantity":
    case "invalid price": return "Số không hợp lệ.";
    case "too fast": return round ? "Chưa xong bó lúa — thử lại sau vài giây." : TOO_FAST;
    case "no sickle": return "Chưa có liềm — mua ở tiệm anh Hai (hoặc thuê máy gặt ở Hợp tác xã).";
    case "no sprayer": return "Chưa có bình phun — mua ở tiệm anh Hai.";
    case "harvesting": return "Đang gặt dở — gặt cho xong đã.";
    case "harvester busy": return "Máy gặt đang gặt thửa này.";
    case "work expired": return WORK_EXPIRED;
    case "lease ending": return "Sắp hết hạn thuê — không kịp gặt phần này.";
    case "lease ends": return "Không kịp gặt xong trước khi hết hạn thuê.";
    case "wrong crop": return "Việc này không hợp với cây trên thửa.";
    case "already owned": return "Bạn đã có món này rồi.";
    case "not enough crop": return "Không đủ hàng để bán.";
    case "account locked": return lockText(lockSeconds(err) ?? 300);
  }
  if (msg.includes("invalid session")) return "Phiên đăng nhập đã hết hạn — hãy đăng nhập lại.";
  if (msg.includes("account banned")) return "Tài khoản đã bị khoá.";
  if (msg.includes("not a member")) return "Bạn không còn ở trong phòng này.";
  return "Có lỗi, thử lại nhé.";
}

/** The database has no v15 functions yet (0013 not run): PostgREST cannot find the RPC. */
export function isMissingRpc(err: unknown): boolean {
  const e = (err && typeof err === "object" ? err : {}) as { code?: unknown; message?: unknown };
  return e.code === "PGRST202" || e.code === "42883" || (typeof e.message === "string" && e.message.includes("schema cache"));
}
