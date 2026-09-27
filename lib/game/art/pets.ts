import type { PetSpecies } from "@/lib/game/pets/catalog";
import type { PetLook } from "@/lib/game/pets/model";
import type { Facing } from "@/lib/game/types";

// v18.12 Thú cưng: the pets, 16 px wide chibi sprites anchored at the middle of the bottom row, for down, up and right
// (left mirrors right), each in three poses (0 stand, 1 and 2 the steps; the walk cycle is 1-0-2-0). Letters: o outline,
// b fur/feathers, s shade, l belly/muzzle, e eyes, n nose, p pink (ears, nose), k beak, w wing, f feet. Fashion is
// painted on top: body clothes recolour the body rows, neckwear recolours the neck row, hats sit on the head's top.
// Original art.

export const PET_W = 16;

interface Pose { rows: readonly string[]; legs: readonly [readonly string[], readonly string[], readonly string[]] }
/** Rows (from the top) of the neck and of the body (clothes), and where a hat's bottom middle sits. */
interface Meta { neck: number; bodyTop: number; bodyBottom: number; hat: { x: number; y: number } }
interface Views { right: Pose & Meta; down: Pose & Meta; up: Pose & Meta }

const QUAD_LEGS = [
  ["....bs....bs....", "....oo....oo...."],
  ["...bs......bs...", "...oo......oo..."],
  [".....bs..bs.....", ".....oo..oo....."],
] as const;
const FRONT_LEGS = [
  [".....bb..bb.....", ".....oo..oo....."],
  ["....bb...bb.....", "....oo....oo...."],
  [".....bb...bb....", "....oo....oo...."],
] as const;
const SMALL_FEET = [["....oo....oo...."], ["...oo......oo..."], [".....oo..oo....."]] as const;
const SMALL_FRONT = [[".....oo..oo....."], ["....oo....oo...."], [".....oo...oo...."]] as const;
const BIRD_FEET = [["......ff.ff....."], [".....ff...ff...."], ["......f..ff....."]] as const;
const BIRD_FRONT = [[".....ff..ff....."], ["....ff...ff....."], [".....ff...ff...."]] as const;

const CHO: Views = {
  right: {
    rows: [
      "..........ooo...",
      ".........obbbo..",
      "........obbbbbo.",
      "........obbebbbo",
      "..o.....osbbblln",
      ".obo....osbbllo.",
      ".obo...obbbbbo..",
      "..obooobbbbbbo..",
      "...obbbbbbbbbo..",
      "...obbbbbbbbbo..",
      "...osllllllllo..",
    ],
    legs: QUAD_LEGS, neck: 6, bodyTop: 7, bodyBottom: 10, hat: { x: 11, y: 0 },
  },
  down: {
    rows: [
      ".....oooooo.....",
      "....obbbbbbo....",
      "..oosbbbbbbsoo..",
      "..ossbebbebsso..",
      "..osobllllboso..",
      "...oobbnnbboo...",
      ".....obllbo.....",
      "....obbbbbbo....",
      "...obbllllbbo...",
      "...obbllllbbo...",
      "...osbbbbbbso...",
    ],
    legs: FRONT_LEGS, neck: 6, bodyTop: 7, bodyBottom: 10, hat: { x: 8, y: 0 },
  },
  up: {
    rows: [
      ".....oooooo.....",
      "....obbbbbbo....",
      "..oosbbbbbbsoo..",
      "..ossbbbbbbsso..",
      "..osobbbbbboso..",
      "...oobbbbbboo...",
      ".....obbbbo.....",
      "....obbobbbo....",
      "...obbbobbbbo...",
      "...obbbbbbbbo...",
      "...osbbbbbbso...",
    ],
    legs: FRONT_LEGS, neck: 6, bodyTop: 7, bodyBottom: 10, hat: { x: 8, y: 0 },
  },
};

