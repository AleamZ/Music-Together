import type { CharAct } from "@/lib/game/diorama/character/pose";
import { wearableIds, type LookSlot } from "@/lib/game/diorama/character/catalog";
import { wear3dDesc, WEAR3D } from "@/lib/game/diorama/character/wear3d";
import type { Look } from "@/lib/game/types";
import NAMES from "./names.json";

// The outfit gallery's sheets: close-ups (before/after), a signature-outfit sheet, and one sheet per slot that dresses
// sample characters in every catalog item (boys and girls alternating, front and 3/4 views alternating).

export interface Tile { look: Look; label: string; yaw: number; zoom?: number; detail?: "high" | "low"; focusY?: number; act?: CharAct; time?: number }
export interface Sheet { name: string; title: string; cols: number; tw: number; th: number; tiles: Tile[] }

const names = NAMES as Record<string, string>;
const nm = (id: string | null | undefined) => (id ? `${names[id] ?? id}` : "");

const NAM: Look = { skin: "warm", hair: "short", hairColor: "black", hat: null, top: "top_tee_white", bottom: "bottom_pants_navy", shoes: "shoes_sneaker_white", neck: null, gender: "nam" };
const NU: Look = { skin: "light", hair: "long", hairColor: "brown", hat: null, top: "top_tee_white", bottom: "bottom_skirt_pleated", shoes: "shoes_sandal_brown", neck: null, gender: "nu" };
const FRONT = 0, TQ = -0.62;

/** "nam — Áo vest + Quần tây đen + Giày tây" from a look. */
function wears(l: Look): string {
  const parts = l.outfit ? [nm(l.outfit)] : [nm(l.top), nm(l.bottom)];
  parts.push(nm(l.hat), nm(l.shoes), nm(l.neck), nm(l.wrist), nm(l.hairpin));
  return `${l.gender === "nu" ? "nữ" : "nam"} — ${parts.filter(Boolean).join(" + ")}`;
}

export const CLOSEUPS: Tile[] = [
  { look: { ...NAM, top: "fm_denim_jacket", bottom: "bottom_jeans" }, label: "nam — áo khoác jean (cổ áo V)", yaw: -0.35, zoom: 1.9, focusY: 1.38 },
  { look: { ...NU, top: "fm_sailor_top" }, label: "nữ — áo thủy thủ, tóc dài", yaw: 0.35, zoom: 1.9, focusY: 1.38 },
  { look: { ...NAM, top: "fm_suit", bottom: "bottom_pants_black", shoes: "shoes_oxford_black" }, label: "nam — áo vest", yaw: 0, zoom: 1.9, focusY: 1.38 },
  { look: { ...NU, top: "fm_school_shirt", hair: "bob" }, label: "nữ — sơ mi đồng phục, tóc bob", yaw: -0.3, zoom: 1.9, focusY: 1.38 },
  { look: { ...NAM, top: "fm_hoodie", hair: "curly" }, label: "nam — hoodie, tóc xoăn", yaw: 0.6, zoom: 1.9, focusY: 1.38 },
  { look: { ...NU, outfit: "fm_ao_dai", hair: "bun", hat: "hat_nonla" }, label: "nữ — áo dài + nón lá", yaw: -0.4, zoom: 1.25, focusY: 1.2 },
];

export function closeupSheet(tag: string): Sheet {
  return { name: `closeup-${tag}`, title: `Close-up (${tag})`, cols: 3, tw: 380, th: 420, tiles: CLOSEUPS };
}

