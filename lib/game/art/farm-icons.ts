import type { PixelIcon } from "./icons";

// 16×16 icons for the farm (spec §14, v15.2 §15, v15.3 §15, v17 §14): seed sacks in the variety's colour, fertilizer
// bags with their nutrient on the label, pesticide bottles with their pest, rice sacks (wet/dry); hoa-màu seeds, the
// sickle, the sprayer and the hoa màu itself; the critter containers and the critters; the ná, its pellets, the dog's
// food and bowl, and the rat. "." transparent, "o" outline, other letters from the icon's own palette. Original art.

const SEED_SACK = [
  "................",
  "......oooo......",
  ".....oTttTo.....",
  "......oTTo......",
  ".....orrrro.....",
  "....osssssSo....",
  "...osssssssSo...",
  "..osssssgssSSo..",
  "..ossssgYgsSSo..",
  "..osssgYgssSSo..",
  "..ossgYgsssSSo..",
  "..osssgssssSSo..",
  "..ossssssssSSo..",
  "...osssssssSo...",
  "....oooooooo....",
  "................",
];

const seedSack = (s: string, S: string): PixelIcon => ({
  rows: SEED_SACK,
  pal: { s, S, t: s, T: S, r: "#8b5a33", g: "#b8902a", Y: "#f6c945" },
});

/** "____" marks where a glyph row goes. */
const FERT_BAG = [
  "................",
  "...oooooooooo...",
  "..obbbbbbbbbBo..",
  "..obbbbbbbbbBo..",
  "..owwwwwwwwwWo..",
  "..oww____wwwWo..",
  "..oww____wwwWo..",
  "..oww____wwwWo..",
  "..oww____wwwWo..",
  "..oww____wwwWo..",
  "..owwwwwwwwwWo..",
  "..obbbbbbbbbBo..",
  "..obbbbbbbbbBo..",
  "..obbbbbbbbbBo..",
  "...oooooooooo...",
  "................",
];

const PESTICIDE_BOTTLE = [
  "................",
  "......oooo......",
  "......occo......",
  "......oooo......",
  ".......oo.......",
  "......oBBo......",
  ".....oBBbBo.....",
  "....oBBBBbBo....",
  "....owwwwwWo....",
  "....ow____Wo....",
  "....ow____Wo....",
  "....ow____Wo....",
  "....owwwwwWo....",
  "....oBBBBbBo....",
  ".....oooooo.....",
  "................",
];

/** Put a 4-wide glyph ("." = the label) into a template's "____" rows. */
function withGlyph(template: readonly string[], glyph: readonly string[]): string[] {
  let i = 0;
  return template.map((row) => (row.includes("____") ? row.replace("____", glyph[i++].replace(/\./g, "w")) : row));
}

const LABEL = { w: "#f4efe0", W: "#d8cfb8" };

const fertBag = (b: string, B: string, glyph: readonly string[], ink: Record<string, string>): PixelIcon => ({
  rows: withGlyph(FERT_BAG, glyph), pal: { b, B, ...LABEL, ...ink },
});

const bottle = (B: string, b: string, cap: string, glyph: readonly string[], ink: string): PixelIcon => ({
  rows: withGlyph(PESTICIDE_BOTTLE, glyph), pal: { B, b, c: cap, L: ink, ...LABEL },
});

const RICE_SACK = [
  "................",
  "................",
  ".....oooooo.....",
  "....oYyYYyYo....",
  "...osYYyYYYso...",
  "...ossYYYYsso...",
  "..osssssssssSo..",
  "..ossssssssSSo..",
  ".osssssssssSSSo.",
  ".ossssMMssssSSo.",
  ".osssMMMMsssSSo.",
  ".ossssMMssssSSo.",
  ".osssssssssSSSo.",
  "..osssssssssSo..",
  "...oooooooooo...",
  "................",
];

const riceSack = (Y: string, y: string, M: string): PixelIcon => ({
  rows: RICE_SACK, pal: { Y, y, M, s: "#c8a46a", S: "#a8844f" },
});

