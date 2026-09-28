import type { CropStage } from "@/lib/game/art/crops";
import { FARM_ANIM, type FarmAnim } from "@/lib/game/net/protocol";
import type { HandbookSection, HandbookTab } from "./handbook";
import type { PestKind } from "./state";

// The picture view of the Sổ tay (📖 → 🖼️ Hình): one card per line of the text view, so the two never drift. Each card
// takes its caption and its number chips from the line itself and picks a little scene (a plot, the farmer doing the
// action, an item icon) by the line's words. Pure; lib/game/art/handbook-art.ts draws the scenes.

export interface StepScene {
  /** The plot behind: "rice", a hoa-màu crop's id, or null for plain ground. */
  plot: { crop: string; stage: CropStage; water: number; pests: PestKind[] } | null;
  /** The farm animation the farmer plays (FARM_ANIM.stop = standing). */
  anim: FarmAnim;
  who: "farmer" | "coUt";
  /** Up to two item icons (farm-icons ids). */
  icons: string[];
  extra: "rat" | "dog" | "harvester" | "sun" | null;
}

export interface StepCard {
  /** The step's number: the line's own "N." or its place in the section. */
  n: number;
  caption: string;
  chips: string[];
  scene: StepScene;
}

export interface CardSection { title: string; flow: boolean; cards: StepCard[] }

const MAX_WORDS = 8;

