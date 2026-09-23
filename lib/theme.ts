export type ThemeName = "salon" | "cozy" | "dragon" | "cyberpunk" | "itv" | "lofi" | "miku";

/** Validate a stored/raw theme value; anything other than the known themes → "salon". */
export function parseTheme(v: string | null): ThemeName {
  if (v === "cozy") return "cozy";
  if (v === "dragon") return "dragon";
  if (v === "cyberpunk") return "cyberpunk";
  if (v === "itv") return "itv";
  if (v === "lofi") return "lofi";
  if (v === "miku") return "miku";
  return "salon";
}