/** A paper seed packet; "____" rows carry the picture. */
const PACKET = [
  "................",
  "...oooooooooo...",
  "...oPPPPPPPPo...",
  "...oppppppppo...",
  "...o________o...",
  "...o________o...",
  "...o________o...",
  "...o________o...",
  "...o________o...",
  "...o________o...",
  "...o________o...",
  "...o________o...",
  "...oppppppppo...",
  "...oPPPPPPPPo...",
  "...oooooooooo...",
  "................",
];

/** Put an 8-wide picture ("." = the paper) into the packet's "________" rows. */
function packet(picture: readonly string[], ink: Record<string, string>): PixelIcon {
  let i = 0;
  return {
    rows: PACKET.map((row) => (row.includes("________") ? row.replace("________", picture[i++].replace(/\./g, "p")) : row)),
    pal: { p: "#f4efe0", P: "#d8cfb8", ...ink },
  };
}

// v15.2: a tied bundle of three khoai cuttings
const SEED_KHOAI: PixelIcon = {
  rows: [
    "................",
    "...oo.....oo....",
    "..oggo...oGgo...",
    "..oggGo.oGggo...",
    "...oGgGoggGo....",
    "....ogggGgo.....",
    "....oovvvoo.....",
    ".....ovVvo......",
    "....orrrrro.....",
    ".....ovVvo......",
    ".....ovVvo......",
    "....ovvoVvo.....",
    "....ovo.oVo.....",
    "...ovo...oVo....",
    "...oo.....oo....",
    "................",
  ],
  pal: { g: "#6fbf4a", G: "#4f9a38", v: "#8e4a8a", V: "#6e3a6a", r: "#8b5a33" },
};

const TOOL_SICKLE: PixelIcon = {
  rows: [
    "................",
    "......oooo......",
    "....oobbbboo....",
    "...obbeeeebbo...",
    "..obeo....oebo..",
    "..obo......obo..",
    "..oo.......obo..",
    "...........obo..",
    "..........oebo..",
    ".........oebo...",
    "........ohoo....",
    ".......ohHo.....",
    "......ohHo......",
    ".....ohHo.......",
    ".....ooo........",
    "................",
  ],
  pal: { b: "#5a5f68", e: "#e8e8ee", h: "#6e4424", H: "#4a2e18" },
};

const TOOL_SPRAYER: PixelIcon = {
  rows: [
    "................",
    "....oooooo......",
    "...ottttTTo.....",
    "o.otuttttTTo...n",
    "l.otuttttTTo...w",
    "l.otuttttTTo..w.",
    "l.oTTTTTTTTo..w.",
    "l.otttttTTTo..w.",
    "l.otttttTTTo.w..",
    "llotttttTTTo.w..",
    "..otttttTTTohh..",
    "..oTTTTTTTTo....",
    "...oTTTTTTo.....",
    "....oooooo......",
    "................",
    "................",
  ],
  pal: { t: "#3d6fd1", T: "#2f56a6", u: "#6f95e0", l: "#5a5f68", w: "#5a5f68", n: "#e8e8ee", h: "#2a2f3a" },
};

const PRODUCE_KHOAI: PixelIcon = {
  rows: [
    "................",
    "................",
    ".....oooo.......",
    "...ookjkkoo.....",
    "..okkjkkkkKo....",
    "..okkkkkkKKo....",
    "...ooKKKKKo.....",
    ".....ooooo......",
    "........oooo....",
    "......ookjkkoo..",
    ".....okkjkkkkKo.",
    ".....okkkkkkKKo.",
    "......ooKKKKKo..",
    "........ooooo...",
    "................",
    "................",
  ],
  pal: { k: "#b0486e", K: "#7e2f4e", j: "#d77a9a" },
};

