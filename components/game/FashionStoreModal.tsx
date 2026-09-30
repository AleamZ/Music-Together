"use client";

import { useContext, useEffect, useState } from "react";
import { UmbrellaContext, UmbrellaShelf } from "./rain/UmbrellaShelf";
import { fetchCatalog, itemFitsGender, type CatalogItem } from "@/lib/game/character";
import type { Look } from "@/lib/game/types";
import type { Member } from "@/lib/supabase";
import ItemIcon from "./ItemIcon";
import ItemTransferDialog from "./ItemTransferDialog";
import { ParchmentModal } from "./Parchment";
import SpritePreview from "./SpritePreview";
import {
  buyFashionItem,
  fetchMyWardrobe,
  filterStoreItems,
  genderTag,
  sellFashionItem,
  isUniformItem,
  storeErrorMessage,
  unequipItem,
  type StoreCategory,
} from "@/lib/game/store";

interface FashionStoreModalProps {
  token: string;
  myAccountId: string;
  initialLook: Look;
  members: Member[];
  onlineIds: string[];
  onLookUpdated?: (newLook: Look) => void;
  onClose: () => void;
}

type CategoryFilter = StoreCategory;

const CATEGORIES: Array<{ key: CategoryFilter; label: string; icon: string }> = [
  { key: "all", label: "Tất cả", icon: "✨" },
  { key: "hat", label: "Mũ", icon: "👒" },
  { key: "top", label: "Áo", icon: "👕" },
  { key: "bottom", label: "Quần", icon: "👖" },
  { key: "outfit", label: "Bộ đồ", icon: "👘" },
  { key: "shoes", label: "Dép", icon: "🩴" },
  { key: "accessory", label: "Phụ kiện", icon: "💍" },
];