const MEO: Views = {
  right: {
    rows: [
      "........o....o..",
      "........oo..oo..",
      ".o......obooobo.",
      "obo.....obbbbbo.",
      "obo.....obbbebo.",
      ".obo....obbbbbp.",
      "..obo..oobllbo..",
      "...obsbbsbbbo...",
      "...obbsbbsbbo...",
      "...osllllllso...",
    ],
    legs: QUAD_LEGS, neck: 6, bodyTop: 7, bodyBottom: 9, hat: { x: 11, y: 1 },
  },
  down: {
    rows: [
      "...o........o...",
      "...oo......oo...",
      "...oboooooobo...",
      "...obbbbbbbbo...",
      "...obebbbbebo...",
      "...obbbppbbbo...",
      "....obllllbo....",
      ".....obbbbo.....",
      "....obbbbbbo....",
      "...obbllllbbo...",
      "...obbllllbbo...",
      "...osbbbbbbso...",
    ],
    legs: FRONT_LEGS, neck: 7, bodyTop: 8, bodyBottom: 11, hat: { x: 8, y: 1 },
  },
  up: {
    rows: [
      "...o........o...",
      "...oo......oo...",
      "...oboooooobo...",
      "...obbbbbbbbo...",
      "...obsbbbbsbo...",
      "...obbbbbbbbo...",
      "....obbbbbbo....",
      ".....obbbbo.....",
      "....obbsbbbo....",
      "...obbbsbbbbo...",
      "...obbbbsbbbo...",
      "...osbbbsbbso...",
    ],
    legs: FRONT_LEGS, neck: 7, bodyTop: 8, bodyBottom: 11, hat: { x: 8, y: 1 },
  },
};

const THO: Views = {
  right: {
    rows: [
      ".........o.o....",
      "........opopo...",
      "........opopo...",
      "........obobo...",
      ".......obbbbbo..",
      ".......obbbebbo.",
      ".......obbbbbpo.",
      "...oo..oblllbo..",
      "..olloobbbbbo...",
      "..ollbbbbbbbo...",
      "...obbbbbbbbo...",
      "...osllllllso...",
    ],
    legs: SMALL_FEET, neck: 7, bodyTop: 8, bodyBottom: 11, hat: { x: 10, y: 3 },
  },
  down: {
    rows: [
      ".....o....o.....",
      "....opo..opo....",
      "....opo..opo....",
      "....obo..obo....",
      "...obbbbbbbbo...",
      "...obebbbbebo...",
      "...obbbppbbbo...",
      "....obllllbo....",
      "...obbllllbbo...",
      "...obbllllbbo...",
      "...osbbbbbbso...",
    ],
    legs: SMALL_FRONT, neck: 7, bodyTop: 8, bodyBottom: 10, hat: { x: 8, y: 3 },
  },
  up: {
    rows: [
      ".....o....o.....",
      "....obo..obo....",
      "....obo..obo....",
      "....obo..obo....",
      "...obbbbbbbbo...",
      "...obbbbbbbbo...",
      "...obbbbbbbbo...",
      "....obbbbbbo....",
      "...obbbllbbbo...",
      "...obbbllbbbo...",
      "...osbbbbbbso...",
    ],
    legs: SMALL_FRONT, neck: 7, bodyTop: 8, bodyBottom: 10, hat: { x: 8, y: 3 },
  },
};

const HAMSTER: Views = {
  right: {
    rows: [
      "........oo......",
      ".....oooopoo....",
      "....obbbbbbbo...",
      "...obbbbbbebo...",
      "...obbbbbbbbpo..",
      "...obllllbbbo...",
      "...olllllllo....",
    ],
    legs: SMALL_FEET, neck: 4, bodyTop: 5, bodyBottom: 6, hat: { x: 8, y: 1 },
  },
  down: {
    rows: [
      "....oo....oo....",
      "....opoooopo....",
      "...obbbbbbbbo...",
      "...obebbbbebo...",
      "...obllppllbo...",
      "...ollllllllo...",
      "....ollllllo....",
    ],
    legs: SMALL_FRONT, neck: 4, bodyTop: 5, bodyBottom: 6, hat: { x: 8, y: 1 },
  },
  up: {
    rows: [
      "....oo....oo....",
      "....oboooobo....",
      "...obbbbbbbbo...",
      "...obbbbbbbbo...",
      "...obbbbbbbbo...",
      "...obbbbbbbbo...",
      "....osbbbbso....",
    ],
    legs: SMALL_FRONT, neck: 4, bodyTop: 5, bodyBottom: 6, hat: { x: 8, y: 1 },
  },
};