const PRODUCE_BAP: PixelIcon = {
  rows: [
    "................",
    "..........oo....",
    ".........oyYo...",
    "........oyYyYo..",
    ".......oyYyYyo..",
    "......oyYyYyo...",
    ".....oyYyYyo....",
    "....oyYyYyo.....",
    "...ogyYyYo......",
    "..ogGgyYo.......",
    ".ogGgGgo........",
    ".oGgGgo.........",
    "..ooGo..........",
    "....o...........",
    "................",
    "................",
  ],
  pal: { y: "#f6c945", Y: "#e0b33c", g: "#8fbf5a", G: "#5f8f3a" },
};

const PRODUCE_OT: PixelIcon = {
  rows: [
    "................",
    "..s.....s....s..",
    ".oso...oso..oso.",
    ".oro...oro..oro.",
    ".orRo..orRo.orRo",
    ".orRo..orRo.orRo",
    ".orRo..orRo.orRo",
    "..orRo.orRo.orRo",
    "..orRo..orRo.oRo",
    "..orRo..orRo.oo.",
    "...orRo.oRo.....",
    "...orRo..oo.....",
    "....oRo.........",
    ".....o..........",
    "................",
    "................",
  ],
  pal: { r: "#d8342a", R: "#a82a22", s: "#4f9a38" },
};

// v15.3: a plastic bucket and a woven bamboo basket
const BOX_BUCKET: PixelIcon = {
  rows: [
    "................",
    ".....hhhhhh.....",
    "....h......h....",
    "...h........h...",
    "..oooooooooooo..",
    "..obbbbbbbbbBo..",
    "..oBBBBBBBBBBo..",
    "...obbbbbbbBo...",
    "...obbbbbbbBo...",
    "...obbbbbbbBo...",
    "...obbbbbbbBo...",
    "....obbbbbBo....",
    "....obbbbbBo....",
    "....oooooooo....",
    "................",
    "................",
  ],
  pal: { b: "#3d6fd1", B: "#2f56a6", h: "#d9d9e0" },
};

const BOX_BASKET: PixelIcon = {
  rows: [
    "................",
    "......oooo......",
    ".....o....o.....",
    "..oooooooooooo..",
    "..owWwWwWwWwWo..",
    "..oWWWWWWWWWWo..",
    "..owwWwwWwwWwo..",
    "...owWwwWwwWo...",
    "...oWwWWwWWwo...",
    "...owwWwwWwwo...",
    "....owWwwWwo....",
    "....oWwWWwWo....",
    ".....oooooo.....",
    "................",
    "................",
    "................",
  ],
  pal: { w: "#c8a46a", W: "#9a7a44" },
};

// the field crab from above, red-tipped claws raised; the cua gạch belly-up, its roe showing
const CRAB_TOP = [
  "................",
  "..rr........rr..",
  ".rrc........crr.",
  ".occ..e..e..cco.",
  "..oc..o..o..co..",
  "...oocccccccoo..",
  "..occCCCCCCcco..",
  ".occCCCCCCCCcco.",
  "o.ocCCCCCCCCco.o",
  ".oocCCCCCCCCcoo.",
  "o..occCCCCcco..o",
  ".o..occcccco..o.",
  "..o..oooooo..o..",
  "................",
  "................",
  "................",
];
const CRAB_BELLY = [
  ...CRAB_TOP.slice(0, 3),
  ".occ........cco.",
  "..oc........co..",
  CRAB_TOP[5],
  "..occgGGGGgcco..",
  ".occgGGggGGgcco.",
  "o.ocgGggggGgco.o",
  ".oocgGGggGGgcoo.",
  "o..occgGGgcco..o",
  ...CRAB_TOP.slice(11),
];
const CRAB_PAL = { r: "#b8432f", c: "#8e7a44", C: "#6b5a2e" };

