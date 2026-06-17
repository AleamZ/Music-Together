export type ThemeName = "salon" | "cozy";

/** Validate a stored/raw theme value; anything other than the known themes → "salon". */
export function parseTheme(v: string | null): ThemeName {
  return v === "cozy" ? "cozy" : "salon";
}
