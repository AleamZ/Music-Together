import type { PixelIcon } from "./icons";

// 16×16 icons for the farm (spec §14): seed sacks in the variety's colour, fertilizer bags with their nutrient on
// the label, pesticide bottles with their pest, and rice sacks (wet/dry). "." transparent, "o" outline, other letters
// from the icon's own palette. Original art.

const SEED_SACK = [
  "................",
  "......oooo......",
  ".....oTttTo.....",
  "......oTTo......",
  ".....orrrro.....",
  "....osssssSo....",
  "...osssssssSo...",
  "..osssssgssSSo..",
  "..ossssgYgsSSo..",
  "..osssgYgssSSo..",
  "..ossgYgsssSSo..",
  "..osssgssssSSo..",
  "..ossssssssSSo..",
  "...osssssssSo...",
  "....oooooooo....",
  "................",
];

const seedSack = (s: string, S: string): PixelIcon => ({
  rows: SEED_SACK,
  pal: { s, S, t: s, T: S, r: "#8b5a33", g: "#b8902a", Y: "#f6c945" },
});

/** "____" marks where a glyph row goes. */
const FERT_BAG = [
  "................",
  "...oooooooooo...",
  "..obbbbbbbbbBo..",
  "..obbbbbbbbbBo..",
  "..owwwwwwwwwWo..",
  "..oww____wwwWo..",
  "..oww____wwwWo..",
  "..oww____wwwWo..",
  "..oww____wwwWo..",
  "..oww____wwwWo..",
  "..owwwwwwwwwWo..",
  "..obbbbbbbbbBo..",
  "..obbbbbbbbbBo..",
  "..obbbbbbbbbBo..",
  "...oooooooooo...",
  "................",
];

const PESTICIDE_BOTTLE = [
  "................",
  "......oooo......",
  "......occo......",
  "......oooo......",
  ".......oo.......",
  "......oBBo......",
  ".....oBBbBo.....",
  "....oBBBBbBo....",
  "....owwwwwWo....",
  "....ow____Wo....",
  "....ow____Wo....",
  "....ow____Wo....",
  "....owwwwwWo....",
  "....oBBBBbBo....",
  ".....oooooo.....",
  "................",
];

/** Put a 4-wide glyph ("." = the label) into a template's "____" rows. */
function withGlyph(template: readonly string[], glyph: readonly string[]): string[] {
  let i = 0;
  return template.map((row) => (row.includes("____") ? row.replace("____", glyph[i++].replace(/\./g, "w")) : row));
}

const LABEL = { w: "#f4efe0", W: "#d8cfb8" };

const fertBag = (b: string, B: string, glyph: readonly string[], ink: Record<string, string>): PixelIcon => ({
  rows: withGlyph(FERT_BAG, glyph), pal: { b, B, ...LABEL, ...ink },
});

const bottle = (B: string, b: string, cap: string, glyph: readonly string[], ink: string): PixelIcon => ({
  rows: withGlyph(PESTICIDE_BOTTLE, glyph), pal: { B, b, c: cap, L: ink, ...LABEL },
});

const RICE_SACK = [
  "................",
  "................",
  ".....oooooo.....",
  "....oYyYYyYo....",
  "...osYYyYYYso...",
  "...ossYYYYsso...",
  "..osssssssssSo..",
  "..ossssssssSSo..",
  ".osssssssssSSSo.",
  ".ossssMMssssSSo.",
  ".osssMMMMsssSSo.",
  ".ossssMMssssSSo.",
  ".osssssssssSSSo.",
  "..osssssssssSo..",
  "...oooooooooo...",
  "................",
];

const riceSack = (Y: string, y: string, M: string): PixelIcon => ({
  rows: RICE_SACK, pal: { Y, y, M, s: "#c8a46a", S: "#a8844f" },
});

export const FARM_ICONS: Record<string, PixelIcon> = {
  seed_short: seedSack("#7fb548", "#5a8f32"),
  seed_nep: seedSack("#efe6cf", "#cfc3a3"),
  seed_thom: seedSack("#d9776a", "#b25a4f"),
  // hữu cơ: a sprout
  fert_manure: fertBag("#8a6a3f", "#6e5230", ["..LL", ".LLL", "LLL.", ".L..", "L..."], { L: "#3f7f2e" }),
  fert_phosphate: fertBag("#9aa0a8", "#747a84", ["LLL.", "L..L", "LLL.", "L...", "L..."], { L: "#2a2f3a" }),
  fert_urea: fertBag("#e8e4d8", "#c3c8d4", ["L..L", "LL.L", "L.LL", "L..L", "L..L"], { L: "#3d6fd1" }),
  fert_potash: fertBag("#c0392b", "#8e2a1f", ["L..L", "L.L.", "LL..", "L.L.", "L..L"], { L: "#8e2a1f" }),
  // N, P and K in their colours
  fert_npk: fertBag("#3d6fd1", "#2f56a6", ["a..k", "a..k", "....", ".cc.", ".cc."], { a: "#3f7f2e", k: "#c0392b", c: "#2a2f3a" }),
  // a caterpillar, a hopper, a blast spot
  spray_insect: bottle("#5caa4a", "#86c95c", "#2f6e2f", [".LL.", "LLLL", "L..L"], "#3f7f2e"),
  spray_hopper: bottle("#e0873c", "#f2b27a", "#8e4a1f", ["L..L", ".LL.", "L..L"], "#7a4a2a"),
  spray_fungus: bottle("#7a5cc0", "#a58be0", "#4a3480", [".LL.", "L..L", ".LL."], "#8e5a2a"),
  rice_wet: riceSack("#c9c46a", "#a8a24a", "#6fb2cf"),
  rice_dry: riceSack("#f6c945", "#e0b33c", "#e0662f"),
};
