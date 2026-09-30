"use client";

import { useEffect, useState } from "react";
import ItemIcon from "@/components/game/ItemIcon";
import { ParchmentModal } from "@/components/game/Parchment";
import { formatXu, hookClassName, RARITY_COLOR, RARITY_NAME, type FishingCatalog } from "@/lib/game/fishing/catalog";
import { bitesAt, hoursText } from "@/lib/game/fishing/gear";
import type { Notebook } from "@/lib/game/fishing/rpc";

/** 📖 Sổ tay câu cá (0110): every species with its habits — the hook it needs, the baits and groundbaits it likes, the
 *  hours it bites (Vietnam clock) and a line about it. Only an account that bought the notebook gets the habits
 *  (fishing_notebook); `load` answers null otherwise, and the panel shows the names and prices alone. */
export default function NotebookPanel({ catalog, load, onClose }: {
  catalog: FishingCatalog | null;
  load: () => Promise<Notebook | null>;
  onClose: () => void;
}) {
  const [book, setBook] = useState<Notebook | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    let active = true;
    void load().then((b) => {
      if (!active) return;
      setBook(b);
      setDone(true);
    });
    return () => {
      active = false;
    };
  }, [load]);
  const itemName = (id: string) => catalog?.items.find((i) => i.id === id)?.name ?? id;
  const names = (ids: string[]) => (ids.length ? ids.map(itemName).join(", ") : "—");
  const species = catalog?.species ?? [];
  const habit = (id: string) => book?.species.find((h) => h.id === id) ?? null;
  return (
    <ParchmentModal title="📖 Sổ tay câu cá" onClose={onClose} className="sm:max-w-4xl">
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        {!done || !catalog ? <p>Đang mở sổ…</p> : (
          <>
            {book ? <p className="text-base opacity-80">Bây giờ là {book.hour} giờ — loài có dấu 🟢 đang cắn câu.</p>
              : <p className="text-base opacity-80">Chưa có sổ tay — chỉ xem được tên và giá. Tiệm chú Tư bán Sổ tay câu cá.</p>}
            <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {species.map((s) => {
                const h = habit(s.id);
                return (
                  <li key={s.id} className="pch flex flex-col gap-0.5 p-2" data-testid={`habit-${s.id}`}>
                    <div className="flex items-center gap-2">
                      <ItemIcon id={s.id} scale={2} />
                      <span className="flex-1 truncate" style={{ color: RARITY_COLOR[s.rarity] }}>{s.name}</span>
                      {h && bitesAt(h.hours, book!.hour) && <span title="Đang cắn câu">🟢</span>}
                    </div>
                    <span className="text-base opacity-80">{RARITY_NAME[s.rarity]} · {formatXu(s.pricePerKg)}/kg</span>
                    {h && (
                      <span className="text-base leading-tight">
                        {h.hook ? `Cần ${hookClassName(h.hook).toLowerCase()}` : "Lưỡi nào cũng được"} · Mồi: {names(h.baits)} · Thính: {names(h.groundbaits)}
                        {" · "}Giờ cắn: {hoursText(h.hours)}
                      </span>
                    )}
                    {h?.note && <span className="text-base italic opacity-80">{h.note}</span>}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </ParchmentModal>
  );
}
