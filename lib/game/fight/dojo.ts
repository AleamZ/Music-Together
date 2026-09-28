// v20.2 Võ đường: the seven styles players learn, their belts, the uniforms and the exams (spec §v20.2). The server has
// its own copy (0050_dojo.sql's martial_styles / martial_belts seeds, authoritative); tests/unit/dojo-sql.test.ts pins
// the two equal. Style ids are the engine's (moves.ts order): 1 Vovinam … 7 Vịnh Xuân; 0 Tự do is practice only.

import { DEFAULT_LOOK } from "@/lib/game/look";
import type { Look } from "@/lib/game/types";
import { RANK_COLORS } from "./render/rig";
import { STYLE_NAMES, movesMaskForRank, styleStats, type StyleKey, type StyleStats } from "./styles";

/** Nhập môn: tuition per style (ledger dojo_tuition). */
export const TUITION = 2000;
/** The highest rank (index): 0–4. */
export const MAX_RANK = 4;
/** An exam attempt expires this long after it starts (kata phase). */
export const EXAM_MINUTES = 20;
/** Refereed fights need at least this much hunger and thirst (R6). */
export const FIGHT_MIN_VITALS = 10;
/** Vitals cost per round played (R6). */
export const HUNGER_PER_ROUND = 2;
export const THIRST_PER_ROUND = 3;

export interface Belt {
  rank: number;
  name: string;
  color: string;
}

/** An exam to reach `rank` (1–4). */
export interface Exam {
  rank: number;
  fee: number;
  /** Minimum hours at the previous rank (rank 1: after enrolling). */
  minHours: number;
  /** Cooldown after a failed attempt, minutes. */
  cooldownMin: number;
  notes: number;
  /** Kata ticks (1/60 s) per beat. */
  tpb: number;
  passPct: number;
  botLevel: number;
}

export const EXAMS: readonly Exam[] = [
  { rank: 1, fee: 1000, minHours: 2, cooldownMin: 30, notes: 18, tpb: 40, passPct: 60, botLevel: 1 },
  { rank: 2, fee: 2500, minHours: 24, cooldownMin: 120, notes: 24, tpb: 36, passPct: 65, botLevel: 2 },
  { rank: 3, fee: 5000, minHours: 48, cooldownMin: 360, notes: 30, tpb: 32, passPct: 70, botLevel: 3 },
  { rank: 4, fee: 10000, minHours: 96, cooldownMin: 1440, notes: 36, tpb: 28, passPct: 75, botLevel: 4 },
];

/** The exam that reaches `rank` (1–4), else null. */
export const examFor = (rank: number): Exam | null => EXAMS.find((e) => e.rank === rank) ?? null;

export interface MartialStyle {
  key: Exclude<StyleKey, "tudo">;
  /** The engine's style id (1–7). */
  id: number;
  name: string;
  master: string;
  /** The outfit-slot item worn to fight in this style. */
  uniform: string;
  uniformName: string;
  kata: string;
  lore: string;
  trait: string;
  belts: readonly Belt[];
  /** The master's look (a portrait drawn with the chibi painter). */
  masterLook: Look;
}

const belts = (id: number, names: readonly string[]): Belt[] =>
  names.map((name, rank) => ({ rank, name, color: RANK_COLORS[id][rank] }));

const master = (more: Partial<Look>): Look => ({ ...DEFAULT_LOOK, hat: null, neck: null, ...more });