const SIGNATURE: Look[] = [
  { ...NU, outfit: "fm_ao_dai", hat: "hat_nonla", hair: "long", shoes: "shoes_sandal_brown" },
  { ...NU, top: "top_aodai_yellow", bottom: "bottom_pants_silk_white", hat: "hat_nonquaitao", hair: "bun" },
  { ...NAM, top: "top_aodai_tet", bottom: "bottom_pants_tet", hat: "hat_nonla_hue", shoes: "shoes_dep_brown" },
  { ...NU, outfit: "fm_kimono", hair: "bun", hairpin: "acc_flower_clip", shoes: "shoes_dep_toong" },
  { ...NAM, outfit: "fm_kimono", hair: "short", shoes: "shoes_dep_toong" },
  { ...NAM, top: "fm_suit", bottom: "bottom_pants_black", shoes: "shoes_oxford_black", hair: "undercut" },
  { ...NU, top: "fm_suit", bottom: "bottom_skirt_black", shoes: "shoes_oxford_brown", hair: "bob" },
  { ...NAM, top: "fm_school_shirt", bottom: "bottom_pants_navy", shoes: "shoes_sneaker_white" },
  { ...NU, top: "fm_school_shirt", bottom: "fm_pleated_skirt", shoes: "shoes_oxford_black", hair: "twin_braids" },
  { ...NU, top: "fm_sailor_top", bottom: "bottom_skirt_pleated", hair: "ponytail", hairpin: "acc_bow_red" },
  { ...NAM, top: "fm_hoodie", bottom: "bottom_pants_jogger", shoes: "fm_sneakers", hat: "hat_cap_black" },
  { ...NU, top: "top_hoodie_pink", bottom: "bottom_jeans_light", hat: "hat_beanie_orange", shoes: "shoes_sneaker_neon" },
  { ...NU, outfit: "fm_maxi_dress", hat: "hat_straw_ribbon", hair: "long", neck: "acc_necklace_pearl" },
  { ...NAM, outfit: "fm_overalls", hat: "hat_straw_summer", shoes: "fm_boots" },
  { ...NAM, top: "top_baba_white", bottom: "bottom_pants_black", hat: "hat_nonla", neck: "neck_khanran", shoes: "shoes_dep_brown" },
  { ...NU, top: "top_baba_pink", bottom: "bottom_pants_silk_black", hat: "hat_nonla_gold", neck: "neck_khanran_red" },
  { ...NAM, top: "top_vest_tuxedo", bottom: "bottom_pants_black", shoes: "shoes_oxford_black", neck: "neck_bowtie_black", hat: "hat_fedora" },
  { ...NAM, top: "top_jacket_leather", bottom: "bottom_jeans_black", shoes: "shoes_boots_combat", hat: "hat_bandana_red" },
  { ...NU, top: "fm_cardigan", bottom: "bottom_skirt_red", hat: "hat_beret_black", neck: "neck_choker_heart" },
  { ...NAM, top: "fm_varsity", bottom: "fm_rolled_jeans", shoes: "shoes_sneaker_red", hat: "hat_cap_red" },
  { ...NAM, outfit: "vp_vovinam", hat: "hat_headband_ninja", shoes: "shoes_dep_black" },
  { ...NU, outfit: "vp_taekwondo", hair: "ponytail" },
  { ...NAM, top: "fm_jersey", bottom: "fm_cargo_shorts", shoes: "fm_sneakers" },
  { ...NU, top: "fm_raincoat", bottom: "bottom_shorts_blue", shoes: "shoes_boots_yellow", hair: "bob" },
];

const NU_HAIR = ["long", "bob", "ponytail", "bun", "twin_braids", "bangs"] as const;
const NAM_HAIR = ["short", "undercut", "curly", "buzz"] as const;

/** Every catalog item in `slot`, each worn once over a base look (boys and girls alternating). */
function itemTiles(slot: LookSlot, ids: string[], start: number, zoom?: number, focusY?: number): Tile[] {
  return ids.map((id, i) => {
    const nu = i % 2 === 1;
    let look: Look = { ...(nu ? NU : NAM), hair: nu ? NU_HAIR[i % 6] : NAM_HAIR[i % 4] };
    if (slot === "outfit") look = { ...look, outfit: id };
    else if (slot === "shoes") look = { ...look, shoes: id };
    else look = { ...look, [slot]: id };
    if ((slot === "bottom" && /skirt/.test(id)) || id === "fm_ao_dai" || id === "fm_maxi_dress") look = { ...NU, ...look, gender: "nu", hair: "long" };
    const yaw = i % 2 ? TQ : FRONT;
    return { look, label: `#${start + i} ${wears(look)} [${id}] · ${yaw ? "3/4" : "trước"}`, yaw, zoom, focusY };
  });
}

