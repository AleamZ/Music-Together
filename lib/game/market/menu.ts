// Chợ Lớn's restaurant menu (v18.4, spec §18.4). Display copy of 0026_market.sql's meal_catalog, which is
// authoritative (a test pins them equal); the discount formula matches _fish_discount_pct and, since econ v2, the cap of
// 0105's eat_meal (the xu off ≤ FISH_DISCOUNT_MAX_X × the fish's price).

export interface MealItem { id: string; name: string; kind: "food" | "drink"; price: number; hunger: number; thirst: number; fishDish: boolean }

export const MENU: readonly MealItem[] = [
  { id: "com_tam", name: "Cơm tấm sườn", kind: "food", price: 300, hunger: 45, thirst: 0, fishDish: false },
  { id: "pho_bo", name: "Phở bò", kind: "food", price: 400, hunger: 55, thirst: 10, fishDish: false },
  { id: "banh_mi", name: "Bánh mì thịt", kind: "food", price: 150, hunger: 25, thirst: 0, fishDish: false },
  { id: "bun_bo", name: "Bún bò Huế", kind: "food", price: 450, hunger: 60, thirst: 10, fishDish: false },
  { id: "ca_kho_to", name: "Cá kho tộ", kind: "food", price: 600, hunger: 70, thirst: 0, fishDish: true },
  { id: "canh_chua", name: "Canh chua cá", kind: "food", price: 500, hunger: 40, thirst: 25, fishDish: true },
  { id: "ca_chien", name: "Cá chiên giòn", kind: "food", price: 550, hunger: 65, thirst: 0, fishDish: true },
  { id: "tra_da", name: "Trà đá", kind: "drink", price: 50, hunger: 0, thirst: 25, fishDish: false },
  { id: "nuoc_mia", name: "Nước mía", kind: "drink", price: 120, hunger: 0, thirst: 40, fishDish: false },
  { id: "cafe_sua", name: "Cà phê sữa đá", kind: "drink", price: 150, hunger: 5, thirst: 35, fishDish: false },
  { id: "nuoc_dua", name: "Nước dừa", kind: "drink", price: 180, hunger: 0, thirst: 55, fishDish: false },
  { id: "sinh_to", name: "Sinh tố bơ", kind: "drink", price: 200, hunger: 10, thirst: 50, fishDish: false },
];

export function fishDiscountPct(rarity: number, weightG: number): number {
  const r = Math.max(1, Math.min(5, Math.floor(rarity)));
  const pct = 20 + (r - 1) * 12 + Math.min(20, Math.floor(Math.max(0, weightG) / 250));
  return Math.max(20, Math.min(80, pct));
}

/** econ v2 (0105): the xu off a fish dish is at most this many times the fish's price (its price at the catch). */
export const FISH_DISCOUNT_MAX_X = 3;

/** A fish brought to the kitchen: its rarity, weight and stored price (FishRow's). */
export interface DishFish { rarity: number; weightG: number; price: number }

/** The xu off `item` for giving up `fish`: the rarity/weight percentage, at most FISH_DISCOUNT_MAX_X × the fish's price
 *  (eat_meal's 'discount'); 0 for a dish that takes no fish. */
export function fishDiscountXu(item: MealItem, fish: DishFish | null): number {
  if (!item.fishDish || !fish) return 0;
  return Math.min(Math.floor((item.price * fishDiscountPct(fish.rarity, fish.weightG)) / 100),
    FISH_DISCOUNT_MAX_X * Math.max(0, Math.floor(fish.price)));
}

export function mealPrice(item: MealItem, fish: DishFish | null): number {
  return item.price - fishDiscountXu(item, fish);
}
