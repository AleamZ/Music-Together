"use client";

import { useState } from "react";
import ItemIcon from "@/components/game/ItemIcon";
import { ParchmentModal } from "@/components/game/Parchment";
import { boxRow, describeFarmItem, ITEM_CAP, type FarmCatalog, type FarmItem } from "@/lib/game/farm/catalog";
import { lowerFirst } from "@/lib/game/farm/gather";
import { itemCount, type FarmMine } from "@/lib/game/farm/state";
import { formatXu } from "@/lib/game/fishing/catalog";
import FieldStatus from "./FieldStatus";
import Stepper from "./Stepper";

/** The shelves (v15.2 §13.5, v15.3 §13.4): rice seed, hoa-màu seed, fertilizers, pesticides, the tools and the critter
 *  containers. */
const SECTIONS: ReadonlyArray<[string, string, (i: FarmItem) => boolean]> = [
  ["rice", "🌾 Giống lúa", (i) => i.kind === "seed" && i.upland === null],
  ["upland", "🥔 Giống hoa màu", (i) => i.kind === "seed" && i.upland !== null],
  ["fertilizer", "🧺 Phân bón", (i) => i.kind === "fertilizer"],
  ["pesticide", "🧴 Thuốc", (i) => i.kind === "pesticide"],
  ["tool", "🛠️ Nông cụ", (i) => i.kind === "tool"],
  ["critter_box", "🪣 Đồ đựng cua ốc", (i) => i.kind === "critter_box"],
];

/** A tool: bought once, no stepper (R18). */
function ToolRow({ item, mine, busy, onBuy }: { item: FarmItem; mine: FarmMine; busy: boolean; onBuy: (itemId: string, qty: number) => void }) {
  const price = item.price ?? 0;
  const owned = itemCount(mine, item.id) > 0;
  return (
    <li className="pch flex flex-col gap-1 p-2">
      <div className="flex items-center gap-2">
        <ItemIcon id={item.id} scale={3} />
        <div className="flex min-w-0 flex-1 flex-col leading-none">
          <span className="truncate text-xl">{item.name}</span>
          <span className="text-base">{formatXu(price)}</span>
        </div>
      </div>
      <p className="text-base leading-tight opacity-80">{describeFarmItem(item, [])}</p>
      {owned ? (
        <button type="button" className="pch-btn" disabled>✓ Đã có</button>
      ) : mine.coins < price ? (
        <button type="button" className="pch-btn" disabled>Không đủ xu</button>
      ) : (
        <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => onBuy(item.id, 1)}>Mua · {formatXu(price)}</button>
      )}
    </li>
  );
}

/** A critter container (v15.3 R16): bought once, no stepper; one no larger than the one I hold is no use. */
function BoxRow({ item, mine, all, busy, onBuy }: {
  item: FarmItem;
  mine: FarmMine;
  all: readonly FarmItem[];
  busy: boolean;
  onBuy: (itemId: string, qty: number) => void;
}) {
  const price = item.price ?? 0;
  const row = boxRow(item, mine.items, all);
  return (
    <li className="pch flex flex-col gap-1 p-2">
      <div className="flex items-center gap-2">
        <ItemIcon id={item.id} scale={3} />
        <div className="flex min-w-0 flex-1 flex-col leading-none">
          <span className="truncate text-xl">{item.name}</span>
          <span className="text-base">{formatXu(price)}</span>
        </div>
      </div>
      <p className="text-base leading-tight opacity-80">{describeFarmItem(item, [])}</p>
      {row.state === "owned" ? (
        <button type="button" className="pch-btn" disabled>✓ Đã có</button>
      ) : row.state === "bigger" ? (
        <button type="button" className="pch-btn" disabled>Đã có {lowerFirst(row.name)} lớn hơn</button>
      ) : mine.coins < price ? (
        <button type="button" className="pch-btn" disabled>Không đủ xu</button>
      ) : (
        <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => onBuy(item.id, 1)}>Mua · {formatXu(price)}</button>
      )}
    </li>
  );
}

/** One row: icon, name, price, its use in one line, what I hold, the quantity and the buy button. */
function Row({ item, mine, catalog, busy, onBuy }: {
  item: FarmItem;
  mine: FarmMine;
  catalog: FarmCatalog;
  busy: boolean;
  onBuy: (itemId: string, qty: number) => void;
}) {
  const price = item.price ?? 0;
  const held = itemCount(mine, item.id);
  const max = Math.min(ITEM_CAP - held, Math.floor(mine.coins / Math.max(1, price)));
  const [qty, setQty] = useState(1);
  const n = Math.min(qty, Math.max(1, max));
  return (
    <li className="pch flex flex-col gap-1 p-2">
      <div className="flex items-center gap-2">
        <ItemIcon id={item.id} scale={3} />
        <div className="flex min-w-0 flex-1 flex-col leading-none">
          <span className="truncate text-xl">{item.name}</span>
          <span className="text-base">{formatXu(price)} · có {held}</span>
        </div>
      </div>
      <p className="text-base leading-tight opacity-80">{describeFarmItem(item, catalog.varieties, catalog.uplands)}</p>
      {max < 1 ? (
        <button type="button" className="pch-btn" disabled>{held >= ITEM_CAP ? `Đã đủ ${ITEM_CAP}` : "Không đủ xu"}</button>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-1">
          <Stepper value={n} max={max} label={`Số lượng ${item.name}`} onChange={setQty} />
          <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => onBuy(item.id, n)}>
            Mua {n} · {formatXu(price * n)}
          </button>
        </div>
      )}
    </li>
  );
}

/** 🧺 Tiệm vật tư · anh Hai (spec §9, §13.3; v15.2 §13.5; v15.3 §13.4): seeds, fertilizers and pesticides by the
 *  quantity, and the tools and the critter containers once. */
export default function FarmShopPanel({ mine, catalog, failed, busy, onBuy, onReload, onClose }: {
  mine: FarmMine | null;
  catalog: FarmCatalog | null;
  failed: boolean;
  busy: boolean;
  onBuy: (itemId: string, qty: number) => void;
  onReload: () => void;
  onClose: () => void;
}) {
  return (
    <ParchmentModal title="🧺 Tiệm vật tư · anh Hai" onClose={onClose} className="max-w-2xl">
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        {!mine || !catalog ? (
          <FieldStatus failed={failed} onReload={onReload} />
        ) : (
          <>
            <p>Bạn có <b>{formatXu(mine.coins)}</b>. “Cần gì cứ lấy, anh chỉ cách dùng luôn!”</p>
            {SECTIONS.map(([id, title, shelf]) => {
              const items = catalog.items.filter((i) => shelf(i) && i.price !== null).sort((a, b) => a.sortOrder - b.sortOrder);
              if (items.length === 0) return null;
              return (
                <section key={id} className="flex flex-col gap-1">
                  <h3 className="text-xl text-burgundy">{title}</h3>
                  <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {items.map((i) => (i.kind === "tool"
                      ? <ToolRow key={i.id} item={i} mine={mine} busy={busy} onBuy={onBuy} />
                      : i.kind === "critter_box"
                        ? <BoxRow key={i.id} item={i} mine={mine} all={catalog.items} busy={busy} onBuy={onBuy} />
                        : <Row key={i.id} item={i} mine={mine} catalog={catalog} busy={busy} onBuy={onBuy} />))}
                  </ul>
                </section>
              );
            })}
          </>
        )}
      </div>
    </ParchmentModal>
  );
}
