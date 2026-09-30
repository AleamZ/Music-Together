"use client";

import { useEffect, useRef, useState } from "react";
import { ParchmentModal } from "@/components/game/Parchment";
import { npcCutNote, npcPay, npcQuotaLine, type NpcQuota } from "@/lib/game/economy/npc";
import { formatXu, type FishingCatalog } from "@/lib/game/fishing/catalog";
import type { FishingState } from "@/lib/game/fishing/state";
import { MARKET_DEPOT_LABEL, marketPrice } from "@/lib/game/market/depots";
import FishLine from "./FishLine";

/** 🐟 Vựa cá · cô Ba (spec §10.2): sell one fish or all of them. `market` (v18.5): Vựa cá Chợ Lớn · chú Hai, which pays
 *  +10% (econ v2; a display copy; the server's sell_fish_market decides what is paid). Econ v2 (0101): both buy through the
 *  thương lái — the panel shows the day's line (`npc`, asked with `onNeedNpc` when it opens without one), "Bán hết" at what
 *  the thương lái pays now, and the cut of a sale made while it is open (`lastSale`). */
export default function DepotPanel({ state, catalog, busy, onSell, onClose, market = false, npc = null, lastSale = null, onNeedNpc }: {
  state: FishingState | null;
  catalog: FishingCatalog | null;
  busy: boolean;
  onSell: (fishIds: string[]) => void;
  onClose: () => void;
  market?: boolean;
  npc?: NpcQuota | null;
  lastSale?: { earned: number; cut: number } | null;
  onNeedNpc?: () => void;
}) {
  const fish = state?.fish ?? [];
  const sum = fish.reduce((a, f) => a + f.price, 0);
  const total = market ? marketPrice(sum) : sum;
  const [seenSale] = useState(lastSale);                    // the sale before the panel opened: its cut is old news
  const asked = useRef(false);
  useEffect(() => {
    if (!npc && onNeedNpc && !asked.current) {
      asked.current = true;
      onNeedNpc();
    }
  }, [npc, onNeedNpc]);
  const cut = lastSale && lastSale !== seenSale ? npcCutNote(lastSale.cut) : null;
  return (
    <ParchmentModal title={market ? "🐟 Vựa cá Chợ Lớn · chú Hai" : "🐟 Vựa cá · cô Ba"} onClose={onClose} className="sm:max-w-3xl">
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        {market && (
          <span className="self-start rounded border border-emerald-400 bg-emerald-100 px-2 font-bold text-emerald-800">Giá chợ {MARKET_DEPOT_LABEL}</span>
        )}
        {npc && <p className="text-base opacity-80">{npcQuotaLine(npc)}</p>}
        {cut && <p className="text-base font-bold text-amber-800">{cut}</p>}
        {!state ? (
          <p>Đang tải giỏ đồ…</p>
        ) : fish.length === 0 ? (
          <p>{market ? "“Chưa có cá hả? Câu được con nào mang lên chợ, chú trả cao hơn ngoài ao!”" : "“Chưa có cá hả con? Ra cầu ao câu đi, cô mua hết!”"}</p>
        ) : (
          <>
            <ul>
              {fish.map((f) => (
                <FishLine key={f.id} fish={f} species={catalog?.species.find((s) => s.id === f.speciesId)} price={market ? marketPrice(f.price) : undefined}>
                  <button type="button" className="pch-btn" disabled={busy} onClick={() => onSell([f.id])}>Bán</button>
                </FishLine>
              ))}
            </ul>
            <button type="button" className="pch-btn pch-btn-primary self-center" disabled={busy} onClick={() => onSell(fish.map((f) => f.id))}>
              Bán hết ({fish.length} con · {formatXu(npc ? npcPay(npc, total) : total)})
            </button>
          </>
        )}
      </div>
    </ParchmentModal>
  );
}
