"use client";

import { useState } from "react";
import { formatXu } from "@/lib/game/fishing/catalog";
import { buyVehicle, sellBackPrice, sellVehicle, travelErrorMessage } from "@/lib/game/travel/rpc";
import { VEHICLES, WALK_TRIP_MS } from "@/lib/game/travel/vehicles";
import { ParchmentModal } from "./Parchment";

interface VehicleShopModalProps {
  token: string;
  owned: string[];
  coins: number | null;
  onBought: (owned: string[]) => void;
  /** A vehicle sold back to ông Tám at half its price. */
  onSold?: (owned: string[]) => void;
  onClose: () => void;
}

function errText(e: unknown): string {
  const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);
  return travelErrorMessage(msg);
}

const seconds = (ms: number) => `${Math.round(ms / 1000)} giây`;

/** 🛵 Xe cộ · ông Tám (v18.5): a bicycle, a scooter and a car, bought once and kept; the fastest one owned makes the trip
 *  between the hall and Chợ Lớn shorter. Prices shown are a display copy; the server decides what is charged. */
export default function VehicleShopModal({ token, owned, coins, onBought, onSold, onClose }: VehicleShopModalProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const sell = async (id: string) => {
    if (busy) return;
    setBusy(id);
    setError(null);
    try {
      const r = await sellVehicle(token, id);
      setConfirming(null);
      (onSold ?? onBought)(r.owned);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const buy = async (id: string) => {
    if (busy) return;
    setBusy(id);
    setError(null);
    try {
      const r = await buyVehicle(token, id);
      onBought(r.owned);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <ParchmentModal title="🛵 Xe cộ · ông Tám" onClose={onClose} className="sm:max-w-[680px]">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto font-vt text-lg">
        <p className="leading-tight">
          “Có xe thì ra chợ lẹ lắm con! Đi bộ mất {seconds(WALK_TRIP_MS)}; mua một lần, xài hoài.”
        </p>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {VEHICLES.map((v) => {
            const has = owned.includes(v.id);
            const short = coins !== null && coins < v.price;
            return (
              <li key={v.id} data-testid={`vehicle-${v.id}`}
                className={`flex flex-col items-center gap-1 rounded-sm border-2 p-2 text-center ${has ? "border-emerald-500 bg-emerald-50" : "border-gold-200 bg-cream"}`}>
                <span className="flex h-14 w-14 items-center justify-center rounded-sm border border-gold-300 bg-parchment text-4xl" aria-hidden="true">
                  {v.icon}
                </span>
                <span className="text-xl font-bold text-burgundy">{v.name}</span>
                <span className="font-bold text-amber-800">{formatXu(v.price)}</span>
                <span className="rounded border border-sky-300 bg-sky-50 px-1 text-base text-sky-900">Ra chợ {seconds(v.tripMs)}</span>
                {has ? (
                  <>
                    <span className="rounded border border-emerald-400 bg-emerald-100 px-2 font-bold text-emerald-800">Đã có</span>
                    {confirming === v.id ? (
                      <span className="flex flex-col items-center gap-1 text-base">
                        <span>Bán {v.name.toLowerCase()} lấy {formatXu(sellBackPrice(v.price))}?</span>
                        <span className="flex gap-1">
                          <button type="button" className="pch-btn pch-btn-primary" disabled={busy !== null} onClick={() => void sell(v.id)}>
                            {busy === v.id ? "Đang bán…" : "Bán"}
                          </button>
                          <button type="button" className="pch-btn" disabled={busy !== null} onClick={() => setConfirming(null)}>Thôi</button>
                        </span>
                      </span>
                    ) : (
                      <button type="button" className="pch-btn" disabled={busy !== null} onClick={() => { setConfirming(v.id); setError(null); }}>
                        Bán lại ({formatXu(sellBackPrice(v.price))})
                      </button>
                    )}
                  </>
                ) : (
                  <button type="button" className="pch-btn pch-btn-primary" disabled={busy !== null} onClick={() => void buy(v.id)}
                    title={short ? "Chưa đủ xu" : undefined}>
                    {busy === v.id ? "Đang mua…" : "Mua"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {coins !== null && <p className="text-base opacity-80">Trong túi: {formatXu(coins)}</p>}
        {error && (
          <div className="rounded border border-rose-400 bg-rose-100 p-2 text-base text-burgundy-accent" role="alert">{error}</div>
        )}
        <div className="flex justify-end border-t-2 border-gold-200 pt-2">
          <button type="button" className="pch-btn" onClick={onClose}>Đóng</button>
        </div>
      </div>
    </ParchmentModal>
  );
}
