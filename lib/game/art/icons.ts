import { FISH_ICONS } from "./fish";
import { GEAR_ICONS } from "./gear";
import { ITEM_ART, type ItemArt } from "./items";
import { OUTLINE } from "./palettes";

export const ICON_SIZE = 16;

export type IconKind = "nonla" | "taibeo" | "baba" | "tee" | "shorts" | "long" | "dep" | "khanran";

// Inventory icons, one per item kind; colours come from each item's ITEM_ART (so a new item of an
// existing kind needs no new art). Codes: . transparent · o outline · y/Y/Z straw · x/X fabric
// · t/T/u/K top main/shade/highlight/detail · p/P/l bottom main/shade/stripe · f/F sandal strap/sole · q/Q scarf checks.
export const ITEM_ICONS: Record<IconKind, readonly string[]> = {
  nonla: [
    "................",
    "................",
    ".......oo.......",
    "......oyyo......",
    ".....oyyyYo.....",
    "....oyyyyYYo....",
    "...oYYYYYYYZo...",
    "..oyyyyyyyYZZo..",
    ".oyyyyyyyYYYZZo.",
    "oYYYYYYYYYYYYZZo",
    "oyyyyyyyyyYYYZZo",
    "oZZZZZZZZZZZZZZo",
    ".oooooooooooooo.",
    ".....oZ..Zo.....",
    "......oZZo......",
    "................",
  ],
  taibeo: [
    "................",
    "................",
    "................",
    "....oooooooo....",
    "...oxxxxxxxxo...",
    "..oxxxxxxxxxXo..",
    "..oxxxxxxxxxXo..",
    "..oxxxxxxxxxXo..",
    "..oXXXXXXXXXXo..",
    ".oxxxxxxxxxxxXo.",
    "oxxxxxxxxxxxxxXo",
    "oXXXXXXXXXXXXXXo",
    ".oooooooooooooo.",
    "................",
    "................",
    "................",
  ],
  baba: [
    "................",
    "................",
    "...oooo..oooo...",
    "..outto..ottTo..",
    ".outtttoottttTo.",
    "ouuttttKKttttTTo",
    "ouuottttttttoTTo",
    "ouuotttKKtttoTTo",
    "ouuottttttttoTTo",
    "ouuotttKKtttoTTo",
    "ouuottttttttoTTo",
    "oKKotttKKtttoKKo",
    ".ooottttttttooo.",
    "...oooooooooo...",
    "................",
    "................",
  ],
  tee: [
    "................",
    "................",
    "................",
    "..ooooo..ooooo..",
    ".ouuuttoottTTTo.",
    "ouuuttttttttTTTo",
    "ouuuttttttttTTTo",
    ".ooouttttttTooo.",
    "...outtttttTo...",
    "...outtttttTo...",
    "...outtttttTo...",
    "...outtttttTo...",
    "...outtttttTo...",
    "...oooooooooo...",
    "................",
    "................",
  ],
  shorts: [
    "................",
    "................",
    "................",
    "...oooooooooo...",
    "...oPPPPPPPPo...",
    "..olpppppppPlo..",
    "..olpppppppPlo..",
    "..olpppooppPlo..",
    "..olppo..opPlo..",
    "..olppo..opPlo..",
    "..ooooo..ooooo..",
    "................",
    "................",
    "................",
    "................",
    "................",
  ],
  long: [
    "................",
    "................",
    "...oooooooooo...",
    "...oPPPPPPPPo...",
    "..olpppppppPlo..",
    "..olpppppppPlo..",
    "..olpppooppPlo..",
    "..olppo..opPlo..",
    "..olppo..opPlo..",
    "..olppo..opPlo..",
    "..olppo..opPlo..",
    "..olppo..opPlo..",
    "..olppo..opPlo..",
    "..ooooo..ooooo..",
    "................",
    "................",
  ],
  dep: [
    "................",
    "................",
    ".ooooo....ooooo.",
    "offfffo..offfffo",
    "offoffo..offoffo",
    "ofofofo..ofofofo",
    "oofffoo..oofffoo",
    "offfffo..offfffo",
    "offfffo..offfffo",
    "offfffo..offfffo",
    ".offfo....offfo.",
    ".oFFFo....oFFFo.",
    "..ooo......ooo..",
    "................",
    "................",
    "................",
  ],
  khanran: [
    "................",
    "................",
    "................",
    "oo............oo",
    "oqQooooooooooqQo",
    ".oQQqqQQqqQQqqo.",
    "..oqQQqqQQqqQo..",
    "...oQQqqQQqqo...",
    "....oqQQqqQo....",
    ".....oQQqqo.....",
    "......oqQo......",
    ".......oo.......",
    "................",
    "................",
    "................",
    "................",
  ],
};

function kindOf(art: ItemArt): IconKind {
  switch (art.slot) {
    case "hat": return art.shape;
    case "top": return art.kind;
    case "bottom": return art.kind;
    case "shoes": return "dep";
    case "neck": return "khanran";
  }
}

function paletteOf(art: ItemArt): Record<string, string> {
  switch (art.slot) {
    case "hat": return { ...art.colors };
    case "top": { const [t, T, u, K] = art.colors; return { t, T, u, K }; }
    case "bottom": { const [p, P, l] = art.colors; return { p, P, l }; }
    case "shoes": { const [f, F] = art.colors; return { f, F }; }
    case "neck": { const [q, Q] = art.colors; return { q, Q }; }
  }
}

/** 16×16 CSS colours ("" = transparent) for a catalog item's icon; null for an unknown id. */
export function itemIconMatrix(id: string): string[][] | null {
  const art = ITEM_ART[id];
  if (!art) return null;
  const pal: Record<string, string> = { o: OUTLINE, ...paletteOf(art) };
  return ITEM_ICONS[kindOf(art)].map((row) => [...row].map((ch) => (ch === "." ? "" : pal[ch] ?? "")));
}

/** A 16×16 icon with its own palette ("." transparent, "o" outline) — fish and gear (v14). */
export interface PixelIcon { rows: readonly string[]; pal: Readonly<Record<string, string>> }

/** 16×16 CSS colours ("" = transparent). */
export function pixelIconMatrix(icon: PixelIcon): string[][] {
  return icon.rows.map((row) => [...row].map((ch) => (ch === "." ? "" : ch === "o" ? OUTLINE : icon.pal[ch] ?? "")));
}

/** Any item's icon: clothing (catalog), fish species or fishing gear; null for an unknown id. */
export function iconMatrixFor(id: string): string[][] | null {
  const clothing = itemIconMatrix(id);
  if (clothing) return clothing;
  const icon = FISH_ICONS[id] ?? GEAR_ICONS[id];
  return icon ? pixelIconMatrix(icon) : null;
}
