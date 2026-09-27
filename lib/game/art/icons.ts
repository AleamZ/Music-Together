import { FARM_ICONS } from "./farm-icons";
import { FISH_ICONS } from "./fish";
import { GEAR_ICONS } from "./gear";
import { ITEM_ART, type ItemArt } from "./items";
import { OUTLINE } from "./palettes";
import { DEFAULT_LOOK } from "@/lib/game/look";
import type { Look } from "@/lib/game/types";
import { composeMatrix } from "./compose";
import { GARMENT_ART, type GarmentSlot } from "./garments";
import { SPRITE_H, SPRITE_W } from "./layers";

export const ICON_SIZE = 16;

export type IconKind = "nonla" | "taibeo" | "baba" | "tee" | "shorts" | "long" | "dep" | "khanran" | "skirt"
  | "chain" | "pearls" | "bracelet" | "watch" | "star" | "bow" | "headband" | "flower" | "tie"
  | "cap" | "beanie" | "fedora" | "sunhat" | "helmet" | "coi" | "bucket" | "crown" | "antlers" | "cowboy";

// Inventory icons, one per item kind; colours come from each item's ITEM_ART (so a new item of an
// existing kind needs no new art). Codes: . transparent · o outline · y/Y/Z straw · x/X fabric
// · t/T/u/K top main/shade/highlight/detail · p/P/l bottom main/shade/stripe · f/F sandal strap/sole · q/Q scarf checks.
/** A symmetric 16×16 icon from its left halves (8 columns each, mirrored), padded to 16 rows from `top`. */
function mirrored(top: number, halves: readonly string[]): string[] {
  const rows = halves.map((h) => h + [...h].reverse().join(""));
  const empty = ".".repeat(16);
  return Array.from({ length: 16 }, (_, y) => rows[y - top] ?? empty);
}

// Accessory icons (v18.6). Codes: c main · C shade · D accent (pendant, beads, watch face, knot, flower centre).
const ACCESSORY_ICONS = {
  // a chain loop with a pendant
  chain: mirrored(1, [
    "...oo...", "..ocCo..", "..oCco..", "..ocCo..", "...oCco.", "....ocCo", ".....oCc", "......oD", ".....oDD", ".....oDD", "......oD", ".......o",
  ]),
  // a pearl string: round beads, shade between
  pearls: mirrored(2, [
    "...oo...", "..ocCo..", "..oCco..", "..ocCo..", "..oCco..", "...ocCo.", "....ocCc", ".....ooo",
  ]),
  // a bracelet ring seen at an angle (beads in the accent colour)
  bracelet: mirrored(3, [
    ".....ooo", "...ooccD", "..ocDooo", ".ocCo...", ".oCco...", ".ocCo...", "..oCDooo", "...ooCCD", ".....ooo",
  ]),
  // a wristwatch: the strap above and below a round face with hands
  watch: [
    "................",
    "......oooo......",
    "......occo......",
    "......oCCo......",
    "......occo......",
    ".....oooooo.....",
    "....ooDDDDoo....",
    "....oDDoDDDoC...",
    "....oDDooDDoC...",
    "....oDDDDDDo....",
    "....ooDDDDoo....",
    ".....oooooo.....",
    "......occo......",
    "......oCCo......",
    "......occo......",
    "......oooo......",
  ],
  // a star hair clip
  star: mirrored(2, [
    ".......o", "......oc", "......oc", ".ooooocD", ".occcccD", "..oCcccc", "...oCccc", "...oCccc", "..oCCooo", "..oCo...", "..oo....",
  ]),
  // a bow with a knot
  bow: mirrored(3, [
    "..oo....", ".occo...", ".occCo..", ".occcCoo", ".occcCoD", ".occcCoD", ".occcCoo", ".occCo..", ".occo...", "..oo....",
  ]),
  // a headband's arc (also the sports band)
  headband: mirrored(3, [
    ".....ooo", "...ooccc", "..occCCC", ".occCooo", ".ocCo...", "ocCo....", "ocCo....", "ocCo....", "oCCo....", ".oo.....",
  ]),
  // a flower clip: five petals round a coloured centre
  flower: mirrored(2, [
    "......oo", ".....occ", "..oo.occ", ".occooCc", ".occcoCD", ".oCccoCD", "..oCCocc", "...occCo", "..occCo.", "..oCCo..", "...oo...",
  ]),
  // a scrunchie loop
  tie: mirrored(4, [
    ".....ooo", "...ooccC", "..occooo", "..oco...", "..oCo...", "..oCCooo", "...ooCCc", ".....ooo",
  ]),
};

