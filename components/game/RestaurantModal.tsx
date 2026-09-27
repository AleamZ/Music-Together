"use client";

import { useState } from "react";
import type { FishRow } from "@/lib/game/fishing/state";
import { MENU, fishDiscountPct, mealPrice, type MealItem } from "@/lib/game/market/menu";
import { eatMeal, marketErrorMessage, type MealResult } from "@/lib/game/market/rpc";
import { ParchmentModal } from "./Parchment";

interface RestaurantModalProps {
  token: string;
  fish: FishRow[];
  rarityOf: (speciesId: string) => number;
  speciesName: (id: string) => string;
  onAte: (r: MealResult) => void;
  onClose: () => void;
}

type Tab = "food" | "drink";

const ICONS: Record<string, string> = {
  com_tam: "🍛", pho_bo: "🍜", banh_mi: "🥖", bun_bo: "🍲", ca_kho_to: "🐟", canh_chua: "🥣", ca_chien: "🍤",
  tra_da: "🧊", nuoc_mia: "🎋", cafe_sua: "☕", nuoc_dua: "🥥", sinh_to: "🥑",
};

function errText(e: unknown): string {
  const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);
  return marketErrorMessage(msg);
}

/** Chợ Lớn's restaurant (v18.4): the menu on parchment cards; a 🐟 dish can take one fish from the bag for a discount.
 *  Prices shown are a display copy; the server decides what is charged. */
export default function RestaurantModal({ token, fish, rarityOf, speciesName, onAte, onClose }: RestaurantModalProps) {
  const [tab, setTab] = useState<Tab>("food");
  const [selectedId, setSelectedId] = useState<string>(() => MENU.find((m) => m.kind === "food")!.id);
  const [fishId, setFishId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = MENU.filter((m) => m.kind === tab);
  const selected: MealItem = MENU.find((m) => m.id === selectedId) ?? items[0];
  const rankedFish = fish
    .map((f) => ({ f, pct: fishDiscountPct(rarityOf(f.speciesId), f.weightG) }))
    .sort((a, b) => b.pct - a.pct || b.f.weightG - a.f.weightG);
  const chosen = selected.fishDish ? rankedFish.find((x) => x.f.id === fishId) ?? null : null;
  const finalPrice = mealPrice(selected, chosen ? { rarity: rarityOf(chosen.f.speciesId), weightG: chosen.f.weightG } : null);

  const pick = (id: string) => {
    setSelectedId(id);
    setFishId("");
    setError(null);
  };
  const switchTab = (t: Tab) => {
    setTab(t);
    pick(MENU.find((m) => m.kind === t)!.id);
  };

  const order = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await eatMeal(token, selected.id, chosen ? chosen.f.id : null);
      onAte(res);
      setFishId("");
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ParchmentModal title="🍜 Nhà hàng Chợ Lớn" onClose={onClose} className="sm:max-w-[760px]">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto font-vt text-lg">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-gold-200 pb-2">
          <div className="flex gap-2">
            <button type="button" className={`pch-btn ${tab === "food" ? "pch-btn-primary" : ""}`} onClick={() => switchTab("food")}>
              🍚 Ăn
            </button>
            <button type="button" className={`pch-btn ${tab === "drink" ? "pch-btn-primary" : ""}`} onClick={() => switchTab("drink")}>
              🥤 Uống
            </button>
          </div>
          <span className="text-sm opacity-75">Món 🐟 rẻ hơn nếu bạn mang cá tới!</span>
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] content-start gap-2">
          {items.map((item) => {
            const active = item.id === selected.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={active}
                onClick={() => pick(item.id)}
                className={`relative flex min-w-0 flex-col items-center gap-1 rounded-sm border-2 bg-cream p-2 text-center transition-colors ${
                  active ? "border-burgundy bg-gold-50 shadow-md" : "border-gold-200 hover:border-gold-400"
                }`}
              >
                {item.fishDish && (
                  <span className="absolute right-1 top-1 rounded border border-sky-300 bg-sky-50 px-1 text-sm" title="Món cá: dùng cá để được giảm giá">
                    🐟
                  </span>
                )}
                <span className="flex h-12 w-12 items-center justify-center rounded-sm border border-gold-300 bg-parchment text-3xl" aria-hidden="true">
                  {ICONS[item.id] ?? "🍽️"}
                </span>
                <span className="line-clamp-2 w-full break-words text-base font-bold leading-tight text-ink">{item.name}</span>
                <span className="whitespace-nowrap font-bold text-amber-800">{item.price} xu</span>
                <span className="flex flex-wrap justify-center gap-1 text-sm">
                  {item.hunger > 0 && (
                    <span className="whitespace-nowrap rounded border border-amber-300 bg-amber-50 px-1 text-amber-900">+{item.hunger} 🍚</span>
                  )}
                  {item.thirst > 0 && (
                    <span className="whitespace-nowrap rounded border border-sky-300 bg-sky-50 px-1 text-sky-900">+{item.thirst} 💧</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-2 rounded-sm border-2 border-gold-300 bg-parchment p-3 shadow-inner">
          <div className="flex items-center gap-2">
            <span className="text-3xl" aria-hidden="true">{ICONS[selected.id] ?? "🍽️"}</span>
            <span className="text-xl font-bold text-burgundy">{selected.name}</span>
          </div>
          {selected.fishDish && (
            <label className="flex flex-col gap-1 text-base">
              <span>Dùng cá trong giỏ:</span>
              <select
                aria-label="Chọn cá"
                className="rounded-sm border border-gold-300 bg-cream px-2 py-1 text-base"
                value={fishId}
                onChange={(e) => { setFishId(e.target.value); setError(null); }}
              >
                <option value="">Không dùng cá</option>
                {rankedFish.map(({ f, pct }) => (
                  <option key={f.id} value={f.id}>
                    {`${speciesName(f.speciesId)} · ${(f.weightG / 1000).toFixed(1)} kg · −${pct}%`}
                  </option>
                ))}
              </select>
              {rankedFish.length === 0 && <span className="text-sm opacity-75">Giỏ chưa có cá — ra ao câu vài con nhé!</span>}
            </label>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gold-200 pt-2">
            <span className="flex items-center gap-2">
              <span>Giá:</span>
              {chosen && <span className="text-base line-through opacity-60">{selected.price} xu</span>}
              <span className="text-xl font-bold text-amber-800" data-testid="final-price">{finalPrice} xu</span>
              {chosen && (
                <span className="rounded border border-emerald-400 bg-emerald-100 px-1 text-base font-bold text-emerald-800">−{chosen.pct}%</span>
              )}
            </span>
            <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => void order()}>
              {busy ? "Đang nấu…" : "Gọi món"}
            </button>
          </div>
          {error && (
            <div className="rounded border border-rose-400 bg-rose-100 p-2 text-base text-burgundy-accent" role="alert">{error}</div>
          )}
        </div>

        <div className="flex justify-end border-t-2 border-gold-200 pt-2">
          <button type="button" className="pch-btn" onClick={onClose}>Đóng</button>
        </div>
      </div>
    </ParchmentModal>
  );
}
