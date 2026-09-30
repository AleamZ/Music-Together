// Pure: which dedicated 3D model every wearable catalog id gets on the chibi. The 2D sprite draws many items with a
// shared silhouette (every cap, beret, beanie and bandana is a "tai bèo" there); the 3D chibi builds each item as the
// thing it is named for — a cap has a peak, a beret is a soft flat disc, a hoodie has its hood and pocket, a suit its
// lapels and tie, an áo dài its high collar, long front/back panels and side slits over wide trousers, a kimono its
// wrap collar, wide sleeves and obi. Every id in the catalog (lib/game/diorama/character/catalog.ts) has an explicit
// entry here (pinned by tests/unit/chibi3d.test.ts); unknown ids fall back to the slot's plain model.

export type TopKind =
  | "tee" | "striped" | "camo" | "tank" | "baba" | "polo" | "shirt" | "flannel" | "denimshirt" | "school" | "hoodie"
  | "vest" | "aodai" | "leather" | "denimjacket" | "sailor" | "varsity" | "cardigan" | "raincoat" | "jersey" | "chef"
  | "suit" | "puffer" | "kimono" | "maxi" | "overalls" | "gi" | "tkd" | "kungfu" | "fighter";
export type BottomKind =
  | "pants" | "jeans" | "cargo" | "jogger" | "silk" | "shorts" | "camoshorts" | "hawaii" | "cargoshorts" | "rolled"
  | "skirt" | "pleated" | "denimskirt";
export type HatKind =
  | "nonla" | "quaithao" | "straw" | "taibeo" | "cap" | "beret" | "beanie" | "bandana" | "crown" | "headband" | "lotus"
  | "fedora" | "sunhat" | "helmet" | "coi" | "bucket" | "antlers" | "cowboy";
export type ShoeKind = "dep" | "toong" | "sandals" | "sneakers" | "oxford" | "boots" | "rainboots";
export type NeckKind = "khanran" | "scarf" | "plaid" | "tie" | "bowtie" | "choker" | "goldchain" | "chain" | "pearl" | "jade";
export type WristKind3D = "band" | "beads" | "watch";
export type HairpinKind3D = "star" | "bow" | "headband" | "bandana" | "flower" | "tie";

export type Wear3D =
  | { slot: "top" | "outfit"; kind: TopKind }
  | { slot: "bottom"; kind: BottomKind }
  | { slot: "hat"; kind: HatKind }
  | { slot: "shoes"; kind: ShoeKind }
  | { slot: "neck"; kind: NeckKind }
  | { slot: "wrist"; kind: WristKind3D }
  | { slot: "hairpin"; kind: HairpinKind3D };

const t = (kind: TopKind): Wear3D => ({ slot: "top", kind });
const o = (kind: TopKind): Wear3D => ({ slot: "outfit", kind });
const b = (kind: BottomKind): Wear3D => ({ slot: "bottom", kind });
const h = (kind: HatKind): Wear3D => ({ slot: "hat", kind });
const s = (kind: ShoeKind): Wear3D => ({ slot: "shoes", kind });
const n = (kind: NeckKind): Wear3D => ({ slot: "neck", kind });
const w = (kind: WristKind3D): Wear3D => ({ slot: "wrist", kind });
const p = (kind: HairpinKind3D): Wear3D => ({ slot: "hairpin", kind });

