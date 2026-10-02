"use client";

import ConfirmButton from "@/components/game/farm/ConfirmButton";
import ItemIcon from "@/components/game/ItemIcon";
import { ParchmentModal } from "@/components/game/Parchment";
import {
  AMMO_PELLET, FOOD_DOG, TANK_CHARGES, TOOL_SICKLE, TOOL_SLING, TOOL_SPRAYER, type CritterKind, type FarmItem,
} from "@/lib/game/farm/catalog";
import { critterCount, heldBox, lowerFirst, visitsLeft } from "@/lib/game/farm/gather";
import type { FarmMine } from "@/lib/game/farm/state";
import { describeItem, formatXu, type FishingCatalog, type ShopItem } from "@/lib/game/fishing/catalog";
import { missingText, ownedOfSlot, rigLines } from "@/lib/game/fishing/gear";
import {
  baitCount, groundbaitCount, ownsItem, rodBroken, wearFor, type FishingState, type GearSlot, type Loadout,
} from "@/lib/game/fishing/state";
import type { RodActions } from "@/hooks/useFishingController";
import FishLine from "./FishLine";
import RodBuilds from "./RodBuilds";
import WearBar from "./WearBar";

/** The field's side of the bag (v15.2 R29): my farm stock, the farm catalog's items and critter kinds (none before 0018),
 *  the server's clock, and Nạp thuốc. */
export interface BagFarm {
  mine: FarmMine;
  items: readonly FarmItem[];
  critters: readonly CritterKind[];
  now: number;
  busy: boolean;
  onLoad: (itemId: string) => void;
}

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
        {/* v17 §12.4: the ná and the dog food, once the shop sells them (0019) */}
        {items.some((i) => i.id === TOOL_SLING) && (
          <li className="flex items-center gap-2 py-0.5">
            <ItemIcon id={TOOL_SLING} scale={2} />
            <span>{has(TOOL_SLING) ? `Ná — còn ${mine.items[AMMO_PELLET] ?? 0} viên đạn đất` : `Chưa có ná — tiệm anh Hai bán ${priceOf(TOOL_SLING)}`}</span>
          </li>
        )}
        {has(FOOD_DOG) && (
          <li className="flex items-center gap-2 py-0.5">
            <ItemIcon id={FOOD_DOG} scale={2} />
            <span>Thức ăn chó — {mine.items[FOOD_DOG]} bịch</span>
          </li>
        )}
      </ul>
    </section>
  );
}

/** 🦀 Cua & ốc (v15.3 §13.4): the container and how full it is (or where to buy one), a line per kind held, and today's
 *  visits left. */
function Critters({ farm }: { farm: BagFarm }) {
  const { mine, items, critters, now } = farm;
  const box = heldBox(mine.items, items);
  const n = critterCount(mine.critters);
  const shop = items.filter((i) => i.kind === "critter_box").sort((a, b) => a.sortOrder - b.sortOrder)
    .map((b) => `${lowerFirst(b.name)} ${formatXu(b.price ?? 0)}`).join(", ");
  return (
    <section>
      <h3 className="text-xl text-burgundy">🦀 Cua & ốc</h3>
      <ul>
        <li className="flex items-center gap-2 py-0.5">
          {box ? <ItemIcon id={box.id} scale={2} /> : <span className="w-8" />}
          <span>{box ? `${box.name} · ${n}/${mine.critterCap} con` : `Tay không · ${n}/${mine.critterCap} con — tiệm anh Hai bán ${shop}`}</span>
        </li>
        {critters.filter((k) => (mine.critters[k.id]?.n ?? 0) > 0).map((k) => (
          <li key={k.id} className="flex items-center gap-2 py-0.5">
            <ItemIcon id={k.id} scale={2} />
            <span>{k.name} × {mine.critters[k.id].n} · {formatXu(mine.critters[k.id].xu)}</span>
          </li>
        ))}
      </ul>
      <p className="text-base opacity-80">Bán ở vựa cô Út · hôm nay còn {visitsLeft(mine.gather, now)} lượt bắt cua, mò ốc.</p>
    </section>
  );
}

