export type Facing = "down" | "up" | "left" | "right";
export interface Vec { x: number; y: number }

export type ItemSlot = "hat" | "top" | "bottom" | "shoes" | "neck" | "wrist" | "hairpin" | "hand" | "pet";
export type SkinTone = "light" | "warm" | "tan" | "deep";
export type HairStyle = "short" | "bob" | "long" | "buzz" | "undercut" | "curly" | "ponytail" | "twin_braids" | "bun" | "bangs";
export type HairColor = "black" | "darkbrown" | "brown" | "pink" | "blonde" | "red" | "blue" | "silver" | "purple" | "moss";
/** Body type: "nam" (male) or "nu" (nữ, female). */
export type Gender = "nam" | "nu";

export const SKIN_TONES: readonly SkinTone[] = ["light", "warm", "tan", "deep"];
/** Mirrors 0029_fashion2.sql `_hair_ok` (pinned by tests). */
export const HAIR_STYLES: readonly HairStyle[] = ["short", "bob", "long", "buzz", "undercut", "curly", "ponytail", "twin_braids", "bun", "bangs"];
export const HAIR_COLORS: readonly HairColor[] = ["black", "darkbrown", "brown", "pink", "blonde", "red", "blue", "silver", "purple", "moss"];
export const GENDERS: readonly Gender[] = ["nam", "nu"];
/** The styles anh Ba cuts per body type (mirrors 0035_salon_gender.sql `_hair_gender_ok`, pinned by tests).
 *  buzz/undercut are nam-only; bob/long/ponytail/twin_braids/bun are nu-only; short/curly/bangs are for both.
 *  A character who already wears a style outside its list keeps it (it is only never offered again). */
export const HAIR_STYLES_BY_GENDER: Record<Gender, readonly HairStyle[]> = {
  nam: ["short", "buzz", "undercut", "curly", "bangs"],
  nu: ["long", "bob", "ponytail", "twin_braids", "bun", "bangs", "curly", "short"],
};

export function hairFitsGender(hair: HairStyle, gender: Gender): boolean {
  return HAIR_STYLES_BY_GENDER[gender].includes(hair);
}

/** A character's appearance (camelCase mirror of public.characters). `hand`/`pet` arrive in v14/v15. */
export interface Look {
  skin: SkinTone;
  hair: HairStyle;
  hairColor: HairColor;
  hat: string | null;
  /** null = not worn (underwear shows). */
  top: string | null;
  bottom: string | null;
  shoes: string;
  neck: string | null;
  /** Accessory slots (0029); absent reads as none. */
  wrist?: string | null;
  hairpin?: string | null;
  /** Body type; absent (older looks, NPCs) reads as "nam". */
  gender?: Gender;
  /** A full-body fashion model (slot "outfit"): while worn, `top` and `bottom` are kept but not drawn. */
  outfit?: string | null;
}