const OC_DONG: PixelIcon = {
  rows: [
    "................",
    "................",
    "................",
    ".....oooooo.....",
    "....osssssso....",
    "...osppppppso...",
    "..ospsssssspso..",
    "..ospsppppspso..",
    "..ospspsspspso..",
    "..ospspppspsso..",
    "..ospsssspssso..",
    "...ospppppsso...",
    "....osssssso....",
    ".....oooooo.....",
    "................",
    "................",
  ],
  pal: { s: "#4a3a22", p: "#8a6a3f" },
};

const OC_BUOU_VANG: PixelIcon = {
  rows: [
    "................",
    "......oo........",
    ".....oyyo.......",
    ".....oyYo.......",
    "....oyyYYo......",
    "...oyyyyYYo.....",
    "..oyyYYyyyYo....",
    ".oyyyyYYyyyYo...",
    ".oyyyyyyYYyyYo..",
    ".oyYyyyyyyYYyYo.",
    ".oyyYYyyyyyyyYo.",
    "..oyyyYYYyyyYo..",
    "...oyyyyyyyYo.ee",
    "....ooooooooo.ee",
    "................",
    "................",
  ],
  pal: { y: "#c9955a", Y: "#8a5a2b", e: "#f29bb5" },
};

// v17: the ná (a forked stick, its band and pouch), three clay pellets on a cloth, a sack of dog food with a bone, the
// map rat's run pose outlined, and a clay bowl of kibble
const TOOL_SLING: PixelIcon = {
  rows: [
    "................",
    "..oo........oo..",
    ".oyYkk....kkyYo.",
    ".oyYo.kppk.oyYo.",
    "..oyYo.pp.oyYo..",
    "...oyYo..oyYo...",
    "....oyYooyYo....",
    ".....oyyyYo.....",
    "......oyYo......",
    "......oyYo......",
    "......oyYo......",
    "......oyYo......",
    "......oyYo......",
    "......oyYo......",
    ".......oo.......",
    "................",
  ],
  pal: { y: "#8b5a33", Y: "#6e4424", k: "#2e2a2a", p: "#b0643a" },
};

const AMMO_PELLET: PixelIcon = {
  rows: [
    "................",
    "................",
    "................",
    "......oooo......",
    ".....oLaaao.....",
    ".....oaaaao.....",
    ".....oaaaao.....",
    "..oooooooooooo..",
    "..oLaaaooLaaao..",
    "..oaaaaooaaaao..",
    "..oaaaaooaaaao..",
    "cccooooccooooccc",
    "cccccccccccccccc",
    ".cccccccccccccc.",
    "................",
    "................",
  ],
  pal: { a: "#a0522d", L: "#c9784a", c: "#d9c9a0" },
};

const FOOD_DOG: PixelIcon = {
  rows: [
    "................",
    "......oooo......",
    ".....osssso.....",
    "......oSSo......",
    ".....osssSo.....",
    "....osssssSo....",
    "...ossssssSSo...",
    "..osssssssSSSo..",
    "..osksssskSSSo..",
    "..oskkkkkkSSSo..",
    "..osksssskSSSo..",
    "..ossssssssSSo..",
    "...osssssssSo...",
    "....oooooooo....",
    "................",
    "................",
  ],
  pal: { s: "#d9c27a", S: "#b8a05a", k: "#f4efe0" },
};

const RAT_ICON: PixelIcon = {
  rows: [
    "................",
    "................",
    "................",
    "..........pp....",
    ".........offo...",
    "......oooffffo..",
    "....oofffffffeo.",
    "...offssffffffpo",
    "p.offsssfffffo..",
    "p.offfffffffo...",
    ".pofsbbbbbbso...",
    "..ooso.....so...",
    "....so.....so...",
    "....oo.....oo...",
    "................",
    "................",
  ],
  pal: { f: "#7a6450", s: "#5a4636", b: "#b8a48a", p: "#c98f86", e: "#1c1410" },
};

