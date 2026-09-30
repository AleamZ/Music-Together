"use client";

import { HudSlotted } from "../hud/HudSlot";
import { useState } from "react";
import type { UseMining } from "@/hooks/useMining";
import {
  BUFF_NAME, CRAFT_ITEMS, craftItem, DAILY_DIGS, effectText, ingredientName, MAX_UPGRADE, PICKAXES, pickaxe, RECIPES,
  UPGRADE_CHANCE, UPGRADE_MATS, upgradeCoins, upgradeEffectText,
} from "@/lib/game/mining/catalog";
import { npcQuotaLine } from "@/lib/game/economy/npc";
import type { MineState } from "@/lib/game/mining/rpc";
import { rarityInfo } from "@/lib/game/rarity";
import { ParchmentModal } from "../Parchment";
import MineGame from "./MineGame";
import AnvilGame from "../craftmg/AnvilGame";
import BrewGame from "../craftmg/BrewGame";
import { CraftFrame } from "../craftmg/shared";
import { QUALITY_NAME } from "@/lib/game/craftmg/games";

// Mỏ đá's overlays (v21 #19, #26, #89): the dig, chú Tám's counter, the anvil, bà Sáu's cauldron, the potion bag, and a
// small chip for active buffs and the bag.

/** A name in its rarity colour, with the tier label. */
export function RarityName({ name, tier, icon }: { name: string; tier: number; icon?: string }) {
  const r = rarityInfo(tier);
  return (
    <span className="inline-flex items-center gap-1">
      {icon && <span aria-hidden="true">{icon}</span>}
      <b style={{ color: r.color }}>{name}</b>
      <span className="rounded px-1 text-sm leading-tight" style={{ color: r.color, background: r.bg }}>{r.label}</span>
    </span>
  );
}

const have = (s: MineState | null, id: string): number => (id === "fish" ? s?.fish ?? 0 : s?.bag[id] ?? 0);

function Needs({ s, needs, times = 1 }: { s: MineState | null; needs: Readonly<Record<string, number>>; times?: number }) {
  return (
    <span className="text-base">
      {Object.entries(needs).map(([id, q], k) => {
        const ok = have(s, id) >= q * times;
        return (
          <span key={id} className={ok ? undefined : "text-burgundy"}>
            {k > 0 && ", "}{ingredientName(id)} {have(s, id)}/{q * times}
          </span>
        );
      })}
    </span>
  );
}

