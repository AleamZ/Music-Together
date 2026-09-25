import type { PestKind, Phase } from "./state";

// The farm's Vietnamese texts (spec §8, §11.7, §13): names, durations, toasts and the RPC errors. Pure.

export const PHASE_NAME: Record<Phase, string> = {
  prepared: "Đã làm đất", soaking: "Đang ngâm ủ", sprouted: "Hạt nứt nanh", seedling: "Mạ non", tillering: "Đẻ nhánh",
  panicle: "Làm đòng", heading: "Trổ bông", ripening: "Vào chắc", ripe: "Chín", overripe: "Chín quá",
};

export const PEST_NAME: Record<PestKind, string> = {
  snail: "Ốc bươu vàng", leaf_folder: "Sâu cuốn lá", hopper: "Rầy nâu", leaf_blast: "Đạo ôn lá", neck_blast: "Đạo ôn cổ bông",
};

/** The spray that treats each pest; snails are picked by hand (§8.5). */
export const PEST_REMEDY: Record<PestKind, string | null> = {
  snail: null, leaf_folder: "spray_insect", hopper: "spray_hopper", leaf_blast: "spray_fungus", neck_blast: "spray_fungus",
};

export const WATER_NAME: readonly string[] = ["Khô", "Ẩm", "Nông", "Sâu"];

export const GIFT_TEXT = "🌾 Chú Tám tặng bạn 1 bao giống lúa ngắn ngày và 1 bao urê — xem Sổ tay nhà nông nhé!";
export const NOT_OPEN = "Đồng ruộng chưa mở — chủ phòng cần chạy migration 0013.";
export const FIELD_LOADING = "Đang tải đồng ruộng…";
export const FIELD_FAILED = "Chưa tải được đồng ruộng — thử lại nhé.";
export const FARM_LIMIT_TEXT = "Bạn đang canh tác 2 thửa rồi.";
export const NO_SEED = "Chưa có giống — ghé tiệm anh Hai.";

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

/** The HUD's rice line on the field: every variety together. */
export function riceSummary(rice: Record<string, { wet: number; dry: number }>): string {
  const all = Object.values(rice);
  const dry = all.reduce((a, r) => a + r.dry, 0), wet = all.reduce((a, r) => a + r.wet, 0);
  return dry + wet === 0 ? "🌾 Chưa có lúa" : `🌾 ${dry} kg khô · ${wet} kg ướt`;
}

export function boughtText(itemName: string, qty: number): string {
  return `🛒 Đã mua ${itemName}${qty > 1 ? ` × ${qty}` : ""}.`;
}

export function riceSaleText(kg: number, varietyName: string, dry: boolean, earned: number): string {
  return `💰 Bán ${kg} kg ${varietyName.toLowerCase()} ${dry ? "khô" : "ướt"} được ${earned.toLocaleString("vi-VN")} xu.`;
}

/** Vietnamese toast text for a farm RPC error (spec §11.7). `itemName` names the item a "no item" error is about. */
export function farmErrorMessage(err: unknown, itemName?: string): string {
  const e = (err && typeof err === "object" ? err : {}) as { message?: unknown };
  const msg = typeof e.message === "string" ? e.message : "";
  switch (msg) {
    case "not your plot": return "Thửa này không phải của bạn.";
    case "plot taken": return "Thửa này đã có người canh tác.";
    case "farm limit": return FARM_LIMIT_TEXT;
    case "already own land": return "Bạn đã có đất tư trong phòng này.";
    case "not for sale": return "Thửa này không rao bán.";
    case "price changed": return "Giá vừa đổi — xem lại nhé.";
    case "offer expired":
    case "offer not found": return "Đề nghị không còn nữa.";
    case "buyer cannot buy": return "Người mua không còn đủ điều kiện (xu hoặc đất).";
    case "crop exists": return "Đang có lúa trên thửa — gặt hoặc bỏ vụ trước.";
    case "leased": return "Thửa đang cho thuê.";
    case "wrong phase": return "Chưa tới lúc làm việc này.";
    case "not prepared": return "Làm đất trước đã.";
    case "need water": return "Mực nước chưa đúng — xem Sổ tay.";
    case "no item": return `Chưa có ${itemName ?? "món này"} — ghé tiệm anh Hai.`;
    case "no snails": return "Không có ốc để bắt.";
    case "no crop": return "Thửa đang trống.";
    case "drying full": return "Sân phơi đã đầy.";
    case "not ready": return "Chưa xong.";
    case "not enough rice": return "Không đủ lúa.";
    case "not enough coins": return "Không đủ xu.";
    case "item not available": return "Món này không mua được.";
    case "invalid quantity":
    case "invalid price": return "Số không hợp lệ.";
    case "too fast": return "Từ từ thôi…";
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
