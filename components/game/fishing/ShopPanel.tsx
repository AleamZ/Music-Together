"use client";

import { Fragment, useState } from "react";
import ItemIcon from "@/components/game/ItemIcon";
import { ParchmentModal } from "@/components/game/Parchment";
import { UmbrellaShelf } from "@/components/game/rain/UmbrellaShelf";
import { describeItem, formatXu, type FishingCatalog, type ShopItem } from "@/lib/game/fishing/catalog";
import { BAIT_HINT } from "@/lib/game/fishing/messages";
import { baitTotal, maxBuyQty, needsRepair, ownsItem, repairPrice, wearFor, type FishingState } from "@/lib/game/fishing/state";

const KIND_ORDER: ReadonlyArray<ShopItem["kind"]> = ["fishing_kit", "rod", "net", "bobber", "bait", "bait_box", "bucket"];

/** One shop tile: icon, name, price, effect and the buy button (bait: with a quantity). */
function Tile({ item, state, busy, onBuy }: { item: ShopItem; state: FishingState; busy: boolean; onBuy: (itemId: string, qty: number) => void }) {
  const price = item.price ?? 0;
  const max = maxBuyQty(state, item);
  const choices = [...new Set([1, 5, 10, max])].filter((q) => q >= 1 && q <= max).sort((a, b) => a - b);
  const [qty, setQty] = useState(1);
  const n = Math.min(qty, Math.max(1, max));
  let button;
  if (item.kind !== "bait" && ownsItem(state, item)) {
    button = <button type="button" className="pch-btn" disabled>Đã có</button>;
  } else if (max < 1) {
    const full = item.kind === "bait" && baitTotal(state) >= state.baitCap;
    button = <button type="button" className="pch-btn" disabled>{full ? "Hộp mồi đầy" : "Không đủ xu"}</button>;
  } else {
    button = (
      <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => onBuy(item.id, item.kind === "bait" ? n : 1)}>
        Mua{item.kind === "bait" ? ` ${n} · ${formatXu(price * n)}` : ""}
      </button>
    );
  }
  return (
    <li className="pch flex flex-col gap-1 p-2">
      <div className="flex items-center gap-2">
        <ItemIcon id={item.id} scale={3} />
        <div className="flex min-w-0 flex-col leading-none">
          <span className="truncate text-xl">{item.name}</span>
          <span className="text-base">{formatXu(price)}{item.kind === "bait" ? " / con" : ""}</span>
        </div>
      </div>
      <p className="text-base leading-tight opacity-80">{describeItem(item)}</p>
      {item.kind === "bait" && choices.length > 1 && (
        <div className="flex flex-wrap gap-1" role="group" aria-label={`Số lượng ${item.name}`}>
          {choices.map((q) => (
            <button key={q} type="button" className="pch-btn text-base" aria-pressed={n === q} onClick={() => setQty(q)}>
              {q === max && q > 10 ? `Tối đa ${q}` : q}
            </button>
          ))}
        </div>
      )}
      {button}
    </li>
  );
}

/** v18.2 🔧 Sửa cần: each owned rod below its max durability, with its repair price (30% of the rod's). */
function Repairs({ items, state, busy, onRepair }: { items: ShopItem[]; state: FishingState; busy: boolean; onRepair: (itemId: string) => void }) {
  const worn = items.filter((i) => needsRepair(state, i));
  return (
    <section>
      <h3 className="text-xl text-burgundy">🔧 Sửa cần</h3>
      {worn.length === 0 ? <p className="text-base opacity-80">Cần của bạn còn tốt cả.</p> : (
        <ul className="flex flex-col gap-1">
          {worn.map((i) => {
            const w = wearFor(state, i.id);
            const cost = repairPrice(i);
            return (
              <li key={i.id} className="flex flex-wrap items-center gap-2">
                <ItemIcon id={i.id} scale={2} />
                <span className="flex-1">{i.name} · {w ? `${w.left}/${w.max}` : ""}{w && w.left <= 0 ? " · gãy" : ""}</span>
                <button type="button" className="pch-btn pch-btn-primary" disabled={busy || state.coins < cost} onClick={() => onRepair(i.id)}>
                  Sửa · {formatXu(cost)}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** 🎣 Tiệm đồ câu · chú Tư (spec §10.2, v18.2): rods, nets, bobbers, bait, the bait box, buckets, and Sửa cần. Econ v2
 *  (0101): a line before the bait says a better bait wants a better rod. */
export default function ShopPanel({ state, catalog, busy, onBuy, onRepair = () => {}, onClose }: {
  state: FishingState | null;
  catalog: FishingCatalog | null;
  busy: boolean;
  onBuy: (itemId: string, qty: number) => void;
  /** v18.2 Sửa cần. */
  onRepair?: (itemId: string) => void;
  onClose: () => void;
}) {
  const items = (catalog?.items ?? [])
    .filter((i) => i.price !== null)
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.sortOrder - b.sortOrder);
  return (
    <ParchmentModal title="🎣 Tiệm đồ câu · chú Tư" onClose={onClose} className="sm:max-w-5xl">
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        {!state || !catalog ? (
          <p>Đang tải tiệm…</p>
        ) : (
          <>
            <p>Bạn có <b>{formatXu(state.coins)}</b>.</p>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((i, k) => (
                <Fragment key={i.id}>
                  {i.kind === "bait" && items[k - 1]?.kind !== "bait" && (
                    <li className="col-span-full text-base italic leading-tight opacity-80">{BAIT_HINT}</li>
                  )}
                  <Tile item={i} state={state} busy={busy} onBuy={onBuy} />
                </Fragment>
              ))}
            </ul>
            <Repairs items={catalog.items} state={state} busy={busy} onRepair={onRepair} />
            <UmbrellaShelf />{/* v18.9 */}
          </>
        )}
      </div>
    </ParchmentModal>
  );
}