const SOC: Views = {
  right: {
    rows: [
      "..oo............",
      ".osso....o.o....",
      "ossbso..obobo...",
      "osbbso..obbbbo..",
      "osbbso.obbbebo..",
      ".osbbsoobbbbbpo.",
      "..osbbobblllbo..",
      "...osbbbbbbbo...",
      "....obbbbbbo....",
      "....olllllbo....",
    ],
    legs: SMALL_FEET, neck: 6, bodyTop: 7, bodyBottom: 9, hat: { x: 11, y: 2 },
  },
  down: {
    rows: [
      "...........oo...",
      "..........osso..",
      "...o...o.osbbso.",
      "...oboobooobbso.",
      "..obbbbbbbosbso.",
      "..obebbbbeboso..",
      "..obbbppbbbo....",
      "...obllllbo.....",
      "..obbllllbbo....",
      "..obbllllbbo....",
      "..osbbbbbbso....",
    ],
    legs: SMALL_FRONT, neck: 7, bodyTop: 8, bodyBottom: 10, hat: { x: 7, y: 3 },
  },
  up: {
    rows: [
      "....oo..........",
      "...osso.........",
      "..osbbso.o...o..",
      "..osbbsooboobo..",
      "..osbsoobbbbbbo.",
      "...osoobbbbbbo..",
      ".....obbbbbbbo..",
      "......obbbbbo...",
      ".....obbbbbbbo..",
      ".....obbbbbbbo..",
      ".....osbbbbbso..",
    ],
    legs: SMALL_FRONT, neck: 7, bodyTop: 8, bodyBottom: 10, hat: { x: 10, y: 3 },
  },
};

const VET: Views = {
  right: {
    rows: [
      "........ooo.....",
      ".......obbbo....",
      "......obbebkko..",
      "......obbbbkko..",
      ".....obbbbbko...",
      ".....owwbbbo....",
      ".....owwwbbo....",
      ".....owwwllo....",
      "......owwllo....",
      "......oswso.....",
      ".......oso......",
    ],
    legs: BIRD_FEET, neck: 4, bodyTop: 5, bodyBottom: 8, hat: { x: 9, y: 0 },
  },
  down: {
    rows: [
      "......oooo......",
      ".....obbbbo.....",
      "....obebbebo....",
      "....obbkkbbo....",
      "....obbkkbbo....",
      "....owbbbbwo....",
      "...owwllllwwo...",
      "...owwllllwwo...",
      "....owllllwo....",
      ".....osssso.....",
    ],
    legs: BIRD_FRONT, neck: 5, bodyTop: 6, bodyBottom: 8, hat: { x: 8, y: 0 },
  },
  up: {
    rows: [
      "......oooo......",
      ".....obbbbo.....",
      "....obbbbbbo....",
      "....obbbbbbo....",
      "....obbbbbbo....",
      "....owwbbwwo....",
      "...owwwwwwwwo...",
      "...owwwwwwwwo...",
      "....owwwwwwo....",
      ".....osssso.....",
      "......osso......",
    ],
    legs: BIRD_FRONT, neck: 5, bodyTop: 6, bodyBottom: 8, hat: { x: 8, y: 0 },
  },
};

const VIEWS: Readonly<Record<PetSpecies, Views>> = { cho: CHO, meo: MEO, tho: THO, hamster: HAMSTER, soc: SOC, vet: VET };

type Pal = Record<string, string>;
const BASE: Pal = { o: "#2a1d14", e: "#1a1210", n: "#2a1d14", p: "#e8909e", k: "#f2b632", f: "#d49a4a" };
const fur = (b: string, s: string, l: string, extra: Pal = {}): Pal => ({ ...BASE, b, s, l, w: s, ...extra });

/** Each species' variants (lib/game/pets/catalog.ts names them). */
export const PET_PALETTES: Readonly<Record<PetSpecies, Readonly<Record<string, Pal>>>> = {
  cho: {
    vang: fur("#d9a24e", "#a8742f", "#f3dcae"),
    nau: fur("#8a5a32", "#5e3b1f", "#d4b08a"),
    trang: fur("#f1ece2", "#c9bfae", "#ffffff"),
  },
  meo: {
    cam: fur("#e8964a", "#b8662a", "#f8e2c4"),
    den: fur("#3a3438", "#1f1b1e", "#6a6268", { e: "#e8c84a", o: "#141012" }),
    trang: fur("#f4f1ec", "#cfc6ba", "#ffffff", { e: "#4a8ad8" }),
  },
  tho: {
    trang: fur("#f4f1ec", "#d2c8ba", "#ffffff", { e: "#c0303a" }),
    nau: fur("#a8764a", "#7a5030", "#e8d0b0"),
    xam: fur("#9a9894", "#6e6c68", "#e0dcd6"),
  },
  hamster: {
    vang: fur("#e0a860", "#b07a3a", "#fbe8c8"),
    trang: fur("#f5f1ea", "#d2c8ba", "#ffffff"),
    xam: fur("#a8a4a0", "#7c7874", "#e4e0da"),
  },
  soc: {
    nau: fur("#9a6232", "#6a3e1a", "#e8c89a"),
    do: fur("#c2562a", "#8a3414", "#f0c8a0"),
    xam: fur("#8e8a86", "#625e5a", "#dcd6ce"),
  },
  vet: {
    xanh: { ...BASE, b: "#4caf50", s: "#2e7d32", w: "#2e7d32", l: "#c6e86a", k: "#f2b632", f: "#7a6a5a" },
    do: { ...BASE, b: "#d9362b", s: "#9a2019", w: "#2f6fd1", l: "#f2c230", k: "#e8e2d6", f: "#7a6a5a" },
    lam: { ...BASE, b: "#2f86d6", s: "#1c5c9e", w: "#1c5c9e", l: "#f2c230", k: "#3a3438", f: "#7a6a5a" },
  },
};

