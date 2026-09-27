"use client";

import { useEffect, useRef, useState } from "react";
import { drawPet } from "@/lib/game/art/pets";
import { formatXu } from "@/lib/game/fishing/catalog";
import { PET_ITEMS, PET_SLOTS, PET_SPECIES, SPECIES, fashionFor, foodOf, toyOf, MAX_PETS, type PetSlot, type PetSpecies } from "@/lib/game/pets/catalog";
import { petErrorMessage, sanitizePetName, type PetLook } from "@/lib/game/pets/model";
import {
  buyPet, buyPetItem, equipPet, feedPet, lookOf, playPet, renamePet, setActivePet, type Pet, type PetsState,
} from "@/lib/game/pets/rpc";
import { ParchmentModal } from "./Parchment";

type Tab = "buy" | "mine" | "care" | "fashion";
const TABS: ReadonlyArray<[Tab, string]> = [["mine", "🐾 Thú của tôi"], ["buy", "🏪 Mua thú"], ["care", "🍖 Đồ ăn & đồ chơi"], ["fashion", "🎀 Thời trang"]];
const SLOT_NAME: Record<PetSlot, string> = { head: "Đầu", neck: "Cổ", body: "Áo" };

/** A pet drawn at `scale` (canvas; the art is the game's). */
function PetSprite({ look, scale = 3 }: { look: PetLook; scale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (!c) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, 20 * scale, 22 * scale);
    c.setTransform(scale, 0, 0, scale, 0, 0);
    drawPet(c, look, "down", 0, 10, 20);
  }, [look, scale]);
  return <canvas ref={ref} width={20 * scale} height={22 * scale} className="[image-rendering:pixelated]" aria-hidden="true" />;
}

function errText(e: unknown): string {
  const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);
  return petErrorMessage(msg);
}