// Hat icons (v18.6), in the hats' codes: x/X fabric · y/Y/Z straw, gold · b/B band, brim · g accent.
const HAT_ICONS = {
  cap: [
    "................", "................", "................", ".......oo.......", "....oooxxooo....", "...oxxxxxxxXo...",
    "..oxxxxggxxxXo..", "..oxxxxggxxxXo..", "..oxxxxxxxxxXo..", "..oXXXXXXXXXXXoo", "..obbbbbbbbbbbbo",
    "...oBBBBBBBBBBBo", "....ooooooooooo.", "................", "................", "................",
  ],
  beanie: mirrored(1, [
    "......oo", ".....ogg", ".....ogg", "....oooo", "...oxxxx", "..oxxXxx", ".oxxXxxX", ".oxXxxXx", ".oxXxxXx",
    ".obbbbbb", ".obBbBbB", ".oBBBBBB", "..oooooo",
  ]),
  fedora: [
    "................", "................", "................", "................", ".....ooo.ooo....", "....oxxxoxxXo...",
    "....oxxxXxxXo...", "....oxxxxxxXo...", "....obbbbbbBo...", "..oooBBBBBBBooo.", ".oxxxxxxxxxxxxXo",
    ".oXXXXXXXXXXXXXo", "..ooooooooooooo.", "................", "................", "................",
  ],
  sunhat: [
    "................", "................", "................", "................", "......oooo......", ".....oxxxxo.....",
    "....oxxxxxXo....", "....obbbbgbo....", "..ooxxxxgxgxoo..", ".oxxxxxxxxxxxxXo", "oxxxxxxxxxxxxxXo",
    "oXXo........oXXo", ".oo..........oo.", "................", "................", "................",
  ],
  helmet: mirrored(3, [
    ".....ooo", "...ooxgx", "..oxgxxx", ".oxgxxxx", ".oxxxxxx", ".oxxxxxx", ".oXXXXXX", "..oooooo", "..o.....", "...o....", "....oooo",
  ]),
  coi: mirrored(2, [
    "......oo", ".....oxx", "....oxxx", "...oxxxx", "...oxxxx", "..oxxxxg", "..oxxxgb", "..oxxxxg", "oooxxxxx", "oxxxxxxx", "oXXXXXXX", ".ooooooo",
  ]),
  bucket: mirrored(3, [
    "....oooo", "...oxxxx", "..oxxxxx", "..oxxxxx", "..obbbbb", ".oxxxxxx", "oxxxxxxx", "oXXXXXXX", ".ooooooo",
  ]),
  crown: mirrored(3, [
    ".o......", "ogo..o..", "oyo.oyo.", "oyyoyyyo", "oyyyyyyy", "oYYYYYYY", "oyygyyyb", "oZZZZZZZ", ".ooooooo",
  ]),
  antlers: mirrored(1, [
    ".o...o..", "oxo.oxo.", "oxooxo..", ".oxxoxo.", "..oxxo..", "...oxo..", "...oxo..", "..obbooo", "..obbbbb", "...ooooo",
  ]),
  cowboy: [
    "................", "................", "................", "....ooo..ooo....", "...oyyyoyyyYo...", "...oyyYYYyyYo...",
    "oo.oyyyyyyyYo.oo", "oyooyyyyyyyYooYo", "oyyobbbbbbbBoYYo", ".oyyyyyyyyyyyYo.", "..oZZZZZZZZZZo..",
    "...oooooooooo...", "................", "................", "................", "................",
  ],
};

