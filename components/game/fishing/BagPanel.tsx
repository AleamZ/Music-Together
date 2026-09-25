"use client";

import ItemIcon from "@/components/game/ItemIcon";
import { ParchmentModal } from "@/components/game/Parchment";
import { describeItem, type FishingCatalog, type ShopItem } from "@/lib/game/fishing/catalog";
import { baitCount, ownsItem, type FishingState, type Loadout } from "@/lib/game/fishing/state";
import FishLine from "./FishLine";

/** 🎒 Giỏ đồ (spec §10.2): the fish (hand, then bucket), the owned rods and bobbers, the baits, the bait box and bucket. */
export default function BagPanel({ state, catalog, busy, onEquip, onRelease, onClose }: {
  state: FishingState | null;
  catalog: FishingCatalog | null;
  /** An RPC is in flight: the buttons wait. */
  busy: boolean;
  onEquip: (loadout: Loadout) => void;
  onRelease: (fishId: string) => void;
  onClose: () => void;
}) {
  if (!state || !catalog) {
    return (
      <ParchmentModal title="🎒 Giỏ đồ" onClose={onClose}>
        <p className="font-vt text-lg">Đang tải giỏ đồ…</p>
      </ParchmentModal>
    );
  }
  const speciesOf = (id: string) => catalog.species.find((s) => s.id === id);
  const [inHand, ...inBucket] = state.fish;
  const kind = (k: ShopItem["kind"]) => catalog.items.filter((i) => i.kind === k);
  const owned = (k: "rod" | "bobber") => kind(k).filter((i) => ownsItem(state, i));
  const bucket = kind("bucket").filter((i) => ownsItem(state, i)).sort((a, b) => (b.capacity ?? 0) - (a.capacity ?? 0))[0];
  const box = kind("bait_box").find((i) => ownsItem(state, i));

  const gearRow = (item: ShopItem, slot: keyof Loadout, count?: number) => {
    const using = state.loadout[slot] === item.id;
    return (
      <li key={item.id} className="flex items-center gap-2 py-0.5">
        <ItemIcon id={item.id} scale={2} />
        <span className="flex min-w-0 flex-1 flex-col leading-none">
          <span className="truncate">{item.name}{count !== undefined ? ` × ${count}` : ""}</span>
          <span className="truncate text-base opacity-75">{describeItem(item)}</span>
        </span>
        {using ? (
          <span className="text-base text-burgundy">✓ Đang dùng</span>
        ) : (
          <button type="button" className="pch-btn" disabled={busy} onClick={() => onEquip({ ...state.loadout, [slot]: item.id })}>Dùng</button>
        )}
      </li>
    );
  };

  return (
    <ParchmentModal title="🎒 Giỏ đồ" onClose={onClose}>
      <div className="flex flex-col gap-3 font-vt text-lg leading-tight">
        <section>
          <h3 className="text-xl text-burgundy">Cá ({state.fish.length}/{state.fishCap})</h3>
          {state.fish.length === 0 && <p className="opacity-70">Chưa có con nào — ra cầu ao quăng cần nhé!</p>}
          {inHand && (
            <>
              <p className="text-base opacity-80">Trên tay</p>
              <ul>
                <FishLine fish={inHand} species={speciesOf(inHand.speciesId)}>
                  <button type="button" className="pch-btn" disabled={busy} onClick={() => onRelease(inHand.id)}>Thả</button>
                </FishLine>
              </ul>
            </>
          )}
          {inBucket.length > 0 && (
            <>
              <p className="text-base opacity-80">Trong xô</p>
              <ul>
                {inBucket.map((f) => (
                  <FishLine key={f.id} fish={f} species={speciesOf(f.speciesId)}>
                    <button type="button" className="pch-btn" disabled={busy} onClick={() => onRelease(f.id)}>Thả</button>
                  </FishLine>
                ))}
              </ul>
            </>
          )}
        </section>
        <section>
          <h3 className="text-xl text-burgundy">Cần câu</h3>
          <ul>{owned("rod").map((i) => gearRow(i, "rod"))}</ul>
        </section>
        <section>
          <h3 className="text-xl text-burgundy">Phao</h3>
          <ul>{owned("bobber").map((i) => gearRow(i, "bobber"))}</ul>
        </section>
        <section>
          <h3 className="text-xl text-burgundy">Mồi</h3>
          <ul>{kind("bait").map((i) => gearRow(i, "bait", baitCount(state, i.id)))}</ul>
        </section>
        <section>
          <h3 className="text-xl text-burgundy">Đồ nghề</h3>
          <ul>
            <li className="flex items-center gap-2 py-0.5">
              {box ? <ItemIcon id={box.id} scale={2} /> : <span className="w-8" />}
              <span>{box ? box.name : "Hộp mồi thường"} · chứa {state.baitCap} mồi</span>
            </li>
            <li className="flex items-center gap-2 py-0.5">
              {bucket ? <ItemIcon id={bucket.id} scale={2} /> : <span className="w-8" />}
              <span>{bucket ? `${bucket.name} · đựng ${bucket.capacity ?? 0} con` : "Chưa có xô — chỉ cầm được 1 con trên tay"}</span>
            </li>
          </ul>
        </section>
      </div>
    </ParchmentModal>
  );
}