/** 0110: when a groundbait stops working, as the Vietnam clock reads it ("14:05"). */
function untilText(until: string): string {
  return new Date(until).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" });
}

/** 🎒 Giỏ đồ (spec §10.2, v15.2 R29, v15.3 §13.4): the fish (hand, then bucket), the rig (0110: the rod and its parts —
 *  hook, line, reel, phao — mounted and unmounted here), the baits, the groundbait, the bait box and bucket, and — once
 *  the field has loaded — the farm tools and the cua & ốc. */
export default function BagPanel({ state, catalog, busy, onEquip, onRelease, onClose, farm = null, groundbaitPick = null,
  onPickGroundbait, onGroundbait, onNotebook, rods = null }: {
  state: FishingState | null;
  catalog: FishingCatalog | null;
  /** An RPC is in flight: the buttons wait. */
  busy: boolean;
  /** 0110: mount an item on a slot, or unmount it (null). */
  onEquip: (slot: GearSlot, item: string | null) => void;
  onRelease: (fishId: string) => void;
  onClose: () => void;
  farm?: BagFarm | null;
  /** 0110: the groundbait the HUD throws, picking one, and throwing one where I last fished. */
  groundbaitPick?: string | null;
  onPickGroundbait?: (item: string) => void;
  onGroundbait?: (item: string) => void;
  /** 0110: open Sổ tay câu cá (only once bought). */
  onNotebook?: () => void;
  /** 0115: the rods one by one; with a server from 0115 (state.rods) the Cần câu section is the per-rod builder. */
  rods?: RodActions | null;
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
  const rig = state.rig ?? null;
  const missing = missingText(rig);
  const bucket = kind("bucket").filter((i) => ownsItem(state, i)).sort((a, b) => (b.capacity ?? 0) - (a.capacity ?? 0))[0];
  const box = kind("bait_box").filter((i) => ownsItem(state, i)).sort((a, b) => (b.capacity ?? 0) - (a.capacity ?? 0))[0];

  const gearRow = (item: ShopItem, slot: keyof Loadout & GearSlot, count?: number) => {
    const using = state.loadout[slot] === item.id;
    const wear = wearFor(state, item.id);
    const broken = slot === "rod" && rodBroken(state, item.id);
    const removable = slot === "hook" || slot === "line" || slot === "reel" || slot === "bobber";                // 0110
    return (
      <li key={item.id} className="flex items-center gap-2 py-0.5">
        <ItemIcon id={item.id} scale={2} />
        <span className="flex min-w-0 flex-1 flex-col leading-none">
          <span className="truncate">{item.name}{count !== undefined ? ` × ${count}` : ""}</span>
          <span className="truncate text-base opacity-75">{describeItem(item)}</span>
          {wear && <WearBar wear={wear} />}
        </span>
        {broken ? (
          <span className="text-base text-burgundy">Gãy — sửa ở tiệm chú Tư</span>
        ) : using ? (
          <span className="flex items-center gap-1">
            <span className="text-base text-burgundy">✓ Đang dùng</span>
            {removable && <button type="button" className="pch-btn text-base" disabled={busy} onClick={() => onEquip(slot, null)}>Tháo</button>}
          </span>
        ) : (
          <button type="button" className="pch-btn" disabled={busy} onClick={() => onEquip(slot, item.id)}>{removable ? "Lắp" : "Dùng"}</button>
        )}
      </li>
    );
  };
  /** 0110: one part's section: the owned ones (mount / unmount), or where to buy one. */
  const partSection = (slot: "hook" | "line" | "reel", title: string) => {
    const mine = ownedOfSlot(slot, catalog.items, state.owned);
    return (
      <section key={slot}>
        <h3 className="text-xl text-burgundy">{title}</h3>
        {mine.length === 0 ? <p className="text-base opacity-75">Chưa có — tiệm chú Tư bán.</p>
          : <ul>{mine.map((i) => gearRow(i, slot))}</ul>}
      </section>
    );
  };
  const builds = rods !== null && (state.rods?.length ?? 0) > 0;                       // 0115
  const gbKinds = kind("groundbait");
  const gbOn = state.groundbaitOn ?? null;

  return (
    <ParchmentModal title="🎒 Giỏ đồ" onClose={onClose} className="sm:max-w-4xl">
      <div className="gap-6 font-vt text-lg leading-tight md:columns-2 [&>section]:mb-3 [&>section]:break-inside-avoid">
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
        {builds && rods && <RodBuilds state={state} items={catalog.items} busy={busy} actions={rods} />}
        {!builds && <section>
          <h3 className="text-xl text-burgundy">Cần câu</h3>
          {rig && (
            <p className="text-base leading-tight opacity-80" data-testid="rig-summary">
              {rig.kit ? "Cần gỗ đủ bộ sẵn (lưỡi, dây, phao) — đồ lắp chỉ dùng cho cần khác. " : ""}{rigLines(rig).join(" · ")}
            </p>
          )}
          {missing && <p className="text-base text-burgundy" role="alert">⚠️ {missing}</p>}
          <ul>{owned("rod").map((i) => gearRow(i, "rod"))}</ul>
        </section>}
        {/* 0110: the parts (0115: mounted per rod, in RodBuilds) */}
        {!builds && partSection("hook", "Lưỡi câu")}
        {!builds && partSection("line", "Dây câu")}
        {!builds && partSection("reel", "Máy xoay")}
        {kind("net").some((i) => state.owned.includes(i.id)) && (
          <section>
            <h3 className="text-xl text-burgundy">Lưới</h3>
            <ul>
              {kind("net").filter((i) => state.owned.includes(i.id)).map((i) => {
                const wear = wearFor(state, i.id);
                return (
                  <li key={i.id} className="flex items-center gap-2 py-0.5">
                    <ItemIcon id={i.id} scale={2} />
                    <span className="flex min-w-0 flex-1 flex-col leading-none">
                      <span className="truncate">{i.name}{wear ? ` · còn ${wear.left} lần quăng` : ""}</span>
                      <span className="truncate text-base opacity-75">Đứng ở bờ ao hoặc cầu ao, bấm “Quăng lưới”.</span>
                      {wear && <WearBar wear={wear} />}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {!builds && <section>
          <h3 className="text-xl text-burgundy">Phao</h3>
          <ul>{owned("bobber").map((i) => gearRow(i, "bobber"))}</ul>
        </section>}
        <section>
          <h3 className="text-xl text-burgundy">Mồi</h3>
          <ul>{kind("bait").map((i) => gearRow(i, "bait", baitCount(state, i.id)))}</ul>
        </section>
        {gbKinds.length > 0 && (
          <section>
            <h3 className="text-xl text-burgundy">Thính</h3>
            {gbOn && (
              <p className="text-base text-burgundy">
                🌾 {catalog.items.find((i) => i.id === gbOn.item)?.name ?? gbOn.item} đang tỏa mùi · tới {untilText(gbOn.until)}
              </p>
            )}
            <ul>
              {gbKinds.map((i) => {
                const n = groundbaitCount(state, i.id);
                return (
                  <li key={i.id} className="flex items-center gap-2 py-0.5">
                    <ItemIcon id={i.id} scale={2} />
                    <span className="min-w-0 flex-1 truncate">{i.name} × {n}</span>
                    {groundbaitPick === i.id && n > 0 ? <span className="text-base text-burgundy">✓ Đang chọn</span>
                      : onPickGroundbait && <button type="button" className="pch-btn text-base" disabled={n < 1} onClick={() => onPickGroundbait(i.id)}>Chọn</button>}
                    {onGroundbait && (
                      <button type="button" className="pch-btn text-base" disabled={busy || n < 1} onClick={() => onGroundbait(i.id)}>Rải</button>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="text-base opacity-75">Rải ở chỗ vừa câu (hoặc bấm “Rải thính” ở mép ao): 10 phút, loài ưa thính cắn nhiều gấp 3.</p>
          </section>
        )}
        {state.notebook && onNotebook && (
          <section>
            <h3 className="text-xl text-burgundy">Sổ tay câu cá</h3>
            <button type="button" className="pch-btn" onClick={onNotebook}>📖 Mở sổ tay</button>
          </section>
        )}
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
        {farm && farm.critters.length > 0 && <Critters farm={farm} />}
      </div>
    </ParchmentModal>
  );
}