export const ITEM_ICONS: Record<IconKind, readonly string[]> = {
  ...ACCESSORY_ICONS,
  ...HAT_ICONS,
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
  // a scarf: the loop round the neck, a knot at the front, two fringed tails hanging down
  khanran: [
    "....oooooooo....",
    "...oqQqQqQqQo...",
    "..oqQo....oQqo..",
    "..oQqo....oqQo..",
    "..oqQQo..oQqQo..",
    "...oqQqooqQqo...",
    "....ooqQQqoo....",
    ".....oQqqQo.....",
    "....oqQo.oQqo...",
    "....oQqo..oqQo..",
    "...oqQqo..oQqQo.",
    "...oQqQo...oqQo.",
    "...oqQqo...oQqo.",
    "...oQqQo...oqQo.",
    "...oq.Qo...oQ.o.",
    "...o.o.o...o.o..",
  ],
  // a flared skirt with pleats
  skirt: [
    "................",
    "................",
    "....oooooooo....",
    "....olllllllo...",
    "....oppppppPo...",
    "...opppppppPPo..",
    "...oppPpppPpPo..",
    "..opppPpppPppPo.",
    "..oppPppppPpppPo",
    ".opppPppppPpppPo",
    ".oppPpppppPppppo",
    "opppPppppppPpppo",
    "oPPPPPPPPPPPPPPo",
    ".oooooooooooooo.",
    "................",
    "................",
  ],
};

function kindOf(art: ItemArt, id: string): IconKind {
  switch (art.slot) {
    case "hat": return art.shape;
    case "top": return art.kind;
    case "bottom": return art.kind === "shorts" && id.includes("skirt") ? "skirt" : art.kind;
    case "shoes": return "dep";
    case "neck": return art.style === "pearl" ? "pearls" : art.style ? "chain" : "khanran";
    case "wrist": return art.kind === "watch" ? "watch" : "bracelet";
    case "hairpin": return art.kind === "headband" || art.kind === "bandana" ? "headband" : art.kind;
  }
}

function paletteOf(art: ItemArt): Record<string, string> {
  switch (art.slot) {
    case "hat": return { ...art.colors };
    case "top": { const [t, T, u, K] = art.colors; return { t, T, u, K }; }
    case "bottom": { const [p, P, l] = art.colors; return { p, P, l }; }
    case "shoes": { const [f, F] = art.colors; return { f, F }; }
    case "neck": {
      if (art.style) { const [c, C, D] = art.colors; return { c, C, D }; }
      const [q, Q] = art.colors; return { q, Q };
    }
    case "wrist":
    case "hairpin": { const [c, C, D] = art.colors; return { c, C, D }; }
  }
}

/** 16×16 CSS colours ("" = transparent) for a catalog item's icon; null for an unknown id. */
export function itemIconMatrix(id: string): string[][] | null {
  const art = ITEM_ART[id];
  if (!art) return null;
  const pal: Record<string, string> = { o: OUTLINE, ...paletteOf(art) };
  return ITEM_ICONS[kindOf(art, id)].map((row) => [...row].map((ch) => (ch === "." ? "" : pal[ch] ?? "")));
}

// the sprite rows each garment slot covers (front view), cropped for its icon
const GARMENT_ROWS: Record<GarmentSlot, [number, number]> = { top: [19, 32], bottom: [30, 43], outfit: [18, 43], shoes: [42, 47] };

/** Copies the painted pixels of `m` (rows y0..y1, columns c0..c1) into `out`'s box (columns boxX..boxX+boxW-1, full
 *  height), shrunk to fit or enlarged by a whole factor, centred (nearest pixel). False when nothing is painted there. */