const bar = (v: number, color: string) => (
  <span className="inline-block h-2 w-20 overflow-hidden rounded-sm border border-gold-300 bg-parchment align-middle">
    <span className={`block h-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
  </span>
);

interface PetShopModalProps {
  token: string;
  state: PetsState | null;
  coins: number | null;
  /** An action returned a new state (and maybe a new balance). */
  onState: (s: PetsState) => void;
  onClose: () => void;
}

/** 🐾 Tiệm thú cưng · cô Mười (v18.12): buy a pet, take one out or leave it in the shop, feed it, play, dress it up.
 *  Prices shown are a display copy; the server decides. */
export default function PetShopModal({ token, state, coins, onState, onClose }: PetShopModalProps) {
  const pets = state?.pets ?? [];
  const [tab, setTab] = useState<Tab>(pets.length > 0 ? "mine" : "buy");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<{ species: PetSpecies; variant: string } | null>(null);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [selected, setSelected] = useState<number | null>(state?.active ?? pets[0]?.id ?? null);
  const items = state?.items ?? {};
  const has = (id: string) => (items[id] ?? 0) > 0;
  const nowMs = state?.serverNowMs ?? 0;

  const run = async (f: () => Promise<PetsState>, after?: (s: PetsState) => void) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const s = await f();
      onState(s);
      after?.(s);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const sel = pets.find((p) => p.id === selected) ?? pets[0] ?? null;

  const petCard = (p: Pet) => {
    const active = state?.active === p.id;
    const playWait = p.playReadyMs !== null && p.playReadyMs > nowMs;
    return (
      <li key={p.id} data-testid={`pet-${p.id}`}
        className={`flex flex-col gap-1 rounded-sm border-2 p-2 ${active ? "border-emerald-500 bg-emerald-50" : "border-gold-200 bg-cream"}`}>
        <div className="flex items-center gap-2">
          <PetSprite look={lookOf(p)} />
          <div className="flex min-w-0 flex-col">
            {renaming?.id === p.id ? (
              <form className="flex gap-1" onSubmit={(e) => {
                e.preventDefault();
                const n = sanitizePetName(renaming.name);
                if (!n) { setError(petErrorMessage("bad name")); return; }
                void run(() => renamePet(token, p.id, n), () => setRenaming(null));
              }}>
                <input className="w-28 rounded border border-gold-300 bg-parchment px-1" maxLength={16} value={renaming.name}
                  aria-label="Tên mới" onChange={(e) => setRenaming({ id: p.id, name: e.target.value })} />
                <button type="submit" className="pch-btn" disabled={busy}>Lưu</button>
              </form>
            ) : (
              <button type="button" className="truncate text-left text-xl font-bold text-burgundy" title="Đổi tên"
                onClick={() => setRenaming({ id: p.id, name: p.name })}>{SPECIES[p.species].icon} {p.name} ✎</button>
            )}
            <span className="text-base">No {bar(p.fullness, "bg-amber-500")} Vui {bar(p.happy, "bg-pink-500")}</span>
            <span className="text-base opacity-80">
              {p.sulking ? "😾 Đang dỗi vì đói — cho ăn đi!" : active ? "Đang theo bạn" : "Gửi ở tiệm"}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <button type="button" className="pch-btn" disabled={busy || !has(foodOf(p.species).id)} title={`${foodOf(p.species).name} (còn ${items[foodOf(p.species).id] ?? 0})`}
            onClick={() => void run(() => feedPet(token, p.id))}>Cho ăn ({items[foodOf(p.species).id] ?? 0})</button>
          <button type="button" className="pch-btn" disabled={busy || !has(toyOf(p.species).id) || playWait || p.sulking}
            title={has(toyOf(p.species).id) ? toyOf(p.species).name : `Cần ${toyOf(p.species).name}`}
            onClick={() => void run(() => playPet(token, p.id))}>{playWait ? "Vừa chơi" : "Chơi"}</button>
          {active ? (
            <button type="button" className="pch-btn" disabled={busy} onClick={() => void run(() => setActivePet(token, null))}>Gửi tiệm</button>
          ) : (
            <button type="button" className="pch-btn pch-btn-primary" disabled={busy || p.sulking} onClick={() => void run(() => setActivePet(token, p.id))}>Dắt theo</button>
          )}
        </div>
      </li>
    );
  };

  return (
    <ParchmentModal title="🐾 Tiệm thú cưng · cô Mười" onClose={onClose} className="sm:max-w-[760px]">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto font-vt text-lg">
        <div className="flex flex-wrap gap-1" role="tablist">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id}
              className={`pch-btn ${tab === id ? "pch-btn-primary" : ""}`} onClick={() => { setTab(id); setError(null); }}>{label}</button>
          ))}
        </div>

        {tab === "mine" && (pets.length === 0
          ? <p>“Chưa có bé nào hết! Qua bên Mua thú chọn một bé đi con.”</p>
          : <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">{pets.map(petCard)}</ul>)}

        {tab === "buy" && (
          <>
            <p className="leading-tight">“Bé nào cũng dễ thương hết! Mỗi bé có tài riêng khi vui vẻ theo con. Nuôi tối đa {MAX_PETS} bé.”</p>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {PET_SPECIES.map((sp) => {
                const s = SPECIES[sp];
                return (
                  <li key={sp} data-testid={`species-${sp}`} className="flex flex-col items-center gap-1 rounded-sm border-2 border-gold-200 bg-cream p-2 text-center">
                    <PetSprite look={{ species: sp, variant: pick?.species === sp ? pick.variant : s.variants[0].id, head: null, neck: null, body: null, happy: true }} />
                    <span className="text-xl font-bold text-burgundy">{s.icon} {s.name}</span>
                    <span className="font-bold text-amber-800">{formatXu(s.price)}</span>
                    <span className="text-base leading-tight">{s.buff}</span>
                    <span className="flex flex-wrap justify-center gap-1">
                      {s.variants.map((v) => (
                        <button key={v.id} type="button" className={`pch-btn text-base ${pick?.species === sp && pick.variant === v.id ? "pch-btn-primary" : ""}`}
                          onClick={() => setPick({ species: sp, variant: v.id })}>{v.name}</button>
                      ))}
                    </span>
                  </li>
                );
              })}
            </ul>
            {pick && (
              <form className="flex flex-wrap items-center gap-2 rounded-sm border-2 border-gold-300 bg-parchment p-2" onSubmit={(e) => {
                e.preventDefault();
                const n = name.trim() === "" ? null : sanitizePetName(name);
                if (name.trim() !== "" && !n) { setError(petErrorMessage("bad name")); return; }
                void run(() => buyPet(token, pick.species, pick.variant, n), () => { setPick(null); setName(""); setTab("mine"); });
              }}>
                <span>{SPECIES[pick.species].icon} {SPECIES[pick.species].name} {SPECIES[pick.species].variants.find((v) => v.id === pick.variant)?.name}</span>
                <input className="w-40 rounded border border-gold-300 bg-cream px-1" maxLength={16} placeholder="Đặt tên (tùy)" value={name}
                  aria-label="Tên thú cưng" onChange={(e) => setName(e.target.value)} />
                <button type="submit" className="pch-btn pch-btn-primary" disabled={busy || pets.length >= MAX_PETS}>
                  {busy ? "Đang mua…" : `Mua ${formatXu(SPECIES[pick.species].price)}`}
                </button>
              </form>
            )}
          </>
        )}

        {tab === "care" && (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {PET_ITEMS.filter((i) => i.kind === "food" || i.kind === "toy").map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 rounded-sm border border-gold-200 bg-cream px-2 py-1">
                <span>{SPECIES[i.species].icon} {i.name} <span className="opacity-70">· {formatXu(i.price)}</span>
                  {i.kind === "food" ? <span className="opacity-70"> · còn {items[i.id] ?? 0}</span> : has(i.id) ? <span className="text-emerald-700"> · đã có</span> : null}
                </span>
                {i.kind === "food" ? (
                  <span className="flex gap-1">
                    <button type="button" className="pch-btn" disabled={busy} onClick={() => void run(() => buyPetItem(token, i.id, 1))}>Mua 1</button>
                    <button type="button" className="pch-btn" disabled={busy} onClick={() => void run(() => buyPetItem(token, i.id, 5))}>Mua 5</button>
                  </span>
                ) : (
                  <button type="button" className="pch-btn" disabled={busy || has(i.id)} onClick={() => void run(() => buyPetItem(token, i.id))}>Mua</button>
                )}
              </li>
            ))}
          </ul>
        )}

        {tab === "fashion" && (
          sel === null ? <p>Mua một bé trước đã nhé.</p> : (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <PetSprite look={lookOf(sel)} scale={4} />
                <label className="flex items-center gap-1">Bé:
                  <select className="rounded border border-gold-300 bg-cream px-1" value={sel.id} onChange={(e) => setSelected(Number(e.target.value))}>
                    {pets.map((p) => <option key={p.id} value={p.id}>{SPECIES[p.species].icon} {p.name}</option>)}
                  </select>
                </label>
              </div>
              {PET_SLOTS.map((slot) => {
                const list = fashionFor(sel.species, slot);
                if (list.length === 0) return null;
                return (
                  <div key={slot} className="flex flex-wrap items-center gap-1">
                    <span className="w-10 font-bold">{SLOT_NAME[slot]}</span>
                    <button type="button" className={`pch-btn text-base ${sel[slot] === null ? "pch-btn-primary" : ""}`} disabled={busy}
                      onClick={() => void run(() => equipPet(token, sel.id, slot, null))}>Không</button>
                    {list.map((i) => has(i.id) ? (
                      <button key={i.id} type="button" className={`pch-btn text-base ${sel[slot] === i.id ? "pch-btn-primary" : ""}`} disabled={busy}
                        onClick={() => void run(() => equipPet(token, sel.id, slot, i.id))}>{i.name}</button>
                    ) : (
                      <button key={i.id} type="button" className="pch-btn text-base" disabled={busy}
                        onClick={() => void run(() => buyPetItem(token, i.id))}>Mua {i.name} · {formatXu(i.price)}</button>
                    ))}
                  </div>
                );
              })}
            </div>
          )
        )}

        {coins !== null && <p className="text-base opacity-80">Trong túi: {formatXu(coins)}</p>}
        {error && <div className="rounded border border-rose-400 bg-rose-100 p-2 text-base text-burgundy-accent" role="alert">{error}</div>}
        <div className="flex justify-end border-t-2 border-gold-200 pt-2">
          <button type="button" className="pch-btn" onClick={onClose}>Đóng</button>
        </div>
      </div>
    </ParchmentModal>
  );
}
