import { GARMENT_ART } from "@/lib/game/art/garments";
import { ITEM_ART } from "@/lib/game/art/items";
import { UNIFORM_ART_IDS } from "@/lib/game/art/uniforms";
import type { Look } from "@/lib/game/types";

// Pure: every wearable id the client can draw (the item_catalog's art: ITEM_ART, the fashion garments and the võ
// phục), grouped by the Look field it goes in — for the character lab and the mapping tests.

export type LookSlot = "hat" | "top" | "bottom" | "outfit" | "shoes" | "neck" | "wrist" | "hairpin";
export const LOOK_SLOTS: readonly LookSlot[] = ["hat", "top", "bottom", "outfit", "shoes", "neck", "wrist", "hairpin"];

export function wearableIds(): Record<LookSlot, string[]> {
  const out: Record<LookSlot, string[]> = { hat: [], top: [], bottom: [], outfit: [], shoes: [], neck: [], wrist: [], hairpin: [] };
  for (const [id, a] of Object.entries(ITEM_ART)) out[a.slot].push(id);
  for (const [id, a] of Object.entries(GARMENT_ART)) if (!out[a.slot].includes(id)) out[a.slot].push(id);
  for (const id of UNIFORM_ART_IDS) if (!out.outfit.includes(id)) out.outfit.push(id);
  return out;
}

/** A look wearing `id` in `slot` (over a base look). */
export function wearing(base: Look, slot: LookSlot, id: string | null): Look {
  if (slot === "shoes") return { ...base, shoes: id ?? base.shoes };
  return { ...base, [slot]: id };
}
