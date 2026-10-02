import { formatWeight, hookClassName, type ShopItem, type ShopKind } from "./catalog";
import type { GearSlot, PartSlot, Rig } from "./state";

// Câu cá v3 (0110_fishing_v3.sql): the modular gear's numbers as the server uses them, and the texts the bag, the shop and
// the notebook show. Pure. tests/unit/fishing-v3.test.ts pins the numbers against the migration.

/** The parts a bare rod takes; Cần gỗ is a whole kit. */
export const GEAR_SLOTS: readonly GearSlot[] = ["rod", "hook", "line", "reel", "bobber", "bait"];
/** The slot's name in the bag. */
export const SLOT_NAME: Record<GearSlot, string> = {
  rod: "Cần", hook: "Lưỡi", line: "Dây câu", reel: "Máy xoay", bobber: "Phao", bait: "Mồi",
};
/** Slots a bare rod cannot cast without. */
export const REQUIRED_SLOTS: readonly GearSlot[] = ["hook", "line"];
/** Slots that may be left empty (the rod falls back to Cần gỗ, the bait is never empty). */
export const OPTIONAL_SLOTS: readonly GearSlot[] = ["hook", "line", "reel", "bobber"];

/** No reel on a bare rod: the reel is slower (min_reel_ms ×) and harder (difficulty +). */
export const NO_REEL = { speed: 1.15, ease: 5 } as const;
/** The hook window without a phao: Cần gỗ's own phao, and a bare rod's nothing. */
export const KIT_WINDOW_MS = 1500;
export const NO_BOBBER_WINDOW_MS = 700;
/** The extra fish of a multi-point hook: the chance of each extra, by points. */
export const EXTRA_CHANCE: Record<number, readonly number[]> = { 1: [], 2: [0.12], 3: [0.15, 0.06] };
/** The species weights within a rarity: a liked bait ×2, a liked groundbait on the spot ×3. */
export const BAIT_WEIGHT = 2;
export const GROUNDBAIT_WEIGHT = 3;
/** A groundbait works this long, this far around where it was thrown. */
export const GROUNDBAIT_MINUTES = 10;
export const GROUNDBAIT_RADIUS_PX = 48;

/** The shop kind a slot takes. */
export function slotKind(slot: GearSlot): ShopKind {
  return slot;
}

/** Expected extra fish per cast of a hook with `points`. */
export function expectedExtras(points: number): number {
  return (EXTRA_CHANCE[points] ?? []).reduce((a, b) => a + b, 0);
}

/** The rig in a few short lines for the bag (what the gear adds up to). */
export function rigLines(rig: Rig): string[] {
  const out: string[] = [];
  out.push(`${hookClassName(rig.hookClass)}${rig.hooks > 1 ? ` · ${rig.hooks} mũi` : ""}`);
  if (rig.lineG != null) out.push(`Dây chịu ${formatWeight(rig.lineG)}`);
  out.push(rig.rodG == null ? "Cần không gãy" : `Cần chịu ${formatWeight(rig.rodG)}`);
  if (!rig.kit) {
    const pct = Math.round((1 - rig.reelSpeed) * 100);
    out.push(pct > 0 ? `Thu cá nhanh hơn ${pct}%` : pct < 0 ? `Không máy xoay: thu chậm hơn ${-pct}%` : "Thu cá bình thường");
  }
  out.push(`Giật cần trong ${String(Math.round(rig.windowMs / 100) / 10).replace(".", ",")} giây`);
  return out;
}

/** 0115: a rod's slots in the bag (the order of its card). */
export const PART_SLOTS: readonly PartSlot[] = ["hook", "line", "reel", "bobber"];
export const PART_SLOT_NAME: Record<PartSlot, string> = { hook: "Lưỡi", line: "Dây", reel: "Máy xoay", bobber: "Phao" };

/** 0115: the heaviest fish a rig lands (its weakest part: the line or the rod); null = no limit. */
export function rigLimitG(rig: Rig): number | null {
  const xs = [rig.lineG, rig.rodG].filter((x): x is number => x != null);
  return xs.length ? Math.min(...xs) : null;
}

/** 0115: a rod card's stats summary ("Chịu tối đa 12 kg · Kéo nhanh hơn 10% · …"). */
export function rodSummary(rig: Rig): string {
  const out: string[] = [];
  const lim = rigLimitG(rig);
  if (rig.ready && lim != null) out.push(`Chịu tối đa ${formatWeight(lim)}`);
  out.push(`${hookClassName(rig.hookClass)}${rig.hooks > 1 ? ` · ${rig.hooks} mũi` : ""}`);
  if (!rig.kit) {
    const pct = Math.round((1 - rig.reelSpeed) * 100);
    out.push(pct > 0 ? `Kéo nhanh hơn ${pct}%` : pct < 0 ? `Kéo chậm hơn ${-pct}% (chưa có máy xoay)` : "Kéo bình thường");
  }
  out.push(`Giật cần trong ${String(Math.round(rig.windowMs / 100) / 10).replace(".", ",")} giây`);
  return out.join(" · ");
}

/** 0115: the warning before a part is bound to a rod (and, when the slot is taken, that the old one is thrown away). */
export function mountWarning(partName: string, rodName: string, oldName: string | null): string {
  const bind = `${partName} sẽ gắn chặt vào ${rodName}, không tháo sang cần khác được.`;
  return oldName ? `${bind} ${oldName} cũ sẽ bị bỏ.` : bind;
}

/** What a bare rod still lacks, or null when it may cast. */
export function missingText(rig: Rig | null | undefined): string | null {
  if (!rig || rig.ready) return null;
  const names = rig.missing.map((m) => (m === "hook" ? "lưỡi" : "dây câu"));
  return `Cần này còn thiếu ${names.join(" và ")} — chưa quăng được.`;
}

/** The owned items of one slot's kind, cheapest first (parts are owned once; Cần gỗ and the feather are everyone's). */
export function ownedOfSlot(slot: GearSlot, items: readonly ShopItem[], owned: readonly string[]): ShopItem[] {
  return items.filter((i) => i.kind === slotKind(slot) && (i.starter || owned.includes(i.id)))
    .sort((a, b) => (a.price ?? 0) - (b.price ?? 0) || a.sortOrder - b.sortOrder);
}

/** A species' Vietnam-clock hours as ranges: [18…23, 0…5] → "18h–6h"; null / all 24 → "cả ngày". */
export function hoursText(hours: readonly number[] | null | undefined): string {
  if (!hours || hours.length === 0 || new Set(hours).size >= 24) return "cả ngày";
  const set = new Set(hours.map((h) => ((h % 24) + 24) % 24));
  const ranges: Array<[number, number]> = [];
  // start at an hour whose previous hour is off, so a range across midnight stays whole
  const start = [...Array(24).keys()].find((h) => set.has(h) && !set.has((h + 23) % 24)) ?? 0;
  let run: [number, number] | null = null;
  for (let k = 0; k < 24; k++) {
    const h = (start + k) % 24;
    if (set.has(h)) run = run ? [run[0], h] : [h, h];
    else if (run) { ranges.push(run); run = null; }
  }
  if (run) ranges.push(run);
  return ranges.map(([a, b]) => `${a}h–${(b + 1) % 24}h`).join(", ");
}

/** Does a species bite at this Vietnam hour? */
export function bitesAt(hours: readonly number[] | null | undefined, hour: number): boolean {
  return !hours || hours.includes(hour);
}