function ShopPanel({ m }: { m: UseMining }) {
  const [tab, setTab] = useState<"sell" | "buy">("sell");
  const s = m.state;
  const sellable = CRAFT_ITEMS.filter((i) => (i.kind === "ore" || i.kind === "herb") && have(s, i.id) > 0);
  return (
    <ParchmentModal title="⛏️ Lán chú Tám · Mỏ đá" onClose={() => m.openPanel(null)} className="sm:max-w-[640px]">
      <div className="flex flex-col gap-2 font-vt text-lg">
        <div className="flex gap-2">
          <button type="button" className={`pch-btn ${tab === "sell" ? "pch-btn-primary" : ""}`} onClick={() => setTab("sell")}>Bán quặng</button>
          <button type="button" className={`pch-btn ${tab === "buy" ? "pch-btn-primary" : ""}`} onClick={() => setTab("buy")}>Mua cuốc</button>
          <span className="ml-auto self-center">💰 {s?.coins ?? "…"} xu</span>
        </div>
        {tab === "sell" && m.npc && <p className="text-base opacity-80">{npcQuotaLine(m.npc)}</p>}
        {tab === "sell" && (sellable.length === 0 ? <p>Chưa có quặng hay thảo dược nào để bán.</p> : (
          <ul className="flex flex-col gap-1">
            {sellable.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2">
                <RarityName name={i.name} tier={i.rarity} icon={i.icon} />
                <span>×{have(s, i.id)} · {i.price} xu/cái</span>
                <span className="ml-auto flex gap-1">
                  <button type="button" className="pch-btn" disabled={m.busy} onClick={() => m.sell(i.id, 1)}>Bán 1</button>
                  <button type="button" className="pch-btn" disabled={m.busy} onClick={() => m.sell(i.id, have(s, i.id))}>Bán hết</button>
                </span>
              </li>
            ))}
          </ul>
        ))}
        {tab === "buy" && (
          <ul className="flex flex-col gap-1">
            {PICKAXES.map((p) => {
              const own = s?.tools.find((t) => t.id === p.id);
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-2">
                  <RarityName name={p.name} tier={p.rarity} icon="⛏️" />
                  <span>bậc {p.tier} · độ bền {p.durability} · {p.price} xu</span>
                  <span className="ml-auto">
                    {own && own.durability > 0
                      ? <span>Đang có ({own.durability}/{own.max ?? p.durability}){own.level > 0 ? ` +${own.level}` : ""}</span>
                      : <button type="button" className="pch-btn" disabled={m.busy || (s?.coins ?? 0) < p.price} onClick={() => m.buy(p.id)}>
                          {own ? "Mua lại (gãy)" : "Mua"}
                        </button>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-base opacity-80">Quặng càng hiếm càng cần cuốc tốt: vàng, ngọc cần cuốc thép; kim cương, tinh thể lửa cần cuốc kim cương.
          Mỗi ngày đào tối đa {DAILY_DIGS} lượt.</p>
      </div>
    </ParchmentModal>
  );
}

function AnvilPanel({ m }: { m: UseMining }) {
  const s = m.state;
  const rows: Array<{ id: string; name: string; kind: "rod" | "net" | "pickaxe"; price: number | null; level: number; dur: string; tier: number }> = [
    ...(s?.tools ?? []).map((t) => {
      const p = pickaxe(t.id);
      return { id: t.id, name: p?.name ?? t.id, kind: "pickaxe" as const, price: p?.price ?? null, level: t.level, dur: `${t.durability}/${t.max ?? "?"}`, tier: p?.rarity ?? 1 };
    }),
    ...(s?.gear ?? []).map((g) => ({
      id: g.id, name: g.name, kind: g.kind, price: g.price, level: g.level,
      dur: g.durability === null ? "không hỏng" : `${g.durability}/${g.max ?? "?"}`, tier: Math.min(5, 1 + Math.floor((g.price ?? 0) / 1500)),
    })),
  ];
  return (
    <ParchmentModal title="🔨 Đe rèn · nâng cấp đồ nghề" onClose={() => m.openPanel(null)} className="sm:max-w-[720px]">
      <div className="flex flex-col gap-2 font-vt text-lg">
        <p className="text-base opacity-80">Mỗi lần nâng cấp tốn xu và quặng; thợ rèn có thể thất bại (mất nguyên liệu, giữ cấp). Tối đa +{MAX_UPGRADE}.
          Nện búa đúng lúc thanh sắt sáng rực: tỉ lệ ±10%.</p>
        {m.lastUpgrade && <p role="status"><b>{m.lastUpgrade}</b></p>}
        {rows.length === 0 && <p>Bạn chưa có cần câu, lưới hay cuốc nào.</p>}
        <ul className="flex flex-col gap-2">
          {rows.map((r) => {
            const max = r.level >= MAX_UPGRADE;
            const mats = max ? {} : UPGRADE_MATS[r.level];
            const coins = upgradeCoins(r.price, r.level);
            const matsOk = Object.entries(mats).every(([id, q]) => have(s, id) >= q);
            return (
              <li key={r.id} className="flex flex-col gap-0.5 border-b border-[#3a2418]/20 pb-1">
                <div className="flex flex-wrap items-center gap-2">
                  <RarityName name={`${r.name}${r.level > 0 ? ` +${r.level}` : ""}`} tier={r.tier} />
                  <span className="text-base">({r.dur}) · {upgradeEffectText(r.kind, r.level)}</span>
                </div>
                {max ? <span className="text-base">Đã tối đa.</span> : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base">Lên +{r.level + 1}: {coins} xu, <Needs s={s} needs={mats} /> · tỉ lệ {UPGRADE_CHANCE[r.level] / 10}%</span>
                    <button type="button" className="pch-btn ml-auto" disabled={m.busy || !matsOk || (s?.coins ?? 0) < coins} onClick={() => m.upgrade(r.id, r.name)}>Rèn nâng cấp</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </ParchmentModal>
  );
}

function PotionList({ m }: { m: UseMining }) {
  const s = m.state;
  const potions = CRAFT_ITEMS.filter((i) => i.kind === "potion" && have(s, i.id) > 0);
  if (potions.length === 0) return <p>Chưa có bình thuốc nào.</p>;
  return (
    <ul className="flex flex-col gap-1">
      {potions.map((i) => {
        const r = RECIPES.find((x) => x.id === i.id);
        return (
          <li key={i.id} className="flex flex-wrap items-center gap-2">
            <RarityName name={i.name} tier={i.rarity} icon={i.icon} />
            <span>×{have(s, i.id)}</span>
            {(s?.quality ?? []).filter((q) => q.item === i.id).map((q) => (
              <span key={q.tier} className="rounded bg-[#3fbf6a]/20 px-1 text-sm">{QUALITY_NAME[q.tier]} ×{q.qty}</span>
            ))}
            {r && <span className="text-base">{effectText(r)}</span>}
            <button type="button" className="pch-btn ml-auto" disabled={m.busy} onClick={() => m.drink(i.id)}>Uống</button>
          </li>
        );
      })}
    </ul>
  );
}

function Buffs({ s, offset }: { s: MineState | null; offset: number }) {
  const [now] = useState(() => Date.now());
  const list = (s?.buffs ?? []).filter((b) => b.until + offset > now);
  if (list.length === 0) return null;
  return (
    <p>Đang có: {list.map((b) => `${BUFF_NAME[b.kind]}${b.power > 1 ? ` ×${b.power}` : ""} (còn ~${Math.max(1, Math.ceil((b.until + offset - now) / 60000))} phút)`).join(" · ")}</p>
  );
}

function CauldronPanel({ m }: { m: UseMining }) {
  const s = m.state;
  const [tab, setTab] = useState<"brew" | "bag">("brew");
  return (
    <ParchmentModal title="🧪 Vạc thuốc bà Sáu" onClose={() => m.openPanel(null)} className="sm:max-w-[720px]">
      <div className="flex flex-col gap-2 font-vt text-lg">
        <div className="flex gap-2">
          <button type="button" className={`pch-btn ${tab === "brew" ? "pch-btn-primary" : ""}`} onClick={() => setTab("brew")}>Nấu thuốc</button>
          <button type="button" className={`pch-btn ${tab === "bag" ? "pch-btn-primary" : ""}`} onClick={() => setTab("bag")}>Túi thuốc</button>
          <span className="ml-auto self-center">💰 {s?.coins ?? "…"} xu</span>
        </div>
        {tab === "brew" && (
          <ul className="flex flex-col gap-2">
            {RECIPES.map((r) => {
              const it = craftItem(r.id);
              const ok = Object.entries(r.ingredients).every(([id, q]) => have(s, id) >= q) && (s?.coins ?? 0) >= r.fee;
              return (
                <li key={r.id} className="flex flex-col gap-0.5 border-b border-[#3a2418]/20 pb-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <RarityName name={it?.name ?? r.id} tier={it?.rarity ?? 1} icon={it?.icon} />
                    <span className="text-base">{effectText(r)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Needs s={s} needs={r.ingredients} /><span className="text-base">· công {r.fee} xu</span>
                    <button type="button" className="pch-btn ml-auto" disabled={m.busy || !ok} onClick={() => m.brew(r.id, 1)}>Nấu</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {tab === "bag" && (<><Buffs s={s} offset={m.clockOffset} /><PotionList m={m} /></>)}
        <p className="text-base opacity-80">Thảo dược hái ở các bãi rêu trong mỏ; quặng đào ở các mỏ đá; cá lấy từ xô câu.
          Giữ lửa trong dải xanh khi nấu: thuốc Tốt / Hoàn hảo mạnh hơn 5 / 10%.</p>
      </div>
    </ParchmentModal>
  );
}

function BagPanel({ m }: { m: UseMining }) {
  const s = m.state;
  const mats = CRAFT_ITEMS.filter((i) => i.kind !== "potion" && have(s, i.id) > 0);
  return (
    <ParchmentModal title="🎒 Túi mỏ & thuốc" onClose={() => m.openPanel(null)} className="sm:max-w-[640px]">
      <div className="flex flex-col gap-2 font-vt text-lg">
        <Buffs s={s} offset={m.clockOffset} />
        <h3 className="text-xl text-burgundy">Thuốc</h3>
        <PotionList m={m} />
        <h3 className="text-xl text-burgundy">Quặng & thảo dược</h3>
        {mats.length === 0 ? <p>Trống.</p> : (
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {mats.map((i) => <li key={i.id}><RarityName name={i.name} tier={i.rarity} icon={i.icon} /> ×{have(s, i.id)}</li>)}
          </ul>
        )}
        <h3 className="text-xl text-burgundy">Cuốc chim</h3>
        {(s?.tools.length ?? 0) === 0 ? <p>Chưa có — mua ở lán chú Tám trong Mỏ đá.</p> : (
          <ul>{s?.tools.map((t) => <li key={t.id}>{pickaxe(t.id)?.name ?? t.id}{t.level > 0 ? ` +${t.level}` : ""} · {t.durability}/{t.max ?? "?"}</li>)}</ul>
        )}
      </div>
    </ParchmentModal>
  );
}

export default function MiningOverlays({ m, showChip }: { m: UseMining; showChip: boolean }) {
  return (
    <>
      {showChip && m.panel === null && m.dig === null && m.craft === null && (
        <HudSlotted>
          <button type="button" className="pch-btn font-vt text-lg" onClick={() => m.openPanel("bag")}
            aria-label="Túi mỏ và thuốc">
            🎒 Túi mỏ{(m.state?.buffs.length ?? 0) > 0 ? " · ✨" : ""}
          </button>
        </HudSlotted>
      )}
      {m.dig && <MineGame view={m.dig} onEnd={m.finishDig} onClose={m.closeDig} />}
      {m.craft && (
        <CraftFrame title={m.craft.title} label={m.craft.game === "brew" ? "Nấu thuốc" : "Rèn nâng cấp"} phase={m.craft.phase}
          message={m.craft.message} good={m.craft.good} onClose={m.closeCraft}>
          {m.craft.game === "brew"
            ? <BrewGame key={m.craft.key} centre={m.craft.centre} live={m.craft.live} onEnd={m.finishBrew} />
            : <AnvilGame key={m.craft.key} live={m.craft.live} onEnd={m.finishAnvil} />}
        </CraftFrame>
      )}
      {m.panel === "shop" && <ShopPanel m={m} />}
      {m.panel === "anvil" && <AnvilPanel m={m} />}
      {m.panel === "cauldron" && <CauldronPanel m={m} />}
      {m.panel === "bag" && <BagPanel m={m} />}
    </>
  );
}
