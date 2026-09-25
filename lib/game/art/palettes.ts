import type { HairColor, HairStyle, SkinTone } from "@/lib/game/types";

export const OUTLINE = "#3a2418";
export const EYE = "#2a1a14";

export const SKIN: Record<SkinTone, { s: string; S: string; b: string; m: string }> = {
  light: { s: "#f7d9bf", S: "#e2b392", b: "#f2a898", m: "#b8674f" },
  warm: { s: "#f2c7a0", S: "#d9a07a", b: "#f0a08a", m: "#b35f4a" },
  tan: { s: "#d9a577", S: "#b98152", b: "#d98a6e", m: "#9a4e3a" },
  deep: { s: "#a86f4c", S: "#8a5536", b: "#b8664e", m: "#6e3526" },
};

export const HAIR_COLOR: Record<HairColor, { h: string; H: string }> = {
  black: { h: "#221b25", H: "#3a3345" },
  darkbrown: { h: "#3b2519", H: "#5a3a26" },
  brown: { h: "#6b4226", H: "#8a5a36" },
  pink: { h: "#e889b5", H: "#f4b3d0" },
};

export const SKIN_LABEL: Record<SkinTone, string> = { light: "Sáng", warm: "Hồng hào", tan: "Bánh mật", deep: "Nâu" };
export const HAIR_STYLE_LABEL: Record<HairStyle, string> = { short: "Tóc ngắn", bob: "Ngang vai", long: "Tóc dài" };
export const HAIR_COLOR_LABEL: Record<HairColor, string> = { black: "Đen", darkbrown: "Nâu đen", brown: "Nâu", pink: "Hồng" };