/** Every catalog id → its 3D model. */
export const WEAR3D: Readonly<Record<string, Wear3D>> = {
  // hats
  hat_nonla: h("nonla"), hat_nonla_hue: h("nonla"), hat_nonla_gold: h("nonla"), hat_nonquaitao: h("quaithao"),
  hat_taibeo_green: h("taibeo"), hat_taibeo_camo: h("taibeo"), hat_taibeo_blue: h("taibeo"), hat_taibeo_black: h("taibeo"),
  hat_cap_red: h("cap"), hat_cap_black: h("cap"), hat_cap_white: h("cap"), hat_cap_yellow: h("cap"), hat_cap: h("cap"),
  hat_beret_brown: h("beret"), hat_beret_black: h("beret"),
  hat_beanie_grey: h("beanie"), hat_beanie_orange: h("beanie"), hat_beanie: h("beanie"),
  hat_straw_summer: h("straw"), hat_straw_ribbon: h("sunhat"), hat_sunhat: h("sunhat"),
  hat_bandana_red: h("bandana"), hat_crown_gold: h("crown"), hat_crown: h("crown"), hat_headband_ninja: h("headband"),
  hat_flower_lotus: h("lotus"), hat_fedora: h("fedora"), hat_helmet: h("helmet"), hat_coi: h("coi"), hat_bucket: h("bucket"),
  hat_antlers: h("antlers"), hat_straw_cowboy: h("cowboy"),
  // tops
  top_baba_yellow: t("baba"), top_baba_white: t("baba"), top_baba_pink: t("baba"), top_baba_blue: t("baba"), top_baba_purple: t("baba"),
  top_baba_red: t("baba"), top_baba_brown: t("baba"), top_baba_black: t("baba"), top_baba_cyan: t("baba"),
  top_tee_blue: t("tee"), top_tee_green: t("tee"), top_tee_red: t("tee"), top_tee_black: t("tee"), top_tee_white: t("tee"),
  top_tee_yellow: t("tee"), top_tee_orange: t("tee"), top_tee_purple: t("tee"), top_tee_striped: t("striped"), top_tee_camo: t("camo"),
  top_polo_navy: t("polo"), top_polo_white: t("polo"), top_shirt_denim: t("denimshirt"), top_shirt_flannel: t("flannel"),
  top_school_boy: t("school"), top_hoodie_grey: t("hoodie"), top_hoodie_pink: t("hoodie"), top_vest_tuxedo: t("vest"),
  top_aodai_tet: t("aodai"), top_aodai_yellow: t("aodai"), top_jacket_leather: t("leather"),
  fm_hoodie: t("hoodie"), fm_denim_jacket: t("denimjacket"), fm_school_shirt: t("school"), fm_ao_ba_ba: t("baba"),
  fm_sailor_top: t("sailor"), fm_varsity: t("varsity"), fm_cardigan: t("cardigan"), fm_tank_top: t("tank"), fm_raincoat: t("raincoat"),
  fm_jersey: t("jersey"), fm_chef_coat: t("chef"), fm_suit: t("suit"), fm_puffer: t("puffer"),
  // outfits
  fm_ao_dai: o("aodai"), fm_kimono: o("kimono"), fm_maxi_dress: o("maxi"), fm_overalls: o("overalls"),
  vp_vovinam: o("gi"), vp_karate: o("gi"), vp_judo: o("gi"), vp_taekwondo: o("tkd"), vp_vinhxuan: o("kungfu"),
  vp_muaythai: o("fighter"), vp_boxing: o("fighter"),
  // bottoms
  bottom_shorts_red: b("shorts"), bottom_shorts_blue: b("shorts"), bottom_shorts_black: b("shorts"), bottom_shorts_white: b("shorts"),
  bottom_shorts_yellow: b("shorts"), bottom_shorts_green: b("shorts"), bottom_shorts_pink: b("shorts"), bottom_shorts_camo: b("camoshorts"),
  bottom_swim_hawaii: b("hawaii"), bottom_pants_black: b("pants"), bottom_pants_white: b("pants"), bottom_pants_grey: b("pants"),
  bottom_pants_navy: b("pants"), bottom_pants_brown: b("pants"), bottom_jeans: b("jeans"), bottom_jeans_light: b("jeans"),
  bottom_jeans_black: b("jeans"), bottom_cargo_green: b("cargo"), bottom_cargo_sand: b("cargo"), bottom_pants_jogger: b("jogger"),
  bottom_pants_tet: b("silk"), bottom_pants_silk_white: b("silk"), bottom_pants_silk_black: b("silk"), bottom_pants_royal: b("silk"),
  bottom_skirt_pleated: b("pleated"), bottom_skirt_denim: b("denimskirt"), bottom_skirt_black: b("skirt"), bottom_skirt_red: b("skirt"),
  fm_pleated_skirt: b("pleated"), fm_cargo_shorts: b("cargoshorts"), fm_rolled_jeans: b("rolled"),
  // shoes
  shoes_dep_blue: s("dep"), shoes_dep_brown: s("dep"), shoes_dep_red: s("dep"), shoes_dep_green: s("dep"), shoes_dep_yellow: s("dep"),
  shoes_dep_black: s("dep"), shoes_dep_pink: s("dep"), shoes_dep_toong: s("toong"),
  shoes_sandal_brown: s("sandals"), shoes_sandal_black: s("sandals"), fm_sandals: s("sandals"),
  shoes_sneaker_white: s("sneakers"), shoes_sneaker_red: s("sneakers"), shoes_sneaker_black: s("sneakers"), shoes_sneaker_neon: s("sneakers"),
  fm_sneakers: s("sneakers"), shoes_oxford_black: s("oxford"), shoes_oxford_brown: s("oxford"),
  shoes_boots_combat: s("boots"), fm_boots: s("boots"), shoes_boots_yellow: s("rainboots"),
  // neck
  neck_khanran: n("khanran"), neck_khanran_red: n("khanran"), neck_khanran_blue: n("khanran"), neck_khanran_green: n("khanran"),
  neck_khanran_purple: n("khanran"), neck_khanran_yellow: n("khanran"), neck_khanran_pink: n("khanran"), neck_khanran_brown: n("khanran"),
  neck_scarf_red: n("scarf"), neck_scarf_white: n("scarf"), neck_scarf_grey: n("scarf"), neck_scarf_plaid: n("plaid"),
  neck_tie_black: n("tie"), neck_tie_red: n("tie"), neck_bowtie_black: n("bowtie"), neck_choker_heart: n("choker"), neck_gold_chain: n("goldchain"),
  acc_necklace_silver: n("chain"), acc_necklace_gold: n("chain"), acc_necklace_pearl: n("pearl"), acc_necklace_jade: n("jade"),
  // wrist, hair
  acc_bracelet_wood: w("band"), acc_bracelet_silver: w("band"), acc_bracelet_jade: w("band"), acc_bracelet_beads: w("beads"), acc_watch: w("watch"),
  acc_clip_star: p("star"), acc_bow_red: p("bow"), acc_headband: p("headband"), acc_bandana: p("bandana"), acc_flower_clip: p("flower"), acc_hair_tie: p("tie"),
};

