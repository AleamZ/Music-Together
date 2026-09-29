"use client";

import { ParchmentModal } from "@/components/game/Parchment";
import { formatXu, RARITY_COLOR, type FishingCatalog } from "@/lib/game/fishing/catalog";
import { DEEP_SPECIES, type ExtrasState } from "@/lib/game/fishing/extras";
import { RIVER_SPECIES } from "@/lib/game/river/species";

/** v21 (0076) ⛵ Bến ghe: buy the ghe; v22 (0086): row it out to Sông Cái (the rowing minigame) and fish the river. */
export default function BoatPanel({ state, catalog, coins, busy, onBuy, onSail, onClose }: {
  state: ExtrasState | null;
  catalog: FishingCatalog | null;
  coins: number | null;
  busy: boolean;
  onBuy: () => void;
  /** Row out to Sông Cái (null: not offered here). */
  onSail: (() => void) | null;
  onClose: () => void;
}) {
  const river = (catalog?.species ?? []).filter((s) => DEEP_SPECIES.includes(s.id) || RIVER_SPECIES.includes(s.id))
    .sort((a, b) => a.rarity - b.rarity);
  const boat = state?.boat;
  return (
    <ParchmentModal title="⛵ Bến ghe · ra Sông Cái" onClose={onClose} className="sm:max-w-xl">
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        {!boat ? <p>Đang tải…</p> : (
          <>
            <p>
              Có ghe thì chèo ra Sông Cái — sông lớn, cá to và hiếm hơn hẳn ngoài ao. Ra tới sông, lái ghe đi khắp mặt nước
              rồi bấm E để quăng cần ngay chỗ ghe đậu; mấy bãi cá (Bãi Lau, Ghềnh Đá Đỏ, Vũng Ngát) hay có cá lớn.
            </p>
            <p className="text-base opacity-80">Cần cấp 3. Chèo theo nhịp để ra khơi; về bến thì chèo ở Bến sông hoặc bấm ⚓.</p>
            {!boat.owned ? (
              <div className="flex flex-wrap items-center gap-2">
                <span>Ghe gỗ: <b>{formatXu(boat.price)}</b></span>
                <button type="button" className="pch-btn pch-btn-primary" disabled={busy || (coins !== null && coins < boat.price)} onClick={onBuy}>
                  {coins !== null && coins < boat.price ? "Không đủ xu" : "Mua ghe"}
                </button>
              </div>
            ) : onSail && (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={onSail}>🛶 Chèo ra Sông Cái</button>
              </div>
            )}
            <h3 className="text-xl text-burgundy">Cá Sông Cái</h3>
            <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {river.map((s) => (
                <li key={s.id} className="pch flex items-center justify-between gap-2 px-2 py-1">
                  <span style={{ color: RARITY_COLOR[s.rarity] }}>{s.name}</span>
                  <span className="text-base opacity-80">{s.rarity === 5 ? "Huyền thoại" : s.rarity === 4 ? "Quý" : "Hiếm"}</span>
                </li>
              ))}
            </ul>
            <p className="text-base opacity-80">Cá thường của ao vẫn cắn câu trên sông; bão thì không ra ghe được. Có khi câu lên cả bản đồ kho báu!</p>
          </>
        )}
      </div>
    </ParchmentModal>
  );
}
