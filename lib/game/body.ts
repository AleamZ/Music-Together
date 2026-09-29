import type { Gender } from "./types";

// Pure: the character's body proportions (Look.body) — optional sliders that make each chibi unique. Every slider is
// a number in [-1, 1] (0 = the neutral base; each body type has its default body: defaultBody(g) — boys neutral, girls
// FEMALE_DEFAULT_BODY — which a look without a body reads as); the 3D model maps them to clamped multipliers so any mix
// stays cute (all-ages, stylised) and animations never break. Some sliders belong to one body type only (girls: bust,
// waist, hips; boys: shoulders, muscle, beard): the other body type ignores them, and switching body type resets
// them. The 2D sprite ignores all of it. The server (0094 save_character) keeps the same keys, ranges and choices;
// missing keys (older looks, NPCs) read as the defaults.

export const BODY_SLIDERS = ["height", "head", "legs", "build", "arms", "face", "eyeSize", "eyeSpacing", "shoulders", "muscle", "bust", "waist", "hips"] as const;
export type BodySlider = (typeof BODY_SLIDERS)[number];

export const EYE_COLORS = ["nau", "den", "hophach", "xanh", "xanhla", "xam", "tim"] as const;
export type EyeColor = (typeof EYE_COLORS)[number];

export const BEARDS = ["none", "stubble", "goatee", "full"] as const;
export type Beard = (typeof BEARDS)[number];

export type BodyShape = Record<BodySlider, number> & { eyeColor: EyeColor; beard: Beard };

/** The sliders only one body type has (the rest are shared). */
export const GENDER_ONLY: Record<Gender, readonly BodySlider[]> = { nam: ["shoulders", "muscle"], nu: ["bust", "waist", "hips"] };
/** The beard is a boys-only choice. */
export const BEARD_FOR: Gender = "nam";

/** The sliders shown for a body type, shared first. */
export function slidersFor(g: Gender): BodySlider[] {
  const other = GENDER_ONLY[g === "nam" ? "nu" : "nam"];
  return BODY_SLIDERS.filter((k) => !other.includes(k));
}

/** Vietnamese labels for the wardrobe ("Dáng người"): [title, left end, right end]. */
export const BODY_LABELS: Record<BodySlider, [string, string, string]> = {
  height: ["Chiều cao", "Thấp", "Cao"],
  head: ["Cỡ đầu", "Nhỏ", "To"],
  legs: ["Chân", "Ngắn", "Dài"],
  build: ["Vóc dáng", "Mảnh", "Đầy đặn"],
  arms: ["Tay", "Ngắn", "Dài"],
  face: ["Khuôn mặt", "Tròn", "Dài"],
  eyeSize: ["Cỡ mắt", "Nhỏ", "To"],
  eyeSpacing: ["Khoảng cách mắt", "Gần", "Xa"],
  shoulders: ["Vai", "Hẹp", "Rộng"],
  muscle: ["Cơ bắp", "Ít", "Nhiều"],
  bust: ["Vòng 1", "Nhỏ", "Đầy"],
  waist: ["Eo", "Thon", "Đầy"],
  hips: ["Hông", "Hẹp", "Rộng"],
};
export const EYE_COLOR_LABELS: Record<EyeColor, string> = { nau: "Nâu", den: "Đen", hophach: "Hổ phách", xanh: "Xanh dương", xanhla: "Xanh lá", xam: "Xám", tim: "Tím" };
export const BEARD_LABELS: Record<Beard, string> = { none: "Không", stubble: "Lún phún", goatee: "Chòm cằm", full: "Quai nón" };
/** Iris colours (top, bottom of the gradient). */
export const EYE_COLOR_HEX: Record<EyeColor, [string, string]> = {
  nau: ["#965830", "#d6924c"], den: ["#3a2a26", "#6a5048"], hophach: ["#b0701c", "#f0b846"], xanh: ["#2e5c9e", "#6fa8e0"],
  xanhla: ["#2f7a48", "#6cc08a"], xam: ["#5a6470", "#9aa6b2"], tim: ["#6a3c9a", "#a882d8"],
};

