"use client";

import { useState, type DragEvent } from "react";
import ConfirmButton from "@/components/game/farm/ConfirmButton";
import ItemIcon from "@/components/game/ItemIcon";
import { describeItem, type ShopItem } from "@/lib/game/fishing/catalog";
import { missingText, mountWarning, PART_SLOT_NAME, PART_SLOTS, rodSummary } from "@/lib/game/fishing/gear";
import {
  partCount, rodInstanceBroken, type FishingState, type PartSlot, type RodInstance,
} from "@/lib/game/fishing/state";
import type { RodActions } from "@/hooks/useFishingController";
import WearBar from "./WearBar";

// 0115 🎣 Cần câu: every rod in the bag is its own build. A card per rod with its four slots (Lưỡi, Dây, Máy xoay, Phao):
// tap a slot (or drop a part from "Đồ lắp trong giỏ" onto it) to pick a part from the bag. Mounting binds the part to
// that rod for good, and a part replaced or taken off is thrown away — both ask first.

const DRAG_TYPE = "application/x-mt-part";

/** A rod's shown name: its own name, else the model's. */
export function rodName(r: RodInstance, items: readonly ShopItem[]): string {
  return r.name ?? items.find((i) => i.id === r.item)?.name ?? r.item;
}

/** The parts of a slot's kind the bag holds (a starter phao is always there), cheapest first. */
export function partsFor(slot: PartSlot, state: FishingState, items: readonly ShopItem[]): ShopItem[] {
  return items.filter((i) => i.kind === slot && (i.starter || partCount(state, i.id) > 0))
    .sort((a, b) => (a.price ?? 0) - (b.price ?? 0) || a.sortOrder - b.sortOrder);
}

type Pending = { rod: RodInstance; slot: PartSlot; item: string | null };