/** A 3–8 word caption from the line: the part before its first ":" when short enough, else its first clause. */
export function stepCaption(line: string): string {
  const body = line.replace(/^\d+\.\s*/, "").trim();
  const colon = body.indexOf(":");
  const head = colon > 0 ? body.slice(0, colon) : body.split(/[.;,—(]/)[0];
  const words = head.trim().split(/\s+/).filter(Boolean);
  return words.length <= MAX_WORDS ? words.join(" ") : `${words.slice(0, MAX_WORDS).join(" ")}…`;
}

/** The line's key numbers as chips: time windows, hours, penalties ("mất 10%" → "−10%"), prices, counts. At most 3. */
export function stepChips(line: string): string[] {
  const out: string[] = [];
  const re = /(mất |tối đa )?(\d[\d.,]*(?:–\d[\d.,]*)?)\s?(%|giờ|phút|giây|xu|kg|con|viên|bó|khóm|cây|phần)(?![\p{L}])/gu;
  for (const m of line.matchAll(re)) {
    const [, pre, num, unit] = m;
    const chip = unit === "%" ? `${pre === "mất " ? "−" : pre === "tối đa " ? "≤" : ""}${num}%` : `${num} ${unit}`;
    if (!out.includes(chip)) out.push(chip);
    if (out.length === 3) break;
  }
  return out;
}

const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole words only ("ốc" is not in "thuốc"). */
const has = (s: string, ...ws: string[]) => ws.some((w) => new RegExp(`(?<![\\p{L}])${esc(w)}(?![\\p{L}])`, "u").test(s));

function waterOf(s: string, fallback: number): number {
  if (has(s, "ngập", "sâu)", "mực sâu", "nông–sâu", "sâu là")) return 3;
  if (has(s, "đẫm", "nước nông", "nông")) return 2;
  if (has(s, "khô", "cạn", "rút nước", "ráo", "tháo")) return 0;
  if (has(s, "ẩm")) return 1;
  return fallback;
}

function riceStage(s: string): CropStage {
  if (has(s, "chín", "gặt", "chuột", "vào chắc", "rút nước")) return "ripe";
  if (has(s, "trổ", "cổ bông")) return "heading";
  if (has(s, "đòng")) return "panicle";
  if (has(s, "đẻ nhánh", "thúc", "phơi ruộng", "urê", "đạm")) return "tillering";
  if (has(s, "cấy", "khóm")) return "transplanted";
  if (has(s, "mạ", "gieo", "nứt nanh", "ngâm")) return "seedbed";
  if (has(s, "làm đất", "cày", "bón lót", "lót")) return "prepared";
  return "tillering";
}

function uplandStage(s: string): CropStage {
  if (has(s, "chín", "hái", "bẻ", "đào", "thu hoạch", "lứa")) return "ripe";
  if (has(s, "lên luống", "bón lót")) return "beds";
  if (has(s, "ươm", "góc luống")) return "nursery";
  if (has(s, "trồng", "cấy", "gieo", "đặt hom", "hom")) return "g0";
  if (has(s, "sâu", "sùng", "bọ", "rệp", "thối", "úng")) return "g2";
  return "g1";
}

const PESTS: ReadonlyArray<[string, PestKind]> = [
  ["ốc bươu", "snail"], ["cuốn lá", "leaf_folder"], ["rầy", "hopper"], ["đạo ôn lá", "leaf_blast"], ["cổ bông", "neck_blast"],
  ["sùng", "weevil"], ["sâu keo", "armyworm"], ["bọ trĩ", "thrips"], ["thán thư", "anthracnose"],
];

function fertIcon(s: string): string {
  if (has(s, "npk")) return "fert_npk";
  if (has(s, "kali")) return "fert_potash";
  if (has(s, "urê", "đạm")) return "fert_urea";
  if (has(s, "lân")) return "fert_phosphate";
  return has(s, "chuồng", "lót") ? "fert_manure" : "fert_npk";
}

function sprayIcon(s: string): string {
  if (has(s, "rầy")) return "spray_hopper";
  if (has(s, "bệnh", "đạo ôn", "thán thư")) return "spray_fungus";
  return "spray_insect";
}

/** The scene for one line of tab `tab`; `upland` = the tab is a hoa-màu crop's. */
export function stepScene(line: string, tab: HandbookTab, upland: boolean): StepScene {
  const s = line.toLowerCase();
  const crop = upland ? tab : "rice";
  const pests = PESTS.filter(([w]) => s.includes(w)).map(([, k]) => k);
  const field = (fallbackWater: number): StepScene["plot"] => ({
    crop, stage: upland ? uplandStage(s) : riceStage(s), water: waterOf(s, fallbackWater), pests,
  });
  const scene = (anim: FarmAnim, icons: string[] = [], plot: StepScene["plot"] = field(upland ? 1 : 2),
    extra: StepScene["extra"] = null, who: StepScene["who"] = "farmer"): StepScene => ({ plot, anim, who, icons, extra });
  const ripe = (): StepScene["plot"] => ({ crop, stage: "ripe", water: 0, pests: [] });

  // the ná, the dog and the rats
  if (tab === "rats" || has(s, "chuột")) {
    if (has(s, "chó", "vồ", "vuốt ve", "nhận nuôi")) return scene(has(s, "vuốt ve") ? FARM_ANIM.pet : FARM_ANIM.stop, has(s, "thức ăn", "cho ăn") ? ["food_dog"] : [], ripe(), "dog");
    if (has(s, "đạn")) return scene(FARM_ANIM.aim, ["tool_sling", "ammo_pellet"], ripe(), "rat");
    if (has(s, "ná", "bắn", "ngắm", "giương", "nạp")) return scene(FARM_ANIM.aim, ["tool_sling"], ripe(), "rat");
    if (has(s, "bán", "cô út")) return scene(FARM_ANIM.stop, ["rat"], null, null, "coUt");
    return scene(FARM_ANIM.stop, [], ripe(), "rat");
  }
  if (has(s, "chó")) return scene(FARM_ANIM.pet, ["food_dog"], null, "dog");
  // cua & ốc
  if (has(s, "ốc bươu vàng")) return scene(FARM_ANIM.snails, ["oc_buou_vang"], { crop: "rice", stage: "tillering", water: waterOf(s, 2), pests: ["snail"] });
  if (has(s, "cua")) {
    if (has(s, "bán", "giá")) return scene(FARM_ANIM.stop, ["cua_dong", "cua_gach"], null, null, "coUt");
    return scene(FARM_ANIM.crab, [has(s, "gạch") ? "cua_gach" : "cua_dong"], null);
  }
  if (has(s, "ốc")) return scene(FARM_ANIM.snails, ["oc_dong"], null);
  if (has(s, "xô", "giỏ", "đựng", "tay cầm")) return scene(FARM_ANIM.stop, ["box_bucket", "box_basket"], null);
  // tools and the harvest
  if (has(s, "máy gặt")) return scene(FARM_ANIM.stop, [], ripe(), "harvester");
  if (has(s, "bình phun")) return scene(FARM_ANIM.spray, ["tool_sprayer", sprayIcon(s)]);
  if (has(s, "liềm", "gặt") && !upland) {
    if (has(s, "phơi", "bán")) return scene(FARM_ANIM.stop, ["rice_wet", "rice_dry"], null, "sun");
    return scene(FARM_ANIM.harvest, has(s, "liềm") ? ["tool_sickle"] : [], ripe());
  }
  // pests and spraying
  if (pests.length > 0 || has(s, "xịt", "thuốc", "sâu bệnh", "sâu hại")) return scene(FARM_ANIM.spray, [sprayIcon(s)]);
  // fertilizer
  if (has(s, "phân", "bón", "npk", "urê", "kali", "đạm")) return scene(FARM_ANIM.fertilize, [fertIcon(s)]);
  // selling and drying
  if (has(s, "bán", "cô út", "giá", "xu/kg")) return scene(FARM_ANIM.stop, [upland ? `produce_${tab}` : "rice_dry"], null, null, "coUt");
  if (has(s, "phơi lúa", "phơi 3", "lúa ướt", "khô rồi")) return scene(FARM_ANIM.stop, ["rice_wet", "rice_dry"], null, "sun");
  // hoa màu picks and plants
  if (upland && has(s, "hái", "bẻ", "đào", "thu hoạch", "chín")) {
    return scene(has(s, "đào") || tab === "khoai" ? FARM_ANIM.dig : FARM_ANIM.pick, [`produce_${tab}`], ripe());
  }
  if (has(s, "lên luống", "làm đất", "cày")) {
    return scene(FARM_ANIM.prepare, [], has(s, "lên luống") ? { crop: upland ? tab : "", stage: "beds", water: 1, pests: [] } : field(3));
  }
  if (has(s, "ngâm", "nứt nanh", "giống lúa") || tab === "varieties") return scene(FARM_ANIM.stop, ["seed_short"], field(1));
  if (has(s, "cấy", "trồng", "gieo", "ươm", "khóm")) return scene(FARM_ANIM.transplant, upland ? [`seed_${tab}`] : [], field(upland ? 1 : 2));
  // water
  if (has(s, "nước", "tưới", "tháo", "bơm", "mực", "phơi ruộng")) return scene(FARM_ANIM.pump, [], field(2));
  if (has(s, "hoa màu", "khoai", "bắp", "ớt")) return scene(FARM_ANIM.pick, ["produce_khoai", "produce_ot"], null);
  if (has(s, "đất tư", "thuê")) return scene(FARM_ANIM.stop, [], field(2));
  return scene(FARM_ANIM.stop, [], field(upland ? 1 : 2));
}

/** A tab's cards: one per line of each section, in order. `uplandIds` are the hoa-màu tabs. */
export function handbookCards(tab: HandbookTab, sections: readonly HandbookSection[], uplandIds: ReadonlySet<string>): CardSection[] {
  const upland = uplandIds.has(tab);
  return sections.map((sec) => {
    const numbered = sec.lines.filter((l) => /^\d+\./.test(l)).length >= 2;
    return {
      title: sec.title,
      flow: numbered,
      cards: sec.lines.map((line, i) => ({
        n: Number(/^(\d+)\./.exec(line)?.[1] ?? i + 1),
        caption: stepCaption(line),
        chips: stepChips(line),
        scene: stepScene(line, tab, upland),
      })),
    };
  });
}

/** The two views of the Sổ tay, remembered per browser. */
export type HandbookView = "text" | "pics";
export const HANDBOOK_VIEW_KEY = "farm.handbook.view";

export function loadHandbookView(): HandbookView {
  try {
    return globalThis.localStorage?.getItem(HANDBOOK_VIEW_KEY) === "pics" ? "pics" : "text";
  } catch {
    return "text";
  }
}

export function saveHandbookView(v: HandbookView): void {
  try {
    globalThis.localStorage?.setItem(HANDBOOK_VIEW_KEY, v);
  } catch {
    // private mode or blocked storage: the choice just isn't remembered
  }
}