export default function FashionStoreModal({
  token,
  myAccountId,
  initialLook,
  members,
  onlineIds,
  onLookUpdated,
  onClose,
}: FashionStoreModalProps) {
  const [tabSel, setTab] = useState<"store" | "my_items" | "umbrella">("store");
  // v18.9: cô Sáu sells umbrellas too (a tab of their own, while the game shell provides the rain layer)
  const umbrellas = useContext(UmbrellaContext) !== null;
  const umbrellaTab = tabSel === "umbrella";
  const tab = tabSel === "umbrella" ? "store" : tabSel;
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [fitsMe, setFitsMe] = useState(false);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [ownedIds, setOwnedIds] = useState<Set<string>>(new Set());
  const [coins, setCoins] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Avatar preview state
  const [previewLook, setPreviewLook] = useState<Look>(initialLook);
  // Item chosen for P2P transfer
  const [transferringItem, setTransferringItem] = useState<CatalogItem | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([fetchCatalog(), fetchMyWardrobe(token)])
      .then(([cat, wardrobe]) => {
        if (!active) return;
        setCatalog(cat);
        setOwnedIds(new Set(wardrobe.items));
        setCoins(wardrobe.coins);
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setError(storeErrorMessage(e));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  // Flash a notification message
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((curr) => (curr === msg ? null : curr));
    }, 4000);
  };

  const handleTryOn = (item: CatalogItem) => {
    if (!itemFitsGender(item, previewLook.gender === "nu" ? "nu" : "nam")) {
      showToast(`${item.name} chỉ hợp với dáng ${item.gender === "nu" ? "Nữ" : "Nam"}.`);
      return;
    }
    setPreviewLook((curr) => {
      if (item.slot === "hat") return { ...curr, hat: item.id };
      if (item.slot === "top") return { ...curr, top: item.id };
      if (item.slot === "bottom") return { ...curr, bottom: item.id };
      if (item.slot === "shoes") return { ...curr, shoes: item.id };
      if (item.slot === "neck") return { ...curr, neck: item.id };
      if (item.slot === "outfit") return { ...curr, outfit: item.id };
      if (item.slot === "wrist") return { ...curr, wrist: item.id };
      if (item.slot === "hairpin") return { ...curr, hairpin: item.id };
      return curr;
    });
  };

  const resetPreview = () => {
    setPreviewLook(initialLook);
  };

  const handleBuy = async (item: CatalogItem) => {
    if (busyItem || coins < item.price) return;
    setBusyItem(item.id);
    setError(null);
    try {
      const res = await buyFashionItem(token, item.id);
      setCoins(res.coins);
      setOwnedIds((prev) => new Set([...prev, item.id]));
      showToast(`🎉 Mua thành công ${item.name}!`);
    } catch (e) {
      setError(storeErrorMessage(e));
    } finally {
      setBusyItem(null);
    }
  };

  const handleSell = async (item: CatalogItem) => {
    if (busyItem) return;
    if (!confirm(`Bạn có chắc muốn bán lại "${item.name}" với giá ${Math.max(1, Math.floor(item.price * 0.5))} xu không?`)) {
      return;
    }
    setBusyItem(item.id);
    setError(null);
    try {
      const res = await sellFashionItem(token, item.id);
      setCoins(res.coins);
      setOwnedIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      // If previewing or wearing sold item, reset preview
      setPreviewLook((curr) => {
        const next = unequipItem(curr, item.id);
        if (!next) return curr;
        onLookUpdated?.(next);
        return next;
      });
      showToast(`💰 Đã bán lại ${item.name} và nhận ${res.refund} xu!`);
    } catch (e) {
      setError(storeErrorMessage(e));
    } finally {
      setBusyItem(null);
    }
  };

  const handleTransferred = (itemId: string, recipientName: string, giftsLeft?: number) => {
    setOwnedIds((prev) => {
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });
    setPreviewLook((curr) => {
      const next = unequipItem(curr, itemId);
      if (!next) return curr;
      onLookUpdated?.(next);
      return next;
    });
    setTransferringItem(null);
    showToast(`🎁 Đã pass lại đồ cho ${recipientName} thành công!${giftsLeft !== undefined ? ` Hôm nay còn tặng được ${giftsLeft} món.` : ""}`);
  };

  const myGender = previewLook.gender === "nu" ? "nu" : "nam";
  const filteredCatalog = filterStoreItems(catalog, { tab, category, ownedIds, fitsMe, gender: myGender });

  const genderLabel = previewLook.gender === "nu" ? "♀ Nữ" : "♂ Nam";

  return (
    <>
      {/* ParchmentModal carries its own max-w-lg; only an sm: width wins over it (as in CardTablePanel). */}
      <ParchmentModal title="🛍️ Cửa Hàng Thời Trang" onClose={onClose} className="sm:max-w-[1100px] md:h-[85vh]">
        <div className="flex h-full min-h-0 flex-1 flex-col gap-3 overflow-y-auto font-vt text-lg md:overflow-hidden">
          {/* Top Bar: Tabs & Xu Balance */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-gold-200 pb-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`pch-btn whitespace-nowrap ${tabSel === "store" ? "pch-btn-primary" : ""}`}
                onClick={() => setTab("store")}
              >
                🛍️ Gian hàng ({catalog.filter((c) => !c.starter).length})
              </button>
              <button
                type="button"
                className={`pch-btn whitespace-nowrap ${tab === "my_items" ? "pch-btn-primary" : ""}`}
                onClick={() => setTab("my_items")}
              >
                🎒 Đồ của tôi ({ownedIds.size})
              </button>
              {umbrellas && (
                <button
                  type="button"
                  className={`pch-btn whitespace-nowrap ${umbrellaTab ? "pch-btn-primary" : ""}`}
                  onClick={() => setTab("umbrella")}
                >
                  ☂️ Ô dù
                </button>
              )}
            </div>
            <div className="flex items-center gap-1 whitespace-nowrap rounded border border-gold-300 bg-cream px-3 py-1 font-bold text-amber-800 shadow-inner">
              <span>💰 Số dư:</span>
              <span className="text-xl text-amber-900">{coins} xu</span>
            </div>
          </div>

          {/* Feedback messages */}
          {toast && (
            <div className="rounded border border-emerald-400 bg-emerald-100 p-2 text-base font-bold text-emerald-800">
              {toast}
            </div>
          )}
          {error && (
            <div className="rounded border border-rose-400 bg-rose-100 p-2 text-base text-burgundy-accent" role="alert">
              {error}
            </div>
          )}

          {umbrellaTab && <div className="md:min-h-0 md:flex-1 md:overflow-y-auto"><UmbrellaShelf title="☂️ Ô dù · cô Sáu" /></div>}
          {/* Body: mirror on the left, item grid on the right; stacked on a phone. */}
          <div className={`${umbrellaTab ? "hidden" : "flex md:flex-row"} flex-col gap-4 md:min-h-0 md:flex-1`}>
            <div className="flex w-full shrink-0 flex-col items-center gap-2 self-center rounded-sm border-2 border-gold-200 bg-parchment p-3 sticky top-0 z-10 shadow-md md:max-h-full md:w-60 md:self-start md:overflow-y-auto md:shadow-none">
              <span className="text-base font-bold uppercase tracking-wide text-ink opacity-80">
                Gương Thử Đồ
              </span>
              <div className="rounded-sm border-2 border-gold-300 bg-parchment p-2 shadow-sm">
                <SpritePreview look={previewLook} mode="walk" scale={4} />
              </div>
              <span className="text-base opacity-80">Dáng: {genderLabel}</span>
              <p className="text-center text-sm opacity-75">
                Đồ có dấu ♂/♀ chỉ hợp với dáng Nam/Nữ. Bấm vào món nào để mặc thử!
              </p>
              <button type="button" className="pch-btn w-full text-sm" onClick={resetPreview}>
                🔄 Đặt lại trang phục
              </button>
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-2 md:min-h-0">
              <div className="flex flex-wrap gap-1">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setCategory(c.key)}
                    className={`whitespace-nowrap rounded-sm border px-2.5 py-0.5 text-base transition-colors ${
                      category === c.key
                        ? "border-burgundy bg-gold-200 font-bold text-burgundy"
                        : "border-gold-200 bg-cream text-ink hover:bg-gold-50"
                    }`}
                  >
                    {c.icon} {c.label}
                  </button>
                ))}
                <label className="flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-sm border border-gold-200 bg-cream px-2.5 py-0.5 text-base">
                  <input type="checkbox" checked={fitsMe} onChange={(e) => setFitsMe(e.target.checked)} />
                  Hợp với tôi
                </label>
              </div>

              {loading ? (
                <div className="flex h-64 items-center justify-center text-lg opacity-70">
                  Đang tải tiệm thời trang…
                </div>
              ) : filteredCatalog.length === 0 ? (
                <div className="flex h-64 flex-col items-center justify-center rounded-sm border-2 border-dashed border-gold-200 p-4 text-center">
                  <span className="text-3xl">🧺</span>
                  <p className="mt-2 text-base text-ink opacity-75">
                    {tab === "my_items"
                      ? "Bạn chưa có món đồ nào trong danh mục này. Hãy ghé qua gian hàng để sắm đồ nhé!"
                      : "Không tìm thấy món đồ nào."}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] content-start gap-2 overflow-x-hidden pr-1 md:min-h-0 md:flex-1 md:overflow-y-auto">
                  {filteredCatalog.map((item) => {
                    const isOwned = ownedIds.has(item.id);
                    const canAfford = coins >= item.price;
                    const isBusy = busyItem === item.id;
                    const refundPrice = Math.max(1, Math.floor(item.price * 0.5));
                    const tag = genderTag(item);
                    const fits = itemFitsGender(item, myGender);

                    return (
                      <div
                        key={item.id}
                        className={`flex min-w-0 flex-col gap-1.5 rounded-sm border-2 bg-cream p-2 transition-all ${
                          isOwned ? "border-emerald-300" : "border-gold-200 hover:border-gold-400"
                        }`}
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-col items-center gap-1 text-center"
                          onClick={() => handleTryOn(item)}
                          title="Bấm để mặc thử"
                        >
                          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-sm border border-gold-300 bg-parchment">
                            <ItemIcon id={item.id} scale={3} />
                          </div>
                          <p className="line-clamp-2 w-full break-words text-base font-bold leading-tight text-ink">
                            {item.name}
                          </p>
                          <div className="flex flex-wrap items-center justify-center gap-1.5 text-sm">
                            <span className="whitespace-nowrap rounded border border-gold-200 bg-gold-100 px-1">
                              {CATEGORIES.find((c) => c.key === item.slot)?.label ?? item.slot}
                            </span>
                            {tag && (
                              <span
                                className="whitespace-nowrap rounded border border-rose-200 bg-rose-50 px-1 font-bold text-rose-800"
                                title={item.gender === "nu" ? "Chỉ dáng Nữ mặc được" : "Chỉ dáng Nam mặc được"}
                              >
                                {tag}
                              </span>
                            )}
                            <span className="whitespace-nowrap font-bold text-amber-800">{item.price} xu</span>
                          </div>
                        </button>

                        <div className="mt-auto flex flex-wrap gap-1 border-t border-gold-100 pt-1.5">
                          <button
                            type="button"
                            className="pch-btn flex-1 whitespace-nowrap px-1 py-0.5 text-sm"
                            disabled={!fits}
                            title={fits ? undefined : "Không hợp với dáng của bạn"}
                            onClick={() => handleTryOn(item)}
                          >
                            👁️ Mặc thử
                          </button>
                          {tab === "store" ? (
                            isOwned ? (
                              <span className="flex flex-1 items-center justify-center whitespace-nowrap rounded border border-emerald-200 bg-emerald-50 px-1 text-sm font-bold text-emerald-700">
                                ✓ Đã có
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="pch-btn pch-btn-primary flex-1 whitespace-nowrap px-1 py-0.5 text-sm"
                                disabled={!canAfford || isBusy}
                                onClick={() => void handleBuy(item)}
                              >
                                {isBusy ? "…" : `Mua (${item.price}x)`}
                              </button>
                            )
                          ) : isUniformItem(item.id) ? (
                            // v20.2: the dojo's võ phục — worn from the dojo or the wardrobe, never sold or given
                            <span className="flex flex-1 items-center justify-center whitespace-nowrap rounded border border-gold-200 px-1 text-sm">
                              🥋 Võ đường cấp
                            </span>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="pch-btn flex-1 whitespace-nowrap bg-amber-50 px-1 py-0.5 text-sm"
                                disabled={isBusy}
                                title={`Bán lại nhận ${refundPrice} xu`}
                                onClick={() => void handleSell(item)}
                              >
                                {isBusy ? "…" : `Bán (${refundPrice}x)`}
                              </button>
                              <button
                                type="button"
                                className="pch-btn pch-btn-primary flex-1 whitespace-nowrap px-1 py-0.5 text-sm"
                                disabled={isBusy}
                                title="Pass lại đồ cho bạn bè trong phòng"
                                onClick={() => setTransferringItem(item)}
                              >
                                🎁 Pass
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t-2 border-gold-200 pt-2">
            <span className="text-sm opacity-75">
              * Mua đồ xong có thể vào mục &quot;Tủ đồ&quot; để mặc lên nhân vật mọi lúc!
            </span>
            <button type="button" className="pch-btn" onClick={onClose}>
              Đóng
            </button>
          </div>
        </div>
      </ParchmentModal>

      {/* Item Transfer Dialog */}
      {transferringItem && (
        <ItemTransferDialog
          item={transferringItem}
          token={token}
          myAccountId={myAccountId}
          members={members}
          onlineIds={onlineIds}
          onTransferred={handleTransferred}
          onClose={() => setTransferringItem(null)}
        />
      )}
    </>
  );
}
