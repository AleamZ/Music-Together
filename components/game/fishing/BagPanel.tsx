"use client";

import ConfirmButton from "@/components/game/farm/ConfirmButton";
import ItemIcon from "@/components/game/ItemIcon";
import { ParchmentModal } from "@/components/game/Parchment";
import { TANK_CHARGES, TOOL_SICKLE, TOOL_SPRAYER, type FarmItem } from "@/lib/game/farm/catalog";
import type { FarmMine } from "@/lib/game/farm/state";
import { describeItem, formatXu, type FishingCatalog, type ShopItem } from "@/lib/game/fishing/catalog";
import { baitCount, ownsItem, type FishingState, type Loadout } from "@/lib/game/fishing/state";
import FishLine from "./FishLine";

/** The field's side of the bag (v15.2 R29): my farm stock, the farm catalog's items, and Nạp thuốc. */
export interface BagFarm { mine: FarmMine; items: readonly FarmItem[]; busy: boolean; onLoad: (itemId: string) => void }

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** 🌾 Nông cụ (v15.2 §13.5): the sickle, the sprayer's tank, and a Nạp button per pesticide held. Loading over other
 *  charges pours them away, so it asks first; a tank full of the same pesticide waits. */
function FarmTools({ farm }: { farm: BagFarm }) {
  const { mine, items, busy, onLoad } = farm;
  const has = (id: string) => (mine.items[id] ?? 0) > 0;
  const nameOf = (id: string) => items.find((i) => i.id === id)?.name ?? id;
  const priceOf = (id: string) => formatXu(items.find((i) => i.id === id)?.price ?? 0);
  const tank = mine.tank;
  return (
    <section>
      <h3 className="text-xl text-burgundy">🌾 Nông cụ</h3>
      <ul>
        <li className="flex items-center gap-2 py-0.5">
          <ItemIcon id={TOOL_SICKLE} scale={2} />
          <span>{has(TOOL_SICKLE) ? "Liềm — gặt lúa 6 phần" : `Chưa có liềm — tiệm anh Hai bán ${priceOf(TOOL_SICKLE)}`}</span>
        </li>
        <li className="flex items-center gap-2 py-0.5">
          <ItemIcon id={TOOL_SPRAYER} scale={2} />
          <span>
            {!has(TOOL_SPRAYER) ? `Chưa có bình phun — tiệm anh Hai bán ${priceOf(TOOL_SPRAYER)}`
              : tank?.item ? `Bình phun — ${nameOf(tank.item)} · còn ${tank.charges}/${TANK_CHARGES} lần` : "Bình phun — trống"}
          </span>
        </li>
        {has(TOOL_SPRAYER) && items.filter((i) => i.kind === "pesticide" && has(i.id)).map((p) => {
          const full = tank?.item === p.id && tank.charges >= TANK_CHARGES;
          const left = tank?.item && tank.charges > 0 ? tank : null;
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-2 py-0.5">
              <ConfirmButton disabled={busy || full} onConfirm={() => onLoad(p.id)}
                warn={left ? `Bình còn ${left.charges} lần ${lower(nameOf(left.item!))}. Nạp ${lower(p.name)} sẽ đổ bỏ phần còn lại — nạp chứ?` : undefined}>
                Nạp {lower(p.name)} ({mine.items[p.id]} chai)
              </ConfirmButton>
              {full && <span className="text-base opacity-80">Bình đang đầy thuốc này.</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** 🎒 Giỏ đồ (spec §10.2, v15.2 R29): the fish (hand, then bucket), the owned rods and bobbers, the baits, the bait box
 *  and bucket, and — once the field has loaded — the farm tools. */
export default function BagPanel({ state, catalog, busy, onEquip, onRelease, onClose, farm = null }: {
  state: FishingState | null;
  catalog: FishingCatalog | null;
  /** An RPC is in flight: the buttons wait. */
  busy: boolean;
  onEquip: (loadout: Loadout) => void;
  onRelease: (fishId: string) => void;
  onClose: () => void;
  farm?: BagFarm | null;
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
        {farm && <FarmTools farm={farm} />}
      </div>
    </ParchmentModal>
  );
}
