export type ThemeName = "salon" | "cozy" | "dragon" | "cyberpunk";

/** Validate a stored/raw theme value; anything other than the known themes → "salon". */
export function parseTheme(v: string | null): ThemeName {
  if (v === "cozy") return "cozy";
  if (v === "dragon") return "dragon";
  if (v === "cyberpunk") return "cyberpunk";
  return "salon";
}
