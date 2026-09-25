export type Facing = "down" | "up" | "left" | "right";
export interface Vec { x: number; y: number }

export type ItemSlot = "hat" | "top" | "bottom" | "shoes" | "neck" | "hand" | "pet";
export type SkinTone = "light" | "warm" | "tan" | "deep";
export type HairStyle = "short" | "bob" | "long";
export type HairColor = "black" | "darkbrown" | "brown" | "pink";

export const SKIN_TONES: readonly SkinTone[] = ["light", "warm", "tan", "deep"];
export const HAIR_STYLES: readonly HairStyle[] = ["short", "bob", "long"];
export const HAIR_COLORS: readonly HairColor[] = ["black", "darkbrown", "brown", "pink"];

/** A character's appearance (camelCase mirror of public.characters). `hand`/`pet` arrive in v14/v15. */
export interface Look {
  skin: SkinTone;
  hair: HairStyle;
  hairColor: HairColor;
  hat: string | null;
  top: string;
  bottom: string;
  shoes: string;
  neck: string | null;
}