// ---------------------------------------------------------------- fashion

/** Hats: rows bottom-aligned on the head's top, centred on its x. Letters are colours. */
const HATS: Readonly<Record<string, { rows: readonly string[]; pal: Pal }>> = {
  cho_party: { rows: ["..y..", "..r..", ".rbr.", ".brb.", "rbrbr"], pal: { y: "#f6d24a", r: "#d9362b", b: "#3d6fd1" } },
  meo_bow: { rows: ["pp.pp", "ppkpp", "p...p"], pal: { p: "#f07aa6", k: "#b83a6e" } },
  tho_bow: { rows: ["rr.rr", "rrkrr"], pal: { r: "#d9362b", k: "#8a1f18" } },
  vet_tophat: { rows: [".kkk.", ".kkk.", ".rrr.", "kkkkk"], pal: { k: "#1f1b1e", r: "#c0303a" } },
  soc_nonla: { rows: ["...y...", "..yty..", ".yyyyy.", "ttttttt"], pal: { y: "#e8cf7a", t: "#b8964a" } },
  hamster_beanie: { rows: ["..w..", ".rrr.", "rwrwr"], pal: { w: "#f4f1ec", r: "#c0303a" } },
};
/** Neckwear: the neck row's colour, and a charm hanging under its middle (null: none). */
const NECKS: Readonly<Record<string, { band: string; charm: string | null; tail?: string }>> = {
  cho_collar: { band: "#d9362b", charm: "#f6d24a" },
  cho_bandana: { band: "#3d6fd1", charm: "#3d6fd1" },
  meo_bell: { band: "#f07aa6", charm: "#f6d24a" },
  vet_bowtie: { band: "#d9362b", charm: null },
  soc_scarf: { band: "#2e9a94", charm: null, tail: "#2e9a94" },
  hamster_scarf: { band: "#e07a2e", charm: null, tail: "#e07a2e" },
};
/** Clothes: the body rows' fur becomes the knit (stripes alternate a and b row by row). */
const BODIES: Readonly<Record<string, { a: string; b: string }>> = {
  cho_sweater: { a: "#c0303a", b: "#f4f1ec" },
  meo_sweater: { a: "#3f8a5a", b: "#2e6a44" },
  tho_vest: { a: "#3d6fd1", b: "#2a52a8" },
};

export type PetPixels = ReadonlyArray<ReadonlyArray<string | null>>;
const cache = new Map<string, PetPixels>();

