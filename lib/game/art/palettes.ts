import type { HairColor, HairStyle, SkinTone } from "@/lib/game/types";

export const OUTLINE = "#3a2418";
export const EYE = "#2a1a14";

export const SKIN: Record<SkinTone, { s: string; S: string; b: string; m: string }> = {
  light: { s: "#f7d9bf", S: "#e2b392", b: "#f2a898", m: "#b8674f" },
  warm: { s: "#f2c7a0", S: "#d9a07a", b: "#f0a08a", m: "#b35f4a" },
  tan: { s: "#d9a577", S: "#b98152", b: "#d98a6e", m: "#9a4e3a" },
  deep: { s: "#a86f4c", S: "#8a5536", b: "#b8664e", m: "#6e3526" },
};

export const EYE_SHINE = "#ffffff";
export const SOCK = "#f6f2ea";

/** h main · H highlight · d shade. */
export const HAIR_COLOR: Record<HairColor, { h: string; H: string; d: string }> = {
  black: { h: "#2a2230", H: "#4a4258", d: "#16111a" },
  darkbrown: { h: "#3b2519", H: "#654230", d: "#26160e" },
  brown: { h: "#6b4226", H: "#96643c", d: "#4a2c18" },
  pink: { h: "#e889b5", H: "#f7c0da", d: "#c8679a" },
  blonde: { h: "#e8c26a", H: "#f6e0a0", d: "#c49a44" },
  red: { h: "#b8322a", H: "#dc5e52", d: "#86201a" },
  blue: { h: "#3a6fc4", H: "#6a98e0", d: "#264e92" },
  silver: { h: "#c8ccd4", H: "#eceef2", d: "#9ca0aa" },
  purple: { h: "#7a4bb0", H: "#a078d0", d: "#56328a" },
  moss: { h: "#5f7a3a", H: "#86a05c", d: "#435828" },
};

export const SKIN_LABEL: Record<SkinTone, string> = { light: "Sáng", warm: "Hồng hào", tan: "Bánh mật", deep: "Nâu" };
export const HAIR_STYLE_LABEL: Record<HairStyle, string> = {
  short: "Tóc ngắn", bob: "Ngang vai", long: "Tóc dài", buzz: "Đầu đinh", undercut: "Undercut",
  curly: "Tóc xoăn", ponytail: "Đuôi ngựa", twin_braids: "Tết hai bên", bun: "Búi củ tỏi", bangs: "Mái bằng",
};
export const HAIR_COLOR_LABEL: Record<HairColor, string> = {
  black: "Đen", darkbrown: "Nâu đen", brown: "Nâu", pink: "Hồng", blonde: "Vàng",
  red: "Đỏ", blue: "Xanh dương", silver: "Bạc", purple: "Tím", moss: "Xanh rêu",
};
