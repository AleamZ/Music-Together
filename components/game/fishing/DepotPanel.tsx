"use client";

import { ParchmentModal } from "@/components/game/Parchment";
import { formatXu, type FishingCatalog } from "@/lib/game/fishing/catalog";
import type { FishingState } from "@/lib/game/fishing/state";
import FishLine from "./FishLine";

/** 🐟 Vựa cá · cô Ba (spec §10.2): sell one fish or all of them. */
export default function DepotPanel({ state, catalog, busy, onSell, onClose }: {
  state: FishingState | null;
  catalog: FishingCatalog | null;
  busy: boolean;
  onSell: (fishIds: string[]) => void;
  onClose: () => void;
}) {
  const fish = state?.fish ?? [];
  const total = fish.reduce((a, f) => a + f.price, 0);
  return (
    <ParchmentModal title="🐟 Vựa cá · cô Ba" onClose={onClose}>
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        {!state ? (
          <p>Đang tải giỏ đồ…</p>
        ) : fish.length === 0 ? (
          <p>“Chưa có cá hả con? Ra cầu ao câu đi, cô mua hết!”</p>
        ) : (
          <>
            <ul>
              {fish.map((f) => (
                <FishLine key={f.id} fish={f} species={catalog?.species.find((s) => s.id === f.speciesId)}>
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
