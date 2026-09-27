"use client";

import { useEffect, useState } from "react";
import { formatXu } from "@/lib/game/fishing/catalog";
import type { FishRow } from "@/lib/game/fishing/state";
import { errText, fishToBag, fishToFridge, fridgeState, type Fridge } from "@/lib/game/housing/apartment";
import { ParchmentModal } from "../Parchment";

const kg = (g: number) => `${(g / 1000).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} kg`;

/** 🧊 Tủ lạnh (v19.2): move fish between the bag and the fridge. Fridge fish don't count against the bag; selling is from
 *  the bag only (at the depots). */
export default function FridgePanel({ token, bag, speciesName, onBagChanged, onClose }: {
  token: string;
  bag: readonly FishRow[];
  speciesName: (id: string) => string;
  /** The bag changed on the server: reload the fishing state. */
  onBagChanged: () => void;
  onClose: () => void;
}) {
  const [fridge, setFridge] = useState<Fridge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    fridgeState(token).then((f) => { if (!stop) setFridge(f); }, (e) => { if (!stop) setError(errText(e)); });
    return () => { stop = true; };
  }, [token]);
  const move = async (fn: () => Promise<Fridge>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setFridge(await fn());
      onBagChanged();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const full = fridge !== null && fridge.fish.length >= fridge.cap;
  const bagFull = fridge !== null && bag.length >= fridge.bagCap;
  return (
    <ParchmentModal title="🧊 Tủ lạnh" onClose={onClose} className="sm:max-w-2xl">
      <div className="grid gap-3 font-vt text-lg leading-tight sm:grid-cols-2">
        <section className="flex flex-col gap-1">
          <p className="text-xl font-bold text-burgundy">🎒 Giỏ ({bag.length}{fridge ? `/${fridge.bagCap}` : ""})</p>
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto" data-testid="fridge-bag">
            {bag.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 rounded-sm border border-gold-200 bg-cream px-1.5 py-0.5">
                <span className="truncate">{speciesName(f.speciesId)} · {kg(f.weightG)} · {formatXu(f.price)}</span>
                <button type="button" className="pch-btn px-1.5 py-0.5 text-sm" disabled={busy || !fridge || full}
                  onClick={() => void move(() => fishToFridge(token, f.id))}>Cất tủ →</button>
              </li>
            ))}
            {bag.length === 0 && <li className="opacity-70">Giỏ trống.</li>}
          </ul>
        </section>
        <section className="flex flex-col gap-1">
          <p className="text-xl font-bold text-burgundy">🧊 Tủ lạnh ({fridge ? `${fridge.fish.length}/${fridge.cap}` : "…"})</p>
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto" data-testid="fridge-fish">
            {fridge?.fish.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 rounded-sm border border-sky-200 bg-sky-50 px-1.5 py-0.5">
                <span className="truncate">{speciesName(f.speciesId)} · {kg(f.weightG)} · {formatXu(f.price)}</span>
                <button type="button" className="pch-btn px-1.5 py-0.5 text-sm" disabled={busy || bagFull}
                  onClick={() => void move(() => fishToBag(token, f.id))}>← Lấy ra</button>
              </li>
            ))}
            {fridge && fridge.fish.length === 0 && <li className="opacity-70">Tủ trống.</li>}
          </ul>
        </section>
        <p className="text-sm opacity-80 sm:col-span-2">Cá trong tủ không tính vào giỏ. Muốn bán thì lấy ra giỏ rồi mang ra vựa.</p>
        {error && <p role="alert" className="text-red-700 sm:col-span-2">{error}</p>}
      </div>
    </ParchmentModal>
  );
}
