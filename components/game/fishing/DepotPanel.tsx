"use client";

import { ParchmentModal } from "@/components/game/Parchment";
import { formatXu, type FishingCatalog } from "@/lib/game/fishing/catalog";
import type { FishingState } from "@/lib/game/fishing/state";
import { marketPrice } from "@/lib/game/market/depots";
import FishLine from "./FishLine";

/** 🐟 Vựa cá · cô Ba (spec §10.2): sell one fish or all of them. `market` (v18.5): Vựa cá Chợ Lớn · chú Hai, which pays
 *  +20% (a display copy; the server's sell_fish_market decides what is paid). */
export default function DepotPanel({ state, catalog, busy, onSell, onClose, market = false }: {
  state: FishingState | null;
  catalog: FishingCatalog | null;
  busy: boolean;
  onSell: (fishIds: string[]) => void;
  onClose: () => void;
  market?: boolean;
}) {
  const fish = state?.fish ?? [];
  const sum = fish.reduce((a, f) => a + f.price, 0);
  const total = market ? marketPrice(sum) : sum;
  return (
    <ParchmentModal title={market ? "🐟 Vựa cá Chợ Lớn · chú Hai" : "🐟 Vựa cá · cô Ba"} onClose={onClose} className="sm:max-w-3xl">
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        {market && (
          <span className="self-start rounded border border-emerald-400 bg-emerald-100 px-2 font-bold text-emerald-800">Giá chợ +20%</span>
        )}
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
              Bán hết ({fish.length} con · {formatXu(total)})
            </button>
          </>
        )}
      </div>
    </ParchmentModal>
  );
}