export const MARTIAL: readonly MartialStyle[] = [
  {
    key: "vovinam", id: 1, name: STYLE_NAMES.vovinam, master: "võ sư Hùng", uniform: "vp_vovinam", uniformName: "Võ phục Vovinam",
    kata: "Thập tự quyền", lore: "Võ Việt: đòn chân kẹp cổ và song phi cước.", trait: "Song phi: đá nặng trên không với xa thêm 10 px.",
    belts: belts(1, ["Tự vệ", "Lam đai", "Hoàng đai", "Hồng đai", "Bạch đai"]),
    masterLook: master({ skin: "tan", hair: "short", hairColor: "black", outfit: "vp_vovinam" }),
  },
  {
    key: "muaythai", id: 2, name: STYLE_NAMES.muaythai, master: "thầy Somchai", uniform: "vp_muaythai", uniformName: "Đồ Muay Thai",
    kata: "Wai Kru", lore: "Nghệ thuật tám chi: chỏ, gối, quyền, cước.", trait: "Ôm ghì: quật xa thêm 6 px; đá nặng chịu được 1 đòn.",
    belts: belts(2, ["Prajioud trắng", "Prajioud vàng", "Prajioud xanh lá", "Prajioud đỏ", "Prajioud đen"]),
    masterLook: master({ skin: "deep", hair: "buzz", hairColor: "black", outfit: "vp_muaythai" }),
  },
  {
    key: "karate", id: 3, name: STYLE_NAMES.karate, master: "sensei Kenji", uniform: "vp_karate", uniformName: "Võ phục Karate",
    kata: "Heian", lore: "Một đòn, một mạng: nhất kích tất sát.", trait: "Liên hoàn: đấm nhẹ nối đấm nặng khi trúng.",
    belts: belts(3, ["Đai trắng", "Đai vàng", "Đai xanh lá", "Đai nâu", "Đai đen"]),
    masterLook: master({ skin: "light", hair: "short", hairColor: "silver", outfit: "vp_karate" }),
  },
  {
    key: "taekwondo", id: 4, name: STYLE_NAMES.taekwondo, master: "sư phụ Min-jun", uniform: "vp_taekwondo", uniformName: "Dobok Taekwondo",
    kata: "Taegeuk", lore: "Đôi chân là vũ khí: đá xoay, đá liên hoàn.", trait: "Mọi cú đá với xa thêm 8 px.",
    belts: belts(4, ["Đai trắng", "Đai vàng", "Đai xanh lá", "Đai đỏ", "Đai đen"]),
    masterLook: master({ skin: "light", hair: "undercut", hairColor: "black", outfit: "vp_taekwondo" }),
  },
  {
    key: "boxing", id: 5, name: STYLE_NAMES.boxing, master: "HLV Tony Tâm", uniform: "vp_boxing", uniformName: "Đồ Quyền Anh",
    kata: "Shadow boxing", lore: "Lách, né, móc: đôi găng nói thay lời.", trait: "Đá thành đấm thân; nhảy không đá, đấm nhảy ×1,2.",
    belts: belts(5, ["Tân binh", "Nghiệp dư", "Bán chuyên", "Chuyên nghiệp", "Nhà vô địch"]),
    masterLook: master({ skin: "warm", hair: "buzz", hairColor: "brown", outfit: "vp_boxing" }),
  },
  {
    key: "judo", id: 6, name: STYLE_NAMES.judo, master: "sensei Mai", uniform: "vp_judo", uniformName: "Judogi",
    kata: "Nage-no-kata", lore: "Nhu thắng cương: mượn sức đối thủ mà quật.", trait: "Quật ×1,3, xa thêm 6 px; gỡ quật lâu hơn 3 khung.",
    belts: belts(6, ["Đai trắng", "Đai vàng", "Đai cam", "Đai xanh lá", "Đai đen"]),
    masterLook: master({ skin: "light", hair: "bun", hairColor: "black", gender: "nu", outfit: "vp_judo" }),
  },
  {
    key: "vinhxuan", id: 7, name: STYLE_NAMES.vinhxuan, master: "sư phụ Diệp Thanh", uniform: "vp_vinhxuan", uniformName: "Áo Vịnh Xuân",
    kata: "Tiểu niệm đầu", lore: "Giữ trung tuyến, quyền liên hoàn như mưa.", trait: "Đấm nhẹ ra trong 4 khung; liên hoàn 3 đấm nhẹ.",
    belts: belts(7, ["Sơ cấp", "Trung cấp", "Cao cấp", "Truyền nhân", "Sư phụ"]),
    masterLook: master({ skin: "warm", hair: "long", hairColor: "darkbrown", gender: "nu", outfit: "vp_vinhxuan" }),
  },
];

export const UNIFORM_IDS: readonly string[] = MARTIAL.map((m) => m.uniform);

/** A catalog id that is a uniform (they are granted by the dojo, never sold). */
export const isUniform = (id: string | null | undefined): boolean => !!id && id.startsWith("vp_");

export const martialById = (id: number): MartialStyle | null => MARTIAL.find((m) => m.id === id) ?? null;
export const martialByKey = (key: string): MartialStyle | null => MARTIAL.find((m) => m.key === key) ?? null;

/** The style a worn outfit fights as (null: not a uniform). */
export function uniformStyle(outfit: string | null | undefined): MartialStyle | null {
  return MARTIAL.find((m) => m.uniform === outfit) ?? null;
}

export function beltOf(style: number, rank: number): Belt {
  const m = martialById(style);
  const r = Math.max(0, Math.min(MAX_RANK, Math.trunc(rank)));
  return m ? m.belts[r] : { rank: r, name: "Tự do", color: RANK_COLORS[0][r] };
}

/** "Lên Hoàng đai!" */
export const promotionText = (style: number, rank: number): string => `Lên ${beltOf(style, rank).name}!`;

/** The special a rank unlocks (1: S2 … 4: Tuyệt kỹ), for "Mở chiêu: …"; slot = rank + 1. */
export const unlockSlotOf = (rank: number): number => Math.max(1, Math.min(5, rank + 1));

export { movesMaskForRank };
export const statsOf = (style: number): StyleStats => styleStats(style);

/** The kata chart's belt row (the exam reaching `rank`). */
export function kataRowFor(rank: number): { notes: number; tpb: number; half: boolean } {
  const e = examFor(rank) ?? EXAMS[0];
  return { notes: e.notes, tpb: e.tpb, half: rank >= 3 };
}
