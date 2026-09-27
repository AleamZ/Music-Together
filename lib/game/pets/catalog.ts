// v18.12 Thú cưng: the pet shop's catalog. A display copy of 0036_pets.sql, which is authoritative (prices, what an
// item is for); tests/unit/pets.test.ts pins the two equal.

export type PetSpecies = "hamster" | "tho" | "soc" | "meo" | "cho" | "vet";
export const PET_SPECIES: readonly PetSpecies[] = ["hamster", "tho", "soc", "meo", "cho", "vet"];

export type PetSlot = "head" | "neck" | "body";
export const PET_SLOTS: readonly PetSlot[] = ["head", "neck", "body"];

export interface SpeciesInfo {
  id: PetSpecies;
  name: string;
  icon: string;
  price: number;
  /** Colour variants: id → name (the first is the default). */
  variants: ReadonlyArray<{ id: string; name: string }>;
  /** The buff, as the shop explains it. */
  buff: string;
}

export const SPECIES: Readonly<Record<PetSpecies, SpeciesInfo>> = {
  hamster: {
    id: "hamster", name: "Hamster", icon: "🐹", price: 800,
    variants: [{ id: "vang", name: "Vàng" }, { id: "trang", name: "Trắng" }, { id: "xam", name: "Xám" }],
    buff: "Ít buồn: vui giảm chậm gấp đôi",
  },
  tho: {
    id: "tho", name: "Thỏ", icon: "🐰", price: 1500,
    variants: [{ id: "trang", name: "Trắng" }, { id: "nau", name: "Nâu" }, { id: "xam", name: "Xám" }],
    buff: "Đi nhanh hơn 3%",
  },
  soc: {
    id: "soc", name: "Sóc", icon: "🐿️", price: 2500,
    variants: [{ id: "nau", name: "Nâu" }, { id: "do", name: "Đỏ" }, { id: "xam", name: "Xám" }],
    buff: "Lượm được 5–30 xu mỗi 10 phút (tối đa 300 xu/ngày)",
  },
  meo: {
    id: "meo", name: "Mèo", icon: "🐱", price: 3000,
    variants: [{ id: "cam", name: "Mướp cam" }, { id: "den", name: "Mun" }, { id: "trang", name: "Trắng" }],
    buff: "Chủ đói và khát chậm hơn 10%",
  },
  cho: {
    id: "cho", name: "Chó", icon: "🐶", price: 3500,
    variants: [{ id: "vang", name: "Vàng" }, { id: "nau", name: "Nâu" }, { id: "trang", name: "Trắng" }],
    buff: "Đi nhanh hơn 5%",
  },
  vet: {
    id: "vet", name: "Vẹt", icon: "🦜", price: 5000,
    variants: [{ id: "xanh", name: "Xanh lá" }, { id: "do", name: "Đỏ" }, { id: "lam", name: "Xanh lam" }],
    buff: "Thỉnh thoảng nhại lại câu chat của chủ",
  },
};

export type PetItemKind = "food" | "toy" | PetSlot;

export interface PetItem {
  id: string;
  name: string;
  kind: PetItemKind;
  species: PetSpecies;
  price: number;
}

/** In the shop's order. Food is used up (one per meal); toys and fashion are bought once and kept. */
export const PET_ITEMS: readonly PetItem[] = [
  { id: "food_cho", name: "Pate cho chó", kind: "food", species: "cho", price: 30 },
  { id: "food_meo", name: "Cá khô cho mèo", kind: "food", species: "meo", price: 30 },
  { id: "food_vet", name: "Hạt kê", kind: "food", species: "vet", price: 20 },
  { id: "food_soc", name: "Hạt dẻ", kind: "food", species: "soc", price: 20 },
  { id: "food_tho", name: "Cà rốt", kind: "food", species: "tho", price: 15 },
  { id: "food_hamster", name: "Hạt hướng dương", kind: "food", species: "hamster", price: 10 },
  { id: "toy_ball", name: "Bóng cao su", kind: "toy", species: "cho", price: 200 },
  { id: "toy_wand", name: "Cần câu mèo", kind: "toy", species: "meo", price: 200 },
  { id: "toy_bell", name: "Chuông", kind: "toy", species: "vet", price: 250 },
  { id: "toy_cone", name: "Quả thông gỗ", kind: "toy", species: "soc", price: 200 },
  { id: "toy_tunnel", name: "Đường hầm cỏ", kind: "toy", species: "tho", price: 250 },
  { id: "toy_wheel", name: "Bánh xe", kind: "toy", species: "hamster", price: 300 },
  { id: "cho_collar", name: "Vòng cổ đỏ", kind: "neck", species: "cho", price: 150 },
  { id: "cho_bandana", name: "Khăn bandana", kind: "neck", species: "cho", price: 250 },
  { id: "cho_sweater", name: "Áo len", kind: "body", species: "cho", price: 400 },
  { id: "cho_party", name: "Nón sinh nhật", kind: "head", species: "cho", price: 300 },
  { id: "meo_bow", name: "Nơ hồng", kind: "head", species: "meo", price: 200 },
  { id: "meo_bell", name: "Vòng chuông", kind: "neck", species: "meo", price: 200 },
  { id: "meo_sweater", name: "Áo len", kind: "body", species: "meo", price: 400 },
  { id: "vet_tophat", name: "Nón chóp", kind: "head", species: "vet", price: 350 },
  { id: "vet_bowtie", name: "Nơ cổ", kind: "neck", species: "vet", price: 200 },
  { id: "soc_scarf", name: "Khăn quàng", kind: "neck", species: "soc", price: 200 },
  { id: "soc_nonla", name: "Nón lá mini", kind: "head", species: "soc", price: 300 },
  { id: "tho_bow", name: "Nơ tai", kind: "head", species: "tho", price: 200 },
  { id: "tho_vest", name: "Áo yếm", kind: "body", species: "tho", price: 350 },
  { id: "hamster_beanie", name: "Nón len", kind: "head", species: "hamster", price: 200 },
  { id: "hamster_scarf", name: "Khăn quàng", kind: "neck", species: "hamster", price: 200 },
];

export const petItem = (id: string): PetItem | undefined => PET_ITEMS.find((i) => i.id === id);
export const isPetSpecies = (v: unknown): v is PetSpecies => typeof v === "string" && (PET_SPECIES as readonly string[]).includes(v);
export const variantOk = (sp: PetSpecies, v: string): boolean => SPECIES[sp].variants.some((x) => x.id === v);
export const foodOf = (sp: PetSpecies): PetItem => PET_ITEMS.find((i) => i.kind === "food" && i.species === sp)!;
export const toyOf = (sp: PetSpecies): PetItem => PET_ITEMS.find((i) => i.kind === "toy" && i.species === sp)!;
export const fashionFor = (sp: PetSpecies, slot: PetSlot): PetItem[] =>
  PET_ITEMS.filter((i) => i.species === sp && i.kind === slot);
/** The most pets one player may own. */
export const MAX_PETS = 6;
