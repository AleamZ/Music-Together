import type { HatShape } from "./hats";

export type ItemArt =
  | { slot: "hat"; shape: HatShape; colors: Record<string, string> }
  | { slot: "top"; kind: "baba" | "tee"; colors: readonly [main: string, shade: string, highlight: string, detail: string] }
  | { slot: "bottom"; kind: "shorts" | "long"; colors: readonly [main: string, shade: string, stripe: string] }
  | { slot: "shoes"; colors: readonly [strap: string, sole: string] }
  | { slot: "neck"; colors: readonly [light: string, dark: string] };

/** Render data per catalog id. Must match the seed in supabase/migrations/0011_v13_game_mode.sql (tested). */
export const ITEM_ART: Record<string, ItemArt> = {
  hat_nonla: { slot: "hat", shape: "nonla", colors: { y: "#f3e3b0", Y: "#dcc587", Z: "#b89758" } },
  hat_taibeo_green: { slot: "hat", shape: "taibeo", colors: { x: "#5a9a44", X: "#3f7a30" } },
  top_baba_yellow: { slot: "top", kind: "baba", colors: ["#f2c23c", "#d19a24", "#fbe08a", "#b27d16"] },
  top_baba_white: { slot: "top", kind: "baba", colors: ["#f4f1ea", "#d6cfc0", "#ffffff", "#b9ae98"] },
  top_baba_pink: { slot: "top", kind: "baba", colors: ["#f19bb5", "#d4758f", "#f9c3d3", "#b5566f"] },
  top_tee_blue: { slot: "top", kind: "tee", colors: ["#3f7fc4", "#2f63a0", "#6fa3dc", "#3f7fc4"] },
  top_tee_green: { slot: "top", kind: "tee", colors: ["#5fae6e", "#468a53", "#8fd09b", "#5fae6e"] },
  bottom_shorts_red: { slot: "bottom", kind: "shorts", colors: ["#d8433a", "#a82c26", "#f1ece0"] },
  bottom_pants_black: { slot: "bottom", kind: "long", colors: ["#2f2b33", "#1f1c22", "#2f2b33"] },
  bottom_jeans: { slot: "bottom", kind: "long", colors: ["#46618f", "#34496e", "#46618f"] },
  shoes_dep_blue: { slot: "shoes", colors: ["#3d6fd1", "#2a4f9c"] },
  shoes_dep_brown: { slot: "shoes", colors: ["#8b5a33", "#6e4424"] },
  shoes_dep_red: { slot: "shoes", colors: ["#d9534f", "#a83c39"] },
  neck_khanran: { slot: "neck", colors: ["#f1ece0", "#2b2524"] },
  neck_khanran_red: { slot: "neck", colors: ["#f1ece0", "#c0392b"] },
};

/** One representative colour per item (editor swatches). */
export function swatchOf(id: string): string {
  const a = ITEM_ART[id];
  if (!a) return "#9aa0a8";
  if (a.slot === "hat") return a.shape === "nonla" ? a.colors.y : a.colors.x;
  if (a.slot === "neck") return a.colors[1];
  return a.colors[0];
}