function fit(m: string[][], y0: number, y1: number, c0: number, c1: number, out: string[][], boxX: number, boxW: number): boolean {
  let x0 = SPRITE_W, x1 = -1, top = SPRITE_H, bot = -1;
  for (let y = y0; y <= y1; y++) for (let x = c0; x <= c1; x++) {
    if (!m[y][x]) continue;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); top = Math.min(top, y); bot = Math.max(bot, y);
  }
  if (x1 < 0) return false;
  const w = x1 - x0 + 1, h = bot - top + 1;
  // enlarge by a whole factor when one fits; tiny parts (a single shoe) may take a fractional one to fill the box
  const fitUp = Math.min(boxW / w, ICON_SIZE / h);
  const up = Math.floor(fitUp) >= 2 || boxW === ICON_SIZE ? Math.floor(fitUp) : fitUp;
  const k = up >= 1 ? 1 / up : Math.max(w / boxW, h / ICON_SIZE);
  const ow = Math.min(boxW, Math.round(w / k)), oh = Math.min(ICON_SIZE, Math.round(h / k));
  const ox = boxX + Math.floor((boxW - ow) / 2), oy = Math.floor((ICON_SIZE - oh) / 2);
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    out[oy + y][ox + x] = m[top + Math.min(h - 1, Math.floor(y * k))][x0 + Math.min(w - 1, Math.floor(x * k))];
  }
  return true;
}
const garmentIcons = new Map<string, string[][] | null>();

/** The shape-based garments (fm_*): the garment worn by a bare mannequin, front view, cropped to its slot's rows and
 *  shrunk (nearest pixel) to fit 16×16, centred. Cached. */
export function garmentIconMatrix(id: string): string[][] | null {
  if (garmentIcons.has(id)) return garmentIcons.get(id)!;
  const art = GARMENT_ART[id];
  let out: string[][] | null = null;
  if (art) {
    const look: Look = {
      ...DEFAULT_LOOK, hat: null, neck: null, gender: art.gender === "nu" ? "nu" : "nam",
      [art.slot]: id, ...(art.slot === "outfit" ? {} : { outfit: null }),
    };
    const m = composeMatrix(look, "down", 0);
    const [y0, y1] = GARMENT_ROWS[art.slot];
    const grid = Array.from({ length: ICON_SIZE }, () => new Array<string>(ICON_SIZE).fill(""));
    // shoes are tiny on the sprite: each foot is enlarged into its own half of the icon
    const parts: Array<[number, number, number, number]> = art.slot === "shoes"
      ? [[0, SPRITE_W / 2 - 1, 0, 8], [SPRITE_W / 2, SPRITE_W - 1, 8, 8]]
      : [[0, SPRITE_W - 1, 0, ICON_SIZE]];
    let drawn = false;
    for (const [c0, c1, boxX, boxW] of parts) drawn = fit(m, y0, y1, c0, c1, grid, boxX, boxW) || drawn;
    out = drawn ? grid : null;
  }
  garmentIcons.set(id, out);
  return out;
}

/** A 16×16 icon with its own palette ("." transparent, "o" outline) — fish and gear (v14), farm items (v15). */
export interface PixelIcon { rows: readonly string[]; pal: Readonly<Record<string, string>> }

/** 16×16 CSS colours ("" = transparent). */
export function pixelIconMatrix(icon: PixelIcon): string[][] {
  return icon.rows.map((row) => [...row].map((ch) => (ch === "." ? "" : ch === "o" ? OUTLINE : icon.pal[ch] ?? "")));
}

/** Any item's icon: clothing (catalog), fish species, fishing gear or farm items (and rice_wet / rice_dry);
 *  null for an unknown id. */
export function iconMatrixFor(id: string): string[][] | null {
  const clothing = itemIconMatrix(id) ?? garmentIconMatrix(id);
  if (clothing) return clothing;
  const icon = FISH_ICONS[id] ?? GEAR_ICONS[id] ?? FARM_ICONS[id];
  return icon ? pixelIconMatrix(icon) : null;
}