export function gallerySheets(): Sheet[] {
  const ids = wearableIds();
  const sheets: Sheet[] = [];
  let n = 1;
  const sig = SIGNATURE.flatMap((l, i) => [
    { look: l, label: `#${n + i} ${wears(l)} · trước`, yaw: FRONT },
    { look: l, label: `#${n + i} ${wears(l)} · 3/4`, yaw: TQ },
  ]);
  n += SIGNATURE.length;
  const AO: Look[] = [
    { ...NU, outfit: "fm_ao_dai", hat: "hat_nonla", hair: "long" },
    { ...NU, top: "top_aodai_tet", bottom: "bottom_pants_silk_white", hair: "bun" },
    { ...NU, top: "top_aodai_yellow", bottom: "bottom_pants_silk_white", hat: "hat_nonquaitao", hair: "long" },
    { ...NAM, top: "top_aodai_tet", bottom: "bottom_pants_tet", shoes: "shoes_dep_brown" },
    { ...NAM, top: "top_aodai_yellow", bottom: "bottom_pants_silk_white", shoes: "shoes_dep_brown" },
    { ...NU, outfit: "fm_kimono", hair: "bun" },
  ];
  const views: [string, number, CharAct?, number?][] = [["trước", 0], ["3/4", TQ], ["nghiêng", -Math.PI / 2], ["sau", Math.PI], ["đi bộ 3/4", TQ, "walk", 0.18], ["đi bộ nghiêng", -Math.PI / 2, "walk", 0.43]];
  sheets.push({ name: "ao-dai", title: "Áo dài (và kimono) — trước / 3/4 / nghiêng / sau / đi bộ", cols: 6, tw: 250, th: 330,
    tiles: AO.flatMap((l, i) => views.map(([v, yaw, act, time]) => ({ look: l, label: `A${i + 1} ${wears(l)} · ${v}`, yaw, act, time }))) });
  sheets.push({ name: "outfits-signature", title: "Bộ đồ tiêu biểu (trước + 3/4)", cols: 8, tw: 250, th: 330, tiles: sig });
  const slotSheet = (slot: LookSlot, title: string, zoom?: number, focusY?: number, pick?: (id: string) => boolean, name?: string) => {
    const list = ids[slot].filter(pick ?? (() => true));
    const tiles = itemTiles(slot, list, n, zoom, focusY);
    n += list.length;
    sheets.push({ name: name ?? `items-${slot}`, title, cols: 8, tw: 250, th: 330, tiles });
  };
  slotSheet("top", "Áo (item_catalog)", undefined, undefined, (id) => id.startsWith("top_"), "items-top-1");
  slotSheet("top", "Áo thời trang (fashion models)", undefined, undefined, (id) => !id.startsWith("top_"), "items-top-2");
  slotSheet("outfit", "Bộ liền (outfit, võ phục)");
  slotSheet("bottom", "Quần / váy");
  slotSheet("hat", "Mũ nón", 1.45, 1.72);
  slotSheet("shoes", "Giày dép", 2.2, 0.28);
  slotSheet("neck", "Khăn / cà vạt / dây chuyền", 1.8, 1.25);
  slotSheet("wrist", "Vòng tay / đồng hồ", 1.5, 0.95);
  slotSheet("hairpin", "Kẹp tóc / băng đô", 1.7, 1.5);
  return sheets;
}

/** The coverage table (markdown): every catalog id → its 2D name → its 3D model → the gallery tile showing it. */
export function coverageMd(sheets: Sheet[]): string {
  const where = new Map<string, string>();
  for (const s of sheets) for (const t of s.tiles) {
    const num = /^#(\d+)/.exec(t.label)?.[1];
    const tagged = /\[([a-z0-9_]+)\]/.exec(t.label)?.[1];
    const worn = tagged ? [tagged] : [t.look.outfit, t.look.top, t.look.bottom, t.look.hat, t.look.shoes, t.look.neck, t.look.wrist, t.look.hairpin];
    for (const id of worn) if (id && num && !where.has(id)) where.set(id, `${s.name}.png #${num}`);
  }
  const ids = wearableIds();
  const rows = ["| id | slot | 2D name | 3D model | gallery tile |", "|---|---|---|---|---|"];
  for (const slot of Object.keys(ids) as LookSlot[]) for (const id of ids[slot]) {
    rows.push(`| \`${id}\` | ${slot} | ${names[id] ?? "—"} | **${WEAR3D[id]?.kind ?? "missing"}** — ${wear3dDesc(id) ?? ""} | ${where.get(id) ?? "—"} |`);
  }
  return ["# Chibi 3D outfit coverage", "",
    "Every wearable catalog id (`lib/game/diorama/character/catalog.ts`: the item_catalog art, the fashion models and the võ phục) and the dedicated 3D model it gets on the chibi (`lib/game/diorama/character/wear3d.ts`, built in `garments3d.ts` / `build.ts`). Generated by `scripts/chibi-gallery/run.sh`; do not edit by hand.",
    "", ...rows, ""].join("\n");
}
