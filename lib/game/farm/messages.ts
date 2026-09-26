import { durationVi, lockSeconds, lockText } from "@/lib/anticheat";
import { COAT_NAME, type DogCoat, type DogNameProblem, type DogStatus } from "../dog";
import { AMMO_PELLET, TOOL_SLING, type CritterKind, type UplandCrop } from "./catalog";
import { GATHER, lowerFirst } from "./gather";
import { RAT, type RatRecent } from "./rats";
import type { CatchAnswer } from "./rpc";
import type { PestKind, Phase } from "./state";

// The farm's Vietnamese texts (spec §8, §11.7, §13; v15.2 §11.7, §13; v15.3 §11.8, §13; v17 §10.6, §12): names,
// durations, toasts and the RPC errors. Pure.

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
/** A v15.3 gathering action against a database without 0018 (R23). */
export const NOT_OPEN_153 = "Bắt cua, mò ốc chưa mở — chủ phòng cần chạy migration 0018.";
/** A v17 action (the ná, the dog, the rat sale) against a database without 0019 (v17 §10.6). */
export const NOT_OPEN_17 = "Mùa chuột chưa mở — chủ phòng cần chạy migration 0019.";
export const FIELD_LOADING = "Đang tải đồng ruộng…";
export const FIELD_FAILED = "Chưa tải được đồng ruộng — thử lại nhé.";
export const FARM_LIMIT_TEXT = "Bạn đang canh tác 2 thửa rồi.";
export const NO_SEED = "Chưa có giống — ghé tiệm anh Hai.";
export const TOO_FAST = "Từ từ thôi…";
/** A harvest round past the server's window (`work expired`), or one left idle until then (v15.2 R6). */
export const WORK_EXPIRED = "Lượt gặt đã quá lâu — bắt đầu lại nhé.";
/** Too little left on the lease for a harvest round (`lease ending`, v15.2 R11). */
export const LEASE_ENDING = "Sắp hết hạn thuê — không kịp gặt phần này.";
/** The same two for a transplant round (v15.3 §11.8): one past the window or left idle, and too little lease left. */
export const WORK_EXPIRED_TP = "Lượt cấy đã quá lâu — bắt đầu lại nhé.";
export const LEASE_ENDING_TP = "Sắp hết hạn thuê — không kịp cấy.";
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

