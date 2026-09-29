"use client";

import { useCallback, useEffect, useState } from "react";
import { formatXu } from "@/lib/game/fishing/catalog";
import type { FishRow } from "@/lib/game/fishing/state";
import { furnitureOf } from "@/lib/game/housing/apartment";
import {
  AQUA_DECOR, aquariumDecor, aquariumMine, aquariumPut, aquariumTake, aquariumView, errText, MAX_DECOR, type AquaView, type Tank,
} from "@/lib/game/pets/v2";
import ItemIcon from "../ItemIcon";
import AquariumTank from "../pets/AquariumTank";
import { ParchmentModal } from "../Parchment";

const kg = (g: number) => `${(g / 1000).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} kg`;
const stars = (r: number) => "★".repeat(Math.max(1, Math.min(5, r)));

/** 🐠 Bể cá (v21, 0074): every tank in this home. Anyone let in sees the fish and the rare-fish showcase; the owner
 *  puts fish in from the bag, takes them out and buys decorations. The server owns the fish and the prices. */
export default function AquariumPanel({ token, roomId, kind, no, bag, speciesName, onBagChanged, onChanged, onClose }: {
  token: string;
  roomId: string;
  kind: "apt" | "house";
  no: number;
  bag: readonly FishRow[];
  speciesName: (id: string) => string;
  onBagChanged: () => void;
  /** The tanks changed (tell the others inside, redraw). */
  onChanged: () => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<AquaView | null>(null);
  const [mine, setMine] = useState<ReadonlySet<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<Record<number, string>>({});
  const [feed, setFeed] = useState<Record<number, number>>({});   // v22: flakes sprinkled per tank (show only)

  const load = useCallback(async () => {
    const [v, m] = await Promise.all([aquariumView(token, roomId, kind, no), aquariumMine(token).catch(() => ({ tanks: [] as Tank[], showcase: [] }))]);
    setView(v);
    setMine(new Set(m.tanks.map((t) => t.tank)));
  }, [token, roomId, kind, no]);
  useEffect(() => {
    let stop = false;
    const first = setTimeout(() => { load().catch((e) => { if (!stop) setError(errText(e)); }); }, 0);
    return () => { stop = true; clearTimeout(first); };
  }, [load]);

  const act = async (fn: () => Promise<unknown>, bagMoved: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      onChanged();
      if (bagMoved) onBagChanged();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ParchmentModal title="🐠 Bể cá" onClose={onClose} className="sm:max-w-2xl">
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto font-vt text-lg leading-tight">
        {view && view.showcase.length > 0 && (
          <section className="rounded-sm border-2 border-amber-400 bg-amber-50 p-2" data-testid="aqua-showcase">
            <p className="font-bold text-burgundy">🏆 Cá quý trưng bày</p>
            <ul className="flex flex-wrap gap-2">
              {view.showcase.map((f, i) => (
                <li key={i} className="flex items-center gap-1">
                  <ItemIcon id={f.speciesId} scale={2} />
                  <span>{speciesName(f.speciesId)} · {kg(f.weightG)} <span className="text-amber-700">{stars(f.rarity)}</span></span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {view === null && !error && <p>Đang xem bể…</p>}
        {view && view.tanks.length === 0 && <p>Nhà này chưa đặt bể cá nào.</p>}
        {view?.tanks.map((t) => {
          const own = mine.has(t.tank);
          const free = t.cap - t.fish.length;
          return (
            <section key={t.tank} className="flex flex-col gap-1 rounded-sm border-2 border-sky-300 bg-sky-50 p-2" data-testid={`tank-${t.tank}`}>
              <p className="font-bold text-burgundy">{furnitureOf(t.item)?.name ?? "Bể cá"} · {t.fish.length}/{t.cap} con</p>
              <div className="flex flex-wrap items-end gap-2">
                <AquariumTank fish={t.fish} decor={t.decor} feedSignal={feed[t.tank] ?? 0} />
                {t.fish.length > 0 && (
                  <button type="button" className="pch-btn px-1.5 py-0.5 text-sm" onClick={() => setFeed({ ...feed, [t.tank]: (feed[t.tank] ?? 0) + 1 })}>
                    🍤 Rắc thức ăn</button>
                )}
              </div>
              <ul className="flex flex-col gap-1">
                {t.fish.map((f, i) => (
                  <li key={f.id ?? i} className="flex items-center justify-between gap-2 rounded-sm border border-sky-200 bg-cream px-1.5 py-0.5">
                    <span className="flex items-center gap-1 truncate">
                      <ItemIcon id={f.speciesId} scale={2} />
                      {speciesName(f.speciesId)} · {kg(f.weightG)} <span className="text-amber-700">{stars(f.rarity)}</span>
                    </span>
                    {own && f.id && (
                      <button type="button" className="pch-btn px-1.5 py-0.5 text-sm" disabled={busy}
                        onClick={() => void act(() => aquariumTake(token, f.id!), true)}>Vớt ra giỏ</button>
                    )}
                  </li>
                ))}
                {t.fish.length === 0 && <li className="opacity-70">Bể trống.</li>}
              </ul>
              <p className="text-base">Trang trí: {t.decor.length === 0 ? "chưa có" : t.decor.map((d) => AQUA_DECOR.find((x) => x.id === d)?.name ?? d).join(", ")}</p>
              {own && (
                <>
                  {free > 0 && bag.length > 0 && (
                    <form className="flex flex-wrap items-center gap-1" onSubmit={(e) => {
                      e.preventDefault();
                      const id = pick[t.tank] ?? bag[0]?.id;
                      if (id) void act(() => aquariumPut(token, t.tank, id), true);
                    }}>
                      <select className="max-w-64 rounded border border-gold-300 bg-cream px-1" aria-label="Chọn cá thả vào bể"
                        value={pick[t.tank] ?? bag[0]?.id ?? ""} onChange={(e) => setPick({ ...pick, [t.tank]: e.target.value })}>
                        {bag.map((f) => <option key={f.id} value={f.id}>{speciesName(f.speciesId)} · {kg(f.weightG)}</option>)}
                      </select>
                      <button type="submit" className="pch-btn pch-btn-primary px-2 py-0.5 text-base" disabled={busy}>Thả vào bể</button>
                    </form>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {AQUA_DECOR.map((d) => t.decor.includes(d.id) ? (
                      <button key={d.id} type="button" className="pch-btn px-1.5 py-0.5 text-sm" disabled={busy}
                        onClick={() => void act(() => aquariumDecor(token, t.tank, d.id, false), false)}>Bỏ {d.name}</button>
                    ) : (
                      <button key={d.id} type="button" className="pch-btn px-1.5 py-0.5 text-sm" disabled={busy || t.decor.length >= MAX_DECOR}
                        onClick={() => void act(() => aquariumDecor(token, t.tank, d.id, true), false)}>+ {d.name} · {formatXu(d.price)}</button>
                    ))}
                  </div>
                </>
              )}
            </section>
          );
        })}
        <p className="text-sm opacity-80">Cá trong bể là cá sống: không tính vào giỏ, khách vào nhà đều ngắm được. Vớt ra giỏ để bán.</p>
        {error && <p role="alert" className="text-red-700">{error}</p>}
      </div>
    </ParchmentModal>
  );
}