/** The pet's pixels (colours or null), mirrored for "left"; the anchor is (8, last row). Cached. */
export function petPixels(look: PetLook, facing: Facing, pose: 0 | 1 | 2): PetPixels {
  const key = `${look.species}.${look.variant}.${look.head}.${look.neck}.${look.body}|${facing}|${pose}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const view = VIEWS[look.species][facing === "left" ? "right" : facing];
  const pal = PET_PALETTES[look.species][look.variant] ?? Object.values(PET_PALETTES[look.species])[0];
  const letters = [...view.rows, ...view.legs[pose]];
  let grid: Array<Array<string | null>> = letters.map((r) => [...r].slice(0, PET_W).map((ch) => (ch === "." ? null : pal[ch] ?? pal.b)));
  const knit = look.body ? BODIES[look.body] : undefined;
  if (knit) {
    for (let y = view.bodyTop; y <= view.bodyBottom && y < grid.length; y++) {
      [...letters[y]].forEach((ch, x) => { if (ch === "b" || ch === "s" || ch === "l") grid[y][x] = (y - view.bodyTop) % 2 ? knit.b : knit.a; });
    }
  }
  const neck = look.neck ? NECKS[look.neck] : undefined;
  if (neck) {
    const row = [...letters[view.neck]];
    const inside = row.map((ch, x) => (ch !== "." && ch !== "o" ? x : -1)).filter((x) => x >= 0);
    for (const x of inside) grid[view.neck][x] = neck.band;
    if (inside.length > 0) {
      const mid = facing === "right" || facing === "left" ? inside[inside.length - 1] : inside[Math.floor(inside.length / 2)];
      if (neck.charm && view.neck + 1 < grid.length && facing !== "up") grid[view.neck + 1][mid] = neck.charm;
      if (neck.tail && view.neck + 1 < grid.length) grid[view.neck + 1][inside[0]] = neck.tail;
    }
  }
  const hat = look.head ? HATS[look.head] : undefined;
  let top = 0;
  if (hat) {
    const hw = hat.rows[0].length, hh = hat.rows.length;
    const y0 = view.hat.y - hh;
    if (y0 < 0) {
      top = -y0;
      grid = [...Array.from({ length: top }, () => new Array<string | null>(PET_W).fill(null)), ...grid];
    }
    const x0 = view.hat.x - Math.floor(hw / 2);
    hat.rows.forEach((r, j) => [...r].forEach((ch, i) => {
      const x = x0 + i, y = y0 + top + j;
      if (ch !== "." && x >= 0 && x < PET_W && y >= 0) grid[y][x] = hat.pal[ch];
    }));
  }
  if (facing === "left") grid = grid.map((r) => [...r].reverse());
  cache.set(key, grid);
  return grid;
}

/** How high a parrot flies over its ground spot at `t` (shoulder height, bobbing; still under reduced motion). */
export function petAltitude(look: Pick<PetLook, "species">, t: number, reduced = false): number {
  if (look.species !== "vet") return 0;
  return PARROT_ALT + (reduced ? 0 : Math.round(Math.sin(t / 320) * 2));
}
const PARROT_ALT = 24;

/** Draw the pet with its feet at (x, y) (screen px), with a small shadow. A parrot flies: its shadow stays on the
 *  ground, the bird hovers at shoulder height and flaps its wings (`t` ms drives the bob and the flap). */
export function drawPet(c: CanvasRenderingContext2D, look: PetLook, facing: Facing, pose: 0 | 1 | 2, x: number, y: number, t = 0, reduced = false): void {
  const alt = petAltitude(look, t, reduced);
  const px = petPixels(look, facing, alt ? 0 : pose);
  const h = px.length, ox = Math.round(x) - 8, oy = Math.round(y) - h + 1 - alt;
  c.fillStyle = "rgba(40, 25, 10, 0.25)";
  if (alt) c.fillRect(ox + 5, Math.round(y) - 1, 6, 2);
  else c.fillRect(ox + 4, oy + h - 1, 8, 2);
  if (alt) {
    // the wings: a small outlined blade on each side of the body, up or down every 110 ms
    const pal = PET_PALETTES.vet[look.variant] ?? PET_PALETTES.vet.xanh;
    const mid = Math.floor(h / 2);
    const row = px[mid] ?? [];
    const xs = row.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    const l = xs.length ? xs[0] : 5, r = xs.length ? xs[xs.length - 1] : 10;
    const up = reduced ? true : Math.floor(t / 110) % 2 === 0;
    const wy = oy + mid + (up ? -3 : 1);
    const blade = (wx: number) => {
      c.fillStyle = pal.o; c.fillRect(wx - 1, wy - 1, 5, 4);
      c.fillStyle = pal.w; c.fillRect(wx, wy, 3, 2);
    };
    if (facing === "left" || facing === "right") blade(ox + Math.round((l + r) / 2) - 1);
    else { blade(ox + l - 3); blade(ox + r + 1); }
  }
  for (let j = 0; j < h; j++) {
    const row = px[j];
    let i = 0;
    while (i < row.length) {
      const col = row[i];
      if (!col) { i++; continue; }
      let k = i + 1;
      while (k < row.length && row[k] === col) k++;
      c.fillStyle = col;
      c.fillRect(ox + i, oy + j, k - i, 1);
      i = k;
    }
  }
}

/** The height of a pet's sprite (for bubbles over it). */
export const petHeight = (look: PetLook): number => petPixels(look, "down", 0).length;