export const DEFAULT_BODY: BodyShape = {
  height: 0, head: 0, legs: 0, build: 0, arms: 0, face: 0, eyeSize: 0, eyeSpacing: 0, shoulders: 0, muscle: 0, bust: 0, waist: 0, hips: 0,
  eyeColor: "nau", beard: "none",
};

/** The girls' default body (the owner's pick): short, small head, long legs, full build, full bust/waist/hips, round
 *  face, eyes a little wider apart. New girls, "Mặc định" and girls' looks without a body read as this. */
export const FEMALE_DEFAULT_BODY: BodyShape = {
  ...DEFAULT_BODY, height: -1, head: -1, legs: 0.8, build: 1, arms: -1, face: -1, eyeSize: 0, eyeSpacing: 0.8, bust: 1, waist: 1, hips: 1,
};

/** The default body of a body type (without one: the neutral all-zero body). */
export function defaultBody(g?: Gender): BodyShape {
  return { ...(g === "nu" ? FEMALE_DEFAULT_BODY : DEFAULT_BODY) };
}

const clamp1 = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.round(Math.max(-1, Math.min(1, n)) * 100) / 100;
};

/** Any stored/received value → a full, clamped body (unknown keys dropped, missing or bad values → the body type's
 *  defaults). With a body type, the other type's sliders (and a girl's beard) read as neutral. */
export function normalizeBody(b: unknown, gender?: Gender): BodyShape {
  const o = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
  const base = defaultBody(gender), out = { ...base };
  for (const k of BODY_SLIDERS) out[k] = clamp1(o[k], base[k]);
  out.eyeColor = (EYE_COLORS as readonly string[]).includes(o.eyeColor as string) ? (o.eyeColor as EyeColor) : "nau";
  out.beard = (BEARDS as readonly string[]).includes(o.beard as string) ? (o.beard as Beard) : "none";
  if (gender) {
    for (const k of GENDER_ONLY[gender === "nam" ? "nu" : "nam"]) out[k] = 0;
    if (gender !== BEARD_FOR) out.beard = "none";
  }
  return out;
}

/** The body after switching body type: shared values kept, the gender-only ones back to the new type's defaults. */
export function switchGender(b: unknown, to: Gender): BodyShape {
  const n = normalizeBody(b), d = defaultBody(to);
  for (const k of [...GENDER_ONLY.nam, ...GENDER_ONLY.nu]) n[k] = d[k];
  n.beard = "none";
  return normalizeBody(n, to);
}

/** True when a body is all defaults (then it need not be stored). */
export function isDefaultBody(b: unknown, gender?: Gender): boolean {
  const n = normalizeBody(b, gender), d = defaultBody(gender);
  return BODY_SLIDERS.every((k) => n[k] === d[k]) && n.eyeColor === d.eyeColor && n.beard === d.beard;
}

/** A short cache key ("" for the default body). */
export function bodyKey(b: unknown, gender?: Gender): string {
  if (b === null || b === undefined || isDefaultBody(b, gender)) return "";
  const n = normalizeBody(b, gender);
  return BODY_SLIDERS.map((k) => Math.round(n[k] * 100)).join(",") + "," + n.eyeColor + "," + n.beard;
}

/** A random but tasteful body for a body type (sliders within ±0.8, a random eye colour, sometimes a beard for boys).
 *  `rnd` = Math.random by default. */
export function randomBody(rnd: () => number = Math.random, gender?: Gender): BodyShape {
  const out = { ...DEFAULT_BODY };
  for (const k of BODY_SLIDERS) out[k] = clamp1((rnd() * 2 - 1) * 0.8);
  out.eyeColor = EYE_COLORS[Math.floor(rnd() * EYE_COLORS.length) % EYE_COLORS.length];
  const r = rnd();
  out.beard = r < 0.6 ? "none" : BEARDS[1 + (Math.floor(r * 100) % 3)];
  return normalizeBody(out, gender);
}