/** What each 3D model is, for the coverage table. */
const DESC: Readonly<Record<string, string>> = {
  // tops
  tee: "crew-neck T-shirt: ribbed round collar, short sleeves with hems", striped: "crew-neck tee with horizontal stripes",
  camo: "crew-neck tee with camo blotches", tank: "tank top: bare shoulders, straps, scoop neck",
  baba: "áo bà ba: round collarless neck, centre button placket, two hip pockets, split hem", polo: "polo: fold collar, 3-button placket",
  shirt: "button shirt: pointed collar, placket, buttons", flannel: "flannel shirt: check pattern, collar, buttons",
  denimshirt: "denim shirt: collar, contrast stitching, chest pockets", school: "school shirt: white pointed collar, buttons, chest pocket (+ red scarf-bow for nữ)",
  hoodie: "hoodie: hood shell behind the neck, drawstrings, kangaroo pocket, ribbed hem", vest: "tuxedo vest: V opening over a white shirt, bow tie, buttons",
  aodai: "áo dài: high mandarin collar, diagonal closure, long front/back panels with side slits over wide trousers",
  leather: "leather jacket: wide lapels, off-centre zip, belt hem", denimjacket: "denim jacket: shirt collar, open front over a white tee, chest pockets, buttons, stitching",
  sailor: "sailor top: square navy collar with white stripes (back flap), red bow", varsity: "varsity bomber: contrast sleeves, ribbed collar/cuffs/hem, letter patch, snaps",
  cardigan: "cardigan: V neck over a tee, buttons, ribbed hem", raincoat: "raincoat: hood, snap front, long hem",
  jersey: "football jersey: V collar, number on the chest, side stripes", chef: "chef coat: tall collar, double-breasted buttons",
  suit: "suit jacket: notched lapels, white shirt, tie (nam) or pin (nữ), buttons, pocket square", puffer: "puffer jacket: quilted bulging rings, zip, high collar",
  kimono: "kimono: wrap-over collar (left over right), wide hanging sleeves, obi belt with a back bow, ankle-length robe",
  maxi: "maxi dress: fitted bodice, waist seam, floor-length flared skirt", overalls: "overalls: bib with pocket, shoulder straps, buttons, trousers",
  gi: "martial-arts gi: crossed lapels, belt knot with tails", tkd: "taekwondo dobok: black V collar, belt", kungfu: "Vịnh Xuân: mandarin collar, frog buttons, sash",
  fighter: "muay thai/boxing: bare torso, satin trunks with a waistband",
  // bottoms
  pants: "trousers: fly seam, waistband", jeans: "jeans: stitched pockets, fly, belt loops", cargo: "cargo pants: flap side pockets on the thighs",
  jogger: "joggers: side stripe, cuffed ankles", silk: "silk trousers: wide, sheen, flowing", shorts: "shorts: hems above the knee",
  camoshorts: "camo shorts", hawaii: "Hawaiian swim shorts: flower print", cargoshorts: "cargo shorts: knee-length with flap pockets",
  rolled: "rolled jeans: turned-up cuffs", skirt: "A-line skirt", pleated: "pleated skirt: knife pleats round the hem", denimskirt: "denim skirt: front seam, pockets, stitching",
  // hats
  nonla: "nón lá: tall palm-leaf cone, rib rings, chin strap", quaithao: "nón quai thao: wide flat round hat, fringed strap",
  straw: "straw hat: round crown, wide brim, woven lines", taibeo: "mũ tai bèo: soft floppy brim", cap: "baseball cap: crown panels, button, front peak",
  beret: "beret: soft flat disc tilted, stalk", beanie: "beanie: knit ribs, fold-up cuff, pompom", bandana: "bandana: tied cloth cap with a back knot",
  crown: "crown: pointed gold band with a jewel", headband: "ninja headband: band round the brow, plate, trailing tails", lotus: "lotus: pink petals round the crown",
  fedora: "fedora: pinched crown, band, brim", sunhat: "sun hat: wide brim, ribbon band, flower", helmet: "helmet: shell with a crest",
  coi: "cối (pith helmet): domed shell with a brim", bucket: "bucket hat: sloped brim", antlers: "reindeer antlers on a band", cowboy: "cowboy hat: creased crown, curled brim",
  // shoes
  dep: "dép lào: flat sole, front strap", toong: "dép tông: flip-flop thong straps", sandals: "sandals: sole, front and heel straps",
  sneakers: "sneakers: white toe cap, laces panel, thick sole", oxford: "oxford shoes: glossy toe, laces, heel", boots: "boots: tall shaft, cuff, chunky sole",
  rainboots: "rain boots: tall glossy shaft",
  // neck
  khanran: "khăn rằn: checked scarf round the neck with a hanging knot", scarf: "scarf: wrap and hanging end", plaid: "plaid scarf: tartan wrap and end",
  tie: "necktie: knot and blade", bowtie: "bow tie", choker: "choker band with a heart", goldchain: "thick gold chain", chain: "fine chain with a pendant",
  pearl: "pearl necklace", jade: "necklace with a jade pendant",
  // wrist, hairpins
  band: "bracelet band", beads: "bead bracelet", watch: "wrist watch with a face",
};
const HAIRPIN_DESC: Readonly<Record<HairpinKind3D, string>> = {
  star: "star clip", bow: "hair bow (two loops and a knot)", headband: "hairband over the crown", bandana: "bandana band with a back knot",
  flower: "flower clip", tie: "hair tie at the back",
};

/** What the 3D model of a catalog id is (for the coverage table). */
export function wear3dDesc(id: string): string | null {
  const e = WEAR3D[id];
  if (!e) return null;
  return e.slot === "hairpin" ? HAIRPIN_DESC[e.kind] : DESC[e.kind] ?? null;
}

/** The 3D model of an id in a slot (null when unknown or in another slot). */
interface KindOf { top: TopKind; outfit: TopKind; bottom: BottomKind; hat: HatKind; shoes: ShoeKind; neck: NeckKind; wrist: WristKind3D; hairpin: HairpinKind3D }
export function wear3d<K extends keyof KindOf>(id: string | null | undefined, slot: K): KindOf[K] | null {
  const e = id ? WEAR3D[id] : undefined;
  if (!e) return null;
  const top = (x: string) => x === "top" || x === "outfit";
  if (e.slot === slot || (top(slot) && top(e.slot))) return e.kind as KindOf[K];
  return null;
}
