"use client";

import { useState } from "react";
import { formatXu } from "@/lib/game/fishing/catalog";
import { assetValue, band, freeQty, inBand, kindIcon, type Asset } from "@/lib/game/economy/model";

export interface SellPick { asset: Asset; qty: number; price: number }

const keyOf = (a: Asset) => `${a.kind}:${a.ref}`;

/** Pick one of my assets (a fish, a fashion item, kg of produce) and a price inside the band. `extra` renders the
 *  fee line and the submit button for the pick (null while it is not valid). */
export default function SellForm({ assets, minValue = 0, busy, submit, note }: {
  assets: Asset[];
  /** Only assets worth at least this (the auction house). */
  minValue?: number;
  busy: boolean;
  submit: { label: (p: SellPick) => string; onSubmit: (p: SellPick) => void };
  note?: (p: SellPick) => string;
}) {
  const free = assets.filter((a) => freeQty(a) > 0);
  const [key, setKey] = useState("");
  const [qtyText, setQtyText] = useState("");
  const [priceText, setPriceText] = useState("");
  const asset = free.find((a) => keyOf(a) === key) ?? null;
  const qty = asset?.kind === "produce" ? Math.max(1, Math.min(freeQty(asset), Number(qtyText || freeQty(asset)) | 0)) : 1;
  const value = asset ? assetValue(asset, qty) : 0;
  const b = band(value);
  const price = Number(priceText || value);
  const ok = asset !== null && value >= minValue && inBand(price, value);
  const pick: SellPick | null = asset && ok ? { asset, qty, price } : null;

  if (free.length === 0) return <p>Bạn chưa có món nào bán được (cá, đồ thời trang mua ở tiệm, nông sản).</p>;
  return (
    <div className="flex flex-col gap-2" data-testid="econ-sell-form">
      <label className="flex flex-wrap items-center gap-2">
        <span>Món hàng:</span>
        <select aria-label="Món hàng" className="max-w-full rounded border border-gold-300 bg-cream px-1" value={key}
          onChange={(e) => { setKey(e.target.value); setQtyText(""); setPriceText(""); }}>
          <option value="">— chọn —</option>
          {free.map((a) => (
            <option key={keyOf(a)} value={keyOf(a)} disabled={assetValue(a, freeQty(a)) < minValue}>
              {kindIcon(a.kind)} {a.name}{a.kind === "produce" ? ` (còn ${freeQty(a)} kg)` : ""} · {formatXu(a.value)}{a.kind === "produce" ? "/kg" : ""}
            </option>
          ))}
        </select>
      </label>
      {asset && (
        <>
          {asset.kind === "produce" && (
            <label className="flex flex-wrap items-center gap-2">
              <span>Số kg:</span>
              <input type="number" inputMode="numeric" min={1} max={freeQty(asset)} aria-label="Số kg"
                className="w-24 rounded border border-gold-300 bg-cream px-1" value={qtyText} placeholder={String(freeQty(asset))}
                onChange={(e) => setQtyText(e.target.value)} />
            </label>
          )}
          <label className="flex flex-wrap items-center gap-2">
            <span>Giá:</span>
            <input type="number" inputMode="numeric" min={b.min} max={b.max} aria-label="Giá"
              className="w-32 rounded border border-gold-300 bg-cream px-1" value={priceText} placeholder={String(value)}
              onChange={(e) => setPriceText(e.target.value)} />
            <span className="text-base">giá trị {formatXu(value)} · cho phép {formatXu(b.min)}–{formatXu(b.max)}</span>
          </label>
          {value < minValue && <p className="text-base">Món này chưa đủ hiếm (cần giá trị từ {formatXu(minValue)}).</p>}
          {pick && note && <p className="text-base">{note(pick)}</p>}
          <div>
            <button type="button" className="pch-btn pch-btn-primary" disabled={busy || !pick} onClick={() => pick && submit.onSubmit(pick)}>
              {pick ? submit.label(pick) : "Chọn giá hợp lệ"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
