"use client";

import { ParchmentModal } from "@/components/game/Parchment";
import { formatXu, RARITY_COLOR, type FishingCatalog } from "@/lib/game/fishing/catalog";
import { DEEP_SPECIES, type ExtrasState } from "@/lib/game/fishing/extras";

/** v21 (0076) ⛵ Bến ghe: buy the ghe, go out to the deep water (its own fish), come back to the pier. */
export default function BoatPanel({ state, catalog, coins, busy, onBuy, onBoard, onLeave, onCast, onClose }: {
  state: ExtrasState | null;
  catalog: FishingCatalog | null;
  coins: number | null;
  busy: boolean;
  onBuy: () => void;
  onBoard: () => void;
  onLeave: () => void;
  onCast: () => void;
  onClose: () => void;
}) {
  const deep = (catalog?.species ?? []).filter((s) => DEEP_SPECIES.includes(s.id));
  const boat = state?.boat;
  return (
    <ParchmentModal title="⛵ Bến ghe · vùng nước sâu" onClose={onClose} className="sm:max-w-xl">
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        {!boat ? <p>Đang tải…</p> : (
          <>
            <p>
              Giữa ao có vùng nước sâu, cá to và hiếm hơn hẳn ngoài cầu. Chèo ghe ra đó rồi quăng cần như thường —
              mồi, cần, phao và cách kéo y hệt, chỉ có cá là khác.
            </p>
            {!boat.owned ? (
              <div className="flex flex-wrap items-center gap-2">
                <span>Ghe gỗ: <b>{formatXu(boat.price)}</b></span>
                <button type="button" className="pch-btn pch-btn-primary" disabled={busy || (coins !== null && coins < boat.price)} onClick={onBuy}>
                  {coins !== null && coins < boat.price ? "Không đủ xu" : "Mua ghe"}
                </button>
              </div>
            ) : boat.aboard ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={onCast}>🎣 Quăng cần</button>
                <button type="button" className="pch-btn" disabled={busy} onClick={onLeave}>⚓ Chèo về bến</button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={onBoard}>⛵ Lên ghe ra vùng nước sâu</button>
              </div>
            )}
            <h3 className="text-xl text-burgundy">Cá vùng nước sâu</h3>
            <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {deep.map((s) => (
                <li key={s.id} className="pch flex items-center justify-between gap-2 px-2 py-1">
                  <span style={{ color: RARITY_COLOR[s.rarity] }}>{s.name}</span>
                  <span className="text-base opacity-80">{s.rarity === 5 ? "Huyền thoại" : s.rarity === 4 ? "Quý" : "Hiếm"}</span>
                </li>
              ))}
            </ul>
            <p className="text-base opacity-80">Cá thường ngoài vùng sâu vẫn cắn câu; bão thì không ra ghe được. Có khi câu lên cả bản đồ kho báu!</p>
          </>
        )}
      </div>
    </ParchmentModal>
  );
}
