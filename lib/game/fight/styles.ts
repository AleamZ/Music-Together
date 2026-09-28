// v20 Võ đài: the martial-art styles (spec §v20.1 "Styles, stats and traits"). The stats live in MOVE_TABLE's style
// rows (moves.ts) so the SQL mirror has them too; this module names them and builds match params. v20.2 adds belts,
// uniforms and prices here.

import { S_ATK, S_DEF, S_ENERGY, S_JUMP, S_WALK, STYLE_SPECIALS, styleField, type SpecialInfo } from "./moves";

export type StyleKey = "tudo" | "vovinam" | "muaythai" | "karate" | "taekwondo" | "boxing" | "judo" | "vinhxuan";

/** Style ids are the MOVE_TABLE order. */
export const STYLE_KEYS: readonly StyleKey[] = ["tudo", "vovinam", "muaythai", "karate", "taekwondo", "boxing", "judo", "vinhxuan"];

export const STYLE_NAMES: Readonly<Record<StyleKey, string>> = {
  tudo: "Tự do", vovinam: "Vovinam", muaythai: "Muay Thai", karate: "Karate", taekwondo: "Taekwondo",
  boxing: "Quyền Anh", judo: "Judo", vinhxuan: "Vịnh Xuân",
};

export interface StyleStats { atk: number; def: number; walk: number; jump: number; energy: number }

export const styleId = (k: StyleKey): number => STYLE_KEYS.indexOf(k);

export function styleStats(style: number): StyleStats {
  return {
    atk: styleField(style, S_ATK), def: styleField(style, S_DEF), walk: styleField(style, S_WALK),
    jump: styleField(style, S_JUMP), energy: styleField(style, S_ENERGY),
  };
}

export function styleSpecials(style: number): readonly SpecialInfo[] {
  return STYLE_SPECIALS[style] ?? [];
}

/** The specials unlocked at a rank (0–4): bit 0 = S1 … bit 4 = the Tuyệt kỹ. */
export const movesMaskForRank = (rank: number): number => (1 << (Math.max(0, Math.min(4, rank)) + 1)) - 1;