function RodCard({ rod, state, items, busy, actions, onPick }: {
  rod: RodInstance; state: FishingState; items: readonly ShopItem[]; busy: boolean; actions: RodActions;
  onPick: (p: Pending) => void;
}) {
  const [open, setOpen] = useState<PartSlot | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const name = rodName(rod, items);
  const nameOf = (id: string) => items.find((i) => i.id === id)?.name ?? id;
  const broken = rodInstanceBroken(rod);
  const fixed = (slot: PartSlot) => rod.kit && slot !== "bobber";
  const missing = missingText(rod.rig);
  const drop = (slot: PartSlot) => (e: DragEvent) => {
    const id = e.dataTransfer.getData(DRAG_TYPE);
    const it = items.find((i) => i.id === id);
    if (!it || it.kind !== slot || fixed(slot)) return;
    e.preventDefault();
    onPick({ rod, slot, item: id });
  };
  return (
    <li className={`pch flex flex-col gap-1 p-2 ${rod.equipped ? "ring-2 ring-burgundy" : ""}`} data-testid={`rod-${rod.id}`}>
      <div className="flex items-center gap-2">
        <ItemIcon id={rod.item} scale={2} />
        <span className="flex min-w-0 flex-1 flex-col leading-none">
          {renaming !== null ? (
            <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); actions.rename(rod.id, renaming); setRenaming(null); }}>
              <input className="w-32 rounded border border-ink/50 bg-parchment-200 px-1 text-base" maxLength={24} value={renaming} aria-label="Tên cần"
                onChange={(e) => setRenaming(e.target.value)} autoFocus />
              <button type="submit" className="pch-btn text-base" disabled={busy}>Lưu</button>
            </form>
          ) : (
            <span className="truncate">{name}{rod.name ? <span className="text-base opacity-70"> · {nameOf(rod.item)}</span> : null}</span>
          )}
          {rod.durability !== null && rod.maxDurability !== null && (
            <WearBar wear={{ left: rod.durability, max: rod.maxDurability }} />
          )}
        </span>
        {rod.equipped ? <span className="text-base text-burgundy">✓ Đang dùng</span>
          : broken ? <span className="text-base text-burgundy">Gãy — sửa ở tiệm chú Tư</span>
          : <button type="button" className="pch-btn" disabled={busy} onClick={() => actions.equip(rod.id)}>Dùng cây này</button>}
      </div>
      {rod.rig && <p className="text-base leading-tight opacity-80" data-testid="rod-summary">{rodSummary(rod.rig)}</p>}
      {missing && <p className="text-base text-burgundy" role="alert">⚠️ {missing}</p>}
      <ul className="grid grid-cols-2 gap-1">
        {PART_SLOTS.map((slot) => {
          const part = rod.parts[slot];
          const label = fixed(slot) ? (slot === "reel" ? "không có" : "có sẵn")
            : part ? `${nameOf(part.item)}${part.durability !== null && part.maxDurability !== null ? ` (${part.durability}/${part.maxDurability})` : ""}`
            : "— trống —";
          return (
            <li key={slot} onDragOver={(e) => { if (!fixed(slot)) e.preventDefault(); }} onDrop={drop(slot)}>
              <button type="button" className="pch-btn flex w-full items-center gap-1 text-left text-base" aria-expanded={open === slot}
                disabled={busy || fixed(slot)} onClick={() => setOpen(open === slot ? null : slot)}
                aria-label={`${PART_SLOT_NAME[slot]}: ${label}`}>
                {part && !fixed(slot) ? <ItemIcon id={part.item} scale={1} /> : null}
                <span className="min-w-0 flex-1 truncate"><b>{PART_SLOT_NAME[slot]}</b> · {label}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {open && !fixed(open) && (
        <div className="flex flex-col gap-1 rounded border border-ink/30 p-1" role="group" aria-label={`Chọn ${PART_SLOT_NAME[open]}`}>
          {partsFor(open, state, items).length === 0 && <p className="text-base opacity-75">Trong giỏ không có — tiệm chú Tư bán.</p>}
          {partsFor(open, state, items).map((i) => (
            <button key={i.id} type="button" className="pch-btn flex items-center gap-2 text-left text-base" disabled={busy}
              onClick={() => { onPick({ rod, slot: open, item: i.id }); setOpen(null); }}>
              <ItemIcon id={i.id} scale={1} />
              <span className="min-w-0 flex-1 truncate">{i.name}{i.starter ? "" : ` × ${partCount(state, i.id)}`} · {describeItem(i)}</span>
            </button>
          ))}
          {rod.parts[open] && (
            <button type="button" className="pch-btn text-base" disabled={busy}
              onClick={() => { onPick({ rod, slot: open, item: null }); setOpen(null); }}>Tháo (bỏ đi)</button>
          )}
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-1">
        {renaming === null && <button type="button" className="pch-btn text-base" disabled={busy} onClick={() => setRenaming(rod.name ?? "")}>Đặt tên</button>}
        {!rod.kit && !rod.equipped && (
          <ConfirmButton disabled={busy} warn={`Bỏ ${name} cùng mọi đồ đã lắp trên nó? Không hoàn xu.`} onConfirm={() => actions.scrap(rod.id)}>
            Bỏ cần
          </ConfirmButton>
        )}
      </div>
    </li>
  );
}

/** The bag's Cần câu section. */
export default function RodBuilds({ state, items, busy, actions }: {
  state: FishingState; items: readonly ShopItem[]; busy: boolean; actions: RodActions;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const rods = state.rods ?? [];
  const nameOf = (id: string) => items.find((i) => i.id === id)?.name ?? id;
  const loose = items.filter((i) => PART_SLOTS.includes(i.kind as PartSlot) && partCount(state, i.id) > 0);
  const confirm = () => {
    if (!pending) return;
    if (pending.item) actions.mount(pending.rod.id, pending.slot, pending.item);
    else actions.unmount(pending.rod.id, pending.slot);
    setPending(null);
  };
  const old = pending ? pending.rod.parts[pending.slot]?.item ?? null : null;
  return (
    <section className="[column-span:all]">
      <h3 className="text-xl text-burgundy">Cần câu</h3>
      <p className="text-base opacity-75">Mỗi cây cần lắp đồ riêng: bấm vào ô (hoặc kéo đồ thả vào ô) để lắp. Đồ đã lắp gắn chặt vào cây đó.</p>
      {pending && (
        <div className="pch my-1 flex flex-col gap-1 p-2" role="alertdialog" aria-label="Xác nhận">
          <span className="text-base text-burgundy">
            ⚠️ {pending.item
              ? mountWarning(nameOf(pending.item), rodName(pending.rod, items), old ? nameOf(old) : null)
              : `Tháo ${nameOf(old ?? "")} khỏi ${rodName(pending.rod, items)}? Món này sẽ bị bỏ, không về giỏ.`}
          </span>
          <div className="flex gap-1">
            <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={confirm}>{pending.item ? "Lắp" : "Tháo và bỏ"}</button>
            <button type="button" className="pch-btn" onClick={() => setPending(null)}>Thôi</button>
          </div>
        </div>
      )}
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {rods.map((r) => <RodCard key={r.id} rod={r} state={state} items={items} busy={busy} actions={actions} onPick={setPending} />)}
      </ul>
      {loose.length > 0 && (
        <>
          <p className="mt-1 text-base opacity-80">Đồ lắp trong giỏ (kéo vào ô của cần)</p>
          <ul className="flex flex-wrap gap-2">
            {loose.map((i) => (
              <li key={i.id} draggable className="flex cursor-grab items-center gap-1 text-base" title={describeItem(i)}
                onDragStart={(e) => e.dataTransfer.setData(DRAG_TYPE, i.id)}>
                <ItemIcon id={i.id} scale={1} />{i.name} × {partCount(state, i.id)}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