const DOG_BOWL: PixelIcon = {
  rows: [
    "................",
    "................",
    "................",
    "................",
    "................",
    "......k.kk......",
    "....kkkkkkkk....",
    "..oooooooooooo..",
    "..obbbbbbbbbBo..",
    "...obbbbbbbBo...",
    "...obbbbbbbBo...",
    "....oBBBBBBo....",
    ".....oooooo.....",
    "................",
    "................",
    "................",
  ],
  pal: { b: "#b0643a", B: "#8a4a26", k: "#8b5a33" },
};

export const FARM_ICONS: Record<string, PixelIcon> = {
  seed_short: seedSack("#7fb548", "#5a8f32"),
  seed_nep: seedSack("#efe6cf", "#cfc3a3"),
  seed_thom: seedSack("#d9776a", "#b25a4f"),
  // hữu cơ: a sprout
  fert_manure: fertBag("#8a6a3f", "#6e5230", ["..LL", ".LLL", "LLL.", ".L..", "L..."], { L: "#3f7f2e" }),
  fert_phosphate: fertBag("#9aa0a8", "#747a84", ["LLL.", "L..L", "LLL.", "L...", "L..."], { L: "#2a2f3a" }),
  fert_urea: fertBag("#e8e4d8", "#c3c8d4", ["L..L", "LL.L", "L.LL", "L..L", "L..L"], { L: "#3d6fd1" }),
  fert_potash: fertBag("#c0392b", "#8e2a1f", ["L..L", "L.L.", "LL..", "L.L.", "L..L"], { L: "#8e2a1f" }),
  // N, P and K in their colours
  fert_npk: fertBag("#3d6fd1", "#2f56a6", ["a..k", "a..k", "....", ".cc.", ".cc."], { a: "#3f7f2e", k: "#c0392b", c: "#2a2f3a" }),
  // a caterpillar, a hopper, a blast spot
  spray_insect: bottle("#5caa4a", "#86c95c", "#2f6e2f", [".LL.", "LLLL", "L..L"], "#3f7f2e"),
  spray_hopper: bottle("#e0873c", "#f2b27a", "#8e4a1f", ["L..L", ".LL.", "L..L"], "#7a4a2a"),
  spray_fungus: bottle("#7a5cc0", "#a58be0", "#4a3480", [".LL.", "L..L", ".LL."], "#8e5a2a"),
  rice_wet: riceSack("#c9c46a", "#a8a24a", "#6fb2cf"),
  rice_dry: riceSack("#f6c945", "#e0b33c", "#e0662f"),
  // v15.2: hoa-màu seeds (a cob and a chili on paper packets), the two tools and the hoa màu
  seed_khoai: SEED_KHOAI,
  seed_bap: packet(
    ["...gYY..", "..gYyY..", ".gYyYYg.", ".gYYyYg.", ".gYyYYg.", "..gYyY..", "..gYYg..", "...gg..."],
    { Y: "#f6c945", y: "#e0b33c", g: "#8fbf5a" },
  ),
  seed_ot: packet(
    [".....gg.", "....rg..", "....rr..", "...rrR..", "..rrR...", ".rrR....", ".rR.....", "........"],
    { r: "#d8342a", R: "#a82a22", g: "#4f9a38" },
  ),
  tool_sickle: TOOL_SICKLE,
  tool_sprayer: TOOL_SPRAYER,
  produce_khoai: PRODUCE_KHOAI,
  produce_bap: PRODUCE_BAP,
  produce_ot: PRODUCE_OT,
  // v15.3
  box_bucket: BOX_BUCKET,
  box_basket: BOX_BASKET,
  cua_dong: { rows: CRAB_TOP, pal: { ...CRAB_PAL, e: "#2a2f3a" } },
  cua_gach: { rows: CRAB_BELLY, pal: { ...CRAB_PAL, g: "#e0662f", G: "#f29b4a" } },
  oc_dong: OC_DONG,
  oc_buou_vang: OC_BUOU_VANG,
  // v17
  tool_sling: TOOL_SLING,
  ammo_pellet: AMMO_PELLET,
  food_dog: FOOD_DOG,
  rat: RAT_ICON,
  dog_bowl: DOG_BOWL,
};
