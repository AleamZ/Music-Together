import { FORM2_PAL, PET_PALETTES } from "@/lib/game/art/pets";
import { SPECIES, type PetSpecies } from "@/lib/game/pets/catalog";

// Pure: a 3D pet's colours and what it wears, from the same data the 2D painter uses (lib/game/art/pets.ts): the
// variant's palette (b fur, s shade, l light: belly and face, w wings, k beak), form 2's new coat, and the fashion
// items (head / neck / body) as simple shapes with the 2D colours.

export interface PetLook3D { variant?: string; form?: number; head?: string | null; neck?: string | null; body?: string | null }

export interface PetColors { fur: number; shade: number; light: number; wing: number; beak: number }

const hex = (s: string | undefined, d: number): number => (s ? parseInt(s.replace("#", ""), 16) : d);

/** The fur colours of a species in a variant (unknown: the first) and form (2: the evolved coat). */
export function petColors(sp: PetSpecies, look: PetLook3D = {}): PetColors {
  const pals = PET_PALETTES[sp];
  const pal = (look.form ?? 0) >= 2 ? FORM2_PAL[sp] : pals[look.variant ?? ""] ?? pals[SPECIES[sp].variants[0].id];
  return {
    fur: hex(pal.b, 0xd9a24e), shade: hex(pal.s, 0xa8742f), light: hex(pal.l, 0xf3dcae),
    wing: hex(pal.w, hex(pal.s, 0x2e7d32)), beak: hex(pal.k, 0xf2b632),
  };
}

export type Wear =
  | { kind: "party" } | { kind: "bow"; color: number; knot: number } | { kind: "tophat" } | { kind: "nonla" } | { kind: "beanie" }
  | { kind: "band"; color: number; charm: number | null; bell: boolean } | { kind: "bandana"; color: number }
  | { kind: "bowtie"; color: number } | { kind: "scarf"; color: number }
  | { kind: "knit"; a: number; b: number };

/** The 3D shape and colours of a fashion item (null: unknown). */
export function petWear(id: string | null | undefined): Wear | null {
  switch (id) {
    case "cho_party": return { kind: "party" };
    case "meo_bow": return { kind: "bow", color: 0xf07aa6, knot: 0xb83a6e };
    case "tho_bow": return { kind: "bow", color: 0xd9362b, knot: 0x8a1f18 };
    case "vet_tophat": return { kind: "tophat" };
    case "soc_nonla": return { kind: "nonla" };
    case "hamster_beanie": return { kind: "beanie" };
    case "cho_collar": return { kind: "band", color: 0xd9362b, charm: 0xf6d24a, bell: false };
    case "meo_bell": return { kind: "band", color: 0xf07aa6, charm: 0xf6d24a, bell: true };
    case "cho_bandana": return { kind: "bandana", color: 0x3d6fd1 };
    case "vet_bowtie": return { kind: "bowtie", color: 0xd9362b };
    case "soc_scarf": return { kind: "scarf", color: 0x2e9a94 };
    case "hamster_scarf": return { kind: "scarf", color: 0xe07a2e };
    case "cho_sweater": return { kind: "knit", a: 0xc0303a, b: 0xf4f1ec };
    case "meo_sweater": return { kind: "knit", a: 0x3f8a5a, b: 0x2e6a44 };
    case "tho_vest": return { kind: "knit", a: 0x3d6fd1, b: 0x2a52a8 };
    default: return null;
  }
}

/** A cache key for a built pet (a new look rebuilds its model). */
export const petKey = (sp: PetSpecies, look: PetLook3D = {}): string =>
  [sp, look.variant ?? "", look.form ?? 0, look.head ?? "", look.neck ?? "", look.body ?? ""].join("|");