/** A won transplant round (v15.3 §13.3): the rice transplanted, or the ớt seedlings set out. */
export function transplantDoneText(plot: number, ot: boolean): string {
  return ot ? `✅ Trồng xong cây ớt con thửa ${plot}.` : `✅ Cấy xong thửa ${plot} — giữ nước Nông, bón thúc đúng lúc nhé!`;
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

/** The HUD's line (§13.6; v15.3 §13.4): the rice, then the hoa màu and the critters held when there are any. */
export function produceSummary(rice: Record<string, { wet: number; dry: number }>, produce: Record<string, number>, critters = 0): string {
  const kg = Object.values(produce).reduce((a, x) => a + x, 0);
  return `${riceSummary(rice)}${kg > 0 ? ` · 🧺 ${kg} kg màu` : ""}${critters > 0 ? ` · 🦀 ${critters}` : ""}`;
}

const COOL_MIN = GATHER.cooldownMs / 60_000;
/** A container mid-sentence, or the hands: "xô nhựa", "tay". */
const boxWord = (boxName: string | null): string => (boxName ? lowerFirst(boxName) : "tay");
/** The critters of a catch by kind, in the catalog's order: "2 cua đồng, 1 cua gạch". */
function kindsText(caught: CatchAnswer["caught"], kinds: readonly CritterKind[]): string {
  const counts = new Map<string, number>();
  for (const c of caught) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
  const order = (k: string) => kinds.findIndex((x) => x.id === k);
  return [...counts].sort(([a], [b]) => order(a) - order(b))
    .map(([k, n]) => `${n} ${lowerFirst(kinds.find((x) => x.id === k)?.name ?? k)}`).join(", ");
}

/** The v15.3 refusals (§11.8). */
export const GATHER_LIMIT_TEXT = `Hôm nay bạn bắt cua, mò ốc đủ ${GATHER.dailyVisits} lượt rồi — mai quay lại nhé!`;
export function crittersFullText(boxName: string | null): string {
  return boxName ? `${boxName} đầy rồi — ra vựa cô Út bán bớt nhé.` : "Tay đầy rồi — ra vựa cô Út bán hoặc sắm xô ở tiệm anh Hai.";
}
/** A cooling hole or bed: the minutes left, or "ít phút" when the answer has none. */
export function holeEmptyText(ms: number | null): string {
  return `Cua chưa ra — quay lại sau ${ms === null ? "ít phút" : durationText(ms)}.`;
}
export function bedEmptyText(ms: number | null): string {
  return `Bãi này vừa mò rồi — quay lại sau ${ms === null ? "ít phút" : durationText(ms)}.`;
}

/** Dừng before the first try ends (R8): nothing is sent, and the hole keeps its cooldown. */
export const CRAB_GAVE_UP = `Đã rút tay — hang này ${COOL_MIN} phút nữa mới có cua lại.`;

/** CrabGame's result (§13.2). */
export function crabResultText(crab: CatchAnswer & { hits: number }, kinds: readonly CritterKind[], boxName: string | null): string {
  const n = crab.caught.length, lost = crab.escaped > 0 ? `${crab.escaped} con chạy mất vì ${boxWord(boxName)} đầy.` : "";
  if (n > 0) return `🦀 Bắt được ${n} con: ${kindsText(crab.caught, kinds)}!${lost ? ` ${lost}` : ""}`;
  return lost ? `🦀 ${lost}` : `🦀 Cua chui hết vào hang rồi — ${COOL_MIN} phút nữa quay lại nhé.`;
}

/** A snail bed's toast (§13.4). */
export function bedResultText(snails: CatchAnswer, kinds: readonly CritterKind[], boxName: string | null): string {
  const n = snails.caught.length, back = snails.escaped > 0 ? `Thả lại ${snails.escaped} con vì ${boxWord(boxName)} đầy.` : "";
  if (n === 0) return `🐌 ${back}`;
  return `🐌 Mò được ${n} con ốc: ${kindsText(snails.caught, kinds)}.${back ? ` ${back}` : ""}`;
}

/** pick_snails' toast (§13.4): the picker's ốc bươu vàng; an answer without snails (before 0018) keeps v15.2's text. */
export function pestSnailText(plot: number, snails: CatchAnswer | null, boxName: string | null): string {
  if (!snails) return "Đã bắt ốc bươu vàng.";
  const n = snails.caught.length, e = snails.escaped;
  if (e === 0) return `🐌 Bắt ốc thửa ${plot}: được ${n} con ốc bươu vàng.`;
  if (n > 0) return `🐌 Bắt ốc thửa ${plot}: được ${n} con, thả ${e} con xuống mương vì ${boxWord(boxName)} đầy.`;
  return `🐌 Bắt ốc thửa ${plot} — ${boxWord(boxName)} đầy, thả ${e} con xuống mương.`;
}

/** cô Út's toast for sell_critters (§13.4), from its `sold`. */
export function critterSaleText(n: number, xu: number): string {
  return `💰 Bán ${n} con cua ốc được ${xu.toLocaleString("vi-VN")} xu.`;
}

export function boughtText(itemName: string, qty: number): string {
  return `🛒 Đã mua ${itemName}${qty > 1 ? ` × ${qty}` : ""}.`;
}

export function riceSaleText(kg: number, varietyName: string, dry: boolean, earned: number): string {
  return `💰 Bán ${kg} kg ${varietyName.toLowerCase()} ${dry ? "khô" : "ướt"} được ${earned.toLocaleString("vi-VN")} xu.`;
}

// v17 (§10.6, §12): the rats, the ná and the dog.

/** No pellets (§10.6), which also ends a SlingGame (§12.2). */
export const NO_PELLETS = "Hết đạn đất — mua ở tiệm anh Hai.";
export const RAT_DAILY_LIMIT_TEXT = `Hôm nay bạn bắt đủ ${RAT.dayCap} con chuột rồi — mai nhé!`;
/** A catch cap's wait, or a resting dog's, from the refusal's seconds; "ít phút" when the answer has none. */
export function ratLimitText(sec: number | null): string {
  return `Bạn bắt đủ ${RAT.hourCap} con chuột trong giờ này rồi — nghỉ ${sec === null ? "ít phút" : durationVi(sec)} nhé.`;
}
export function dogRestingText(sec: number | null): string {
  return `Chó đang nghỉ — ${sec === null ? "ít phút" : durationVi(sec)} nữa mới vồ tiếp.`;
}

/** What stops a shot before the server would (§12.1), as its refusal: no ná, then no pellet; null with both. */
export function slingGear(items: Readonly<Record<string, number>>): "no sling" | "no pellets" | null {
  if ((items[TOOL_SLING] ?? 0) < 1) return "no sling";
  return (items[AMMO_PELLET] ?? 0) < 1 ? "no pellets" : null;
}
/** A rat's field prompt (§12.1), after the shell's "E · ". */
export function ratPrompt(gear: "no sling" | "no pellets" | null): string {
  return gear === "no sling" ? "Chuột đồng (cần ná)" : gear === "no pellets" ? "Chuột đồng (hết đạn)" : "Bắn chuột";
}

/** The toasts (§12.1): a rat out on my plot (once per rat), my dog's catch, and cô Út's for sell_rats. */
export function ratSpawnText(plot: number): string {
  return `🐀 Chuột mò ra phá thửa ${plot} của bạn!`;
}
export function dogCatchText(dog: string): string {
  return `🐕 ${dog} vồ được một con chuột! Đem bán cho cô Út nhé.`;
}
export function ratSaleText(n: number, xu: number): string {
  return `💰 Bán ${n} con chuột được ${xu.toLocaleString("vi-VN")} xu.`;
}

/** The field chip (§12.1) while rats are live: its text and its aria-label. */
export function ratChipText(n: number): string {
  return `🐀 Mùa chuột · ${n} con`;
}
export function ratChipLabel(n: number): string {
  return `Mùa chuột: ${n} con chuột đang phá đồng — mở Sổ tay`;
}

/** The plot panel's line (§12.1) on a plot with a rat log: the rats on it now and the share lost so far. */
export function ratPlotText(live: number, lostPct: number): string {
  return `🐀 ${live} con chuột đang ăn · đã mất ${lostPct < 1 ? "dưới 1%" : `~${Math.round(lostPct)}%`} (tối đa 10%)`;
}

/** The SlingGame overlay (§12.2); the misses are sling.ts's SLING_MISS. */
export function slingTitle(plot: number): string {
  return `🎯 Bắn chuột · thửa ${plot}`;
}
export const SLING_HELP = "Rê chuột hoặc bấm ←/→ để ngắm. Giữ Space (hoặc giữ chuột, giữ ngón tay) cho dây căng tới vùng xanh rồi thả.";
export const SLING_CANCEL = "Thôi (Esc)";
export function slingStatus(pellets: number, reloading: boolean): string {
  return `Đạn: ${pellets} viên${reloading ? " · Nạp đạn…" : ""}`;
}
export function slingHitText(price: number): string {
  return `🎯 Trúng! Bắt được chuột đồng — ${price.toLocaleString("vi-VN")} xu, đem bán ở vựa cô Út.`;
}
/** `rat gone` (§10.6): the SlingGame then names who took it, from the state's `recent` (ratGoneText). */
export const RAT_GONE = "Con chuột này không còn nữa.";
/** Why the rat is gone (§12.2), from its `recent` entry when there is one: a sling, a dog, or back to its hole. */
export function ratGoneText(r: RatRecent | null): string {
  if (r?.how === "sling" && r.by) return `Chuột bị ${r.by.name} bắt mất rồi!`;
  if (r?.how === "dog" && r.by) return `Chuột bị ${r.dog ?? "chó"} của ${r.by.name} vồ mất rồi!`;
  return "Chuột chạy về hang rồi.";
}

// The dog (§12.3): the HUD, DogPanel and the CoopPanel's tab.

/** The HUD's button: the name, with "!" while hungry. */
export function dogHudText(name: string, hungry: boolean): string {
  return `🐕 ${name}${hungry ? " !" : ""}`;
}
/** DogPanel's lines: the coat and the adoption day (Vietnam time), food, hunting and catches. */
export function dogCoatLine(coat: DogCoat, adoptedAt: number): string {
  const d = new Date(adoptedAt + 7 * 3_600_000);
  return `Chó cỏ lông ${COAT_NAME[coat].toLowerCase()} · nuôi từ ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}
export function dogFoodLine(s: DogStatus): string {
  if (!s.fed) return "🍖 Đói — cho ăn để nó đi săn";
  const h = Math.floor(s.foodLeftMs / 3_600_000);
  return `🍖 No — còn ${h >= 1 ? `${h} giờ` : durationVi(Math.ceil(s.foodLeftMs / 1000))}`;
}
export function dogHuntLine(s: DogStatus): string {
  if (s.hunt === "hungry") return "🐀 Đói nên không săn";
  if (s.hunt === "ready") return "🐀 Sẵn sàng — ra đồng, đứng gần chuột là nó vồ";
  const sec = Math.ceil(s.restLeftMs / 1000);
  return `🐀 Nghỉ — vồ tiếp sau ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}
export function dogCatchesLine(n: number): string {
  return `🏅 Đã bắt ${n} con chuột`;
}
export function dogFeedButton(food: number): string {
  return `🦴 Cho ăn (${food} bịch)`;
}
/** Why "Cho ăn" is disabled (feedRefusal). */
export const DOG_FEED_REFUSAL: Record<"full" | "no_food", string> = {
  full: "Còn no hơn 12 giờ — chưa ăn thêm được.",
  no_food: "Hết thức ăn chó — mua ở tiệm anh Hai.",
};
/** The name field's hint: the rule, or what dogNameRefusal finds. */
export const DOG_NAME_HINT = "2–16 ký tự";
export const DOG_NAME_PROBLEM: Record<DogNameProblem, string> = {
  length: "Tên cần 2–16 ký tự.",
  hidden: "Tên có ký tự ẩn — gõ lại nhé.",
  reserved: "Tên này dành riêng — chọn tên khác nhé.",
};
export function dogFedText(name: string): string {
  return `🦴 ${name} ăn ngon lành — no 24 giờ.`;
}
export function dogRenamedText(name: string): string {
  return `\u270f\ufe0f Đã đổi tên thành ${name}.`;
}
export const ADOPT_INTRO =
  "“Chó cỏ nhà chú mới đẻ một bầy, con nào cũng khôn. 20.000 xu con mang về nuôi — nhớ cho ăn mỗi ngày, mùa lúa chín nó bắt chuột giỏi lắm!”";
export const ADOPT_BUTTON = "Nhận nuôi · 20.000 xu";
export function adoptConfirmText(name: string, coat: DogCoat): string {
  return `Nhận nuôi ${name} (lông ${COAT_NAME[coat].toLowerCase()}) với giá 20.000 xu? Mỗi người chỉ nuôi một con.`;
}
export function dogOwnedText(name: string): string {
  return `Bạn đã nuôi ${name} rồi — mỗi người một con thôi.`;
}
export function dogWelcomeText(name: string): string {
  return `🐕 Chào mừng ${name} về nhà! Nó sẽ theo bạn khắp nơi.`;
}

/** The seconds an error's details carry (hole empty, bed empty, rat limit, dog resting), as ms; null without them. */
function detailMs(err: unknown): number | null {
  const d = (err && typeof err === "object" ? err : {}) as { details?: unknown };
  return typeof d.details === "string" && /^\d+$/.test(d.details) ? Number(d.details) * 1000 : null;
}
const detailSec = (err: unknown): number | null => {
  const ms = detailMs(err);
  return ms === null ? null : ms / 1000;
};

/** Vietnamese toast text for a farm RPC error (spec §11.7, v15.2 §11.7, v15.3 §11.8, v17 §10.6; the dog calls share
 *  it). `itemName` names the item a "no item" error is about, or the container a "critters full" one is; `action`
 *  reads a round's refusals in its context: "harvest_part" (HarvestGame), "crab_finish" (CrabGame), "transplant"
 *  (TransplantGame) or "sling" (SlingGame). */
export function farmErrorMessage(err: unknown, itemName?: string, action?: string): string {
  const e = (err && typeof err === "object" ? err : {}) as { message?: unknown };
  const msg = typeof e.message === "string" ? e.message : "";
  const round = action === "harvest_part", crab = action === "crab_finish", tp = action === "transplant";
  switch (msg) {
    case "not your plot":
      return round ? "Hết hạn thuê — phần lúa chưa gặt đã mất." : tp ? "Hết hạn thuê — mạ trên thửa đã mất." : "Thửa này không phải của bạn.";
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
    case "too fast":
      return round ? "Chưa xong bó lúa — thử lại sau vài giây." : crab ? "Chưa bắt xong — thử lại sau vài giây."
        : tp ? "Chưa cấy xong hàng mạ — thử lại sau vài giây." : action === "sling" ? "Đang nạp đạn…" : TOO_FAST;
    case "no sickle": return "Chưa có liềm — mua ở tiệm anh Hai (hoặc thuê máy gặt ở Hợp tác xã).";
    case "no sprayer": return "Chưa có bình phun — mua ở tiệm anh Hai.";
    case "harvesting": return "Đang gặt dở — gặt cho xong đã.";
    case "harvester busy": return "Máy gặt đang gặt thửa này.";
    case "work expired": return tp ? WORK_EXPIRED_TP : WORK_EXPIRED;
    case "lease ending": return tp ? LEASE_ENDING_TP : LEASE_ENDING;
    case "lease ends": return "Không kịp gặt xong trước khi hết hạn thuê.";
    case "wrong crop": return "Việc này không hợp với cây trên thửa.";
    case "already owned": return "Bạn đã có món này rồi.";
    case "not enough crop": return "Không đủ hàng để bán.";
    case "hole empty": return holeEmptyText(detailMs(err));
    case "bed empty": return bedEmptyText(detailMs(err));
    case "critters full": return crittersFullText(itemName ?? null);
    case "gather daily limit": return GATHER_LIMIT_TEXT;
    case "visit not found": return "Lượt bắt cua này đã xong.";
    case "visit expired": return "Lâu quá, cua chui mất rồi — lát nữa quay lại nhé.";
    case "no critters": return "Không có cua ốc để bán.";
    case "no sling": return "Chưa có ná — mua ở tiệm anh Hai.";
    case "no pellets": return NO_PELLETS;
    case "rat gone": return RAT_GONE;
    case "rat limit": return ratLimitText(detailSec(err));
    case "rat daily limit": return RAT_DAILY_LIMIT_TEXT;
    case "no aim": return "Ná chưa giương — thử lại nhé.";
    case "aim expired": return "Giương ná lâu quá — ngắm lại nhé.";
    case "no dog": return "Bạn chưa nuôi chó.";
    case "dog hungry": return "Chó đói rồi — cho ăn trước đã.";
    case "dog resting": return dogRestingText(detailSec(err));
    case "dog full": return "Chó còn no — chưa ăn thêm được.";
    case "already own dog": return "Bạn đã nuôi một con rồi — mỗi người một con thôi.";
    case "invalid name": return "Tên chó cần 2–16 ký tự, không dùng tên dành riêng (Ao cá, Hợp tác xã…) hoặc ký tự ẩn.";
    case "nothing to sell": return "Chưa có con chuột nào để bán.";
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
