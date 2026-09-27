"use client";

import { useEffect, useRef, useState } from "react";
import { OFFICE_H, OFFICE_W, paintEstateOffice } from "@/lib/game/art/estate";
import { formatXu } from "@/lib/game/fishing/catalog";
import {
  ESTATE_FEE_PERCENT, estateBuy, estateCancel, estateErrText, estateList, estateState, LISTING_DAYS, priceBand, propertyName,
  RELIST_COOLDOWN_HOURS, ROUND_TRIP_DAYS, saleShare, type EstateState, type Listing,
} from "@/lib/game/housing/estate";
import { durationText } from "@/lib/game/housing/motel";
import { ParchmentModal } from "../Parchment";

/** The office inside, painted by the game's art; the board holds one card per listing. */
function OfficeView({ listings }: { listings: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (!c) return;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const draw = (now: number) => {
      c.clearRect(0, 0, OFFICE_W, OFFICE_H);
      paintEstateOffice(c, reduced ? 0 : now, listings);
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [listings]);
  return (
    <canvas ref={ref} width={OFFICE_W} height={OFFICE_H} data-testid="estate-office"
      className="mx-auto w-full max-w-[520px] rounded-sm border-2 border-gold-300 [image-rendering:pixelated]" aria-hidden="true" />
  );
}

type Tab = "market" | "sell" | "history";
const TABS: ReadonlyArray<{ id: Tab; name: string }> = [
  { id: "market", name: "🏘️ Đang rao bán" }, { id: "sell", name: "📝 Rao bán nhà tôi" }, { id: "history", name: "📜 Lịch sử" },
];

const icon = (l: { kind: "apt" | "lot" }) => (l.kind === "apt" ? "🏢" : "🏡");
const dateText = (ms: number) => new Date(ms).toLocaleDateString("vi-VN");

interface EstateModalProps {
  token: string;
  coins: number | null;
  /** I already live somewhere (a flat of any tenure, a lot, or a rented room): one home per account. */
  hasHome: boolean;
  /** An action changed my coins or my home: the shell reloads the wallet, the flats and the lots. */
  onChanged: (s: EstateState) => void;
  onClose: () => void;
}

/** 🏘️ The Sàn bất động sản office on Khu nhà (v19.4): buy a flat or a lot (with its house) from another player, list my
 *  own bought flat or lot, and the recent sales. Every price and rule is the server's. */
export default function EstateModal({ token, coins, hasHome, onChanged, onClose }: EstateModalProps) {
  const [state, setState] = useState<EstateState | null>(null);
  const [tab, setTab] = useState<Tab>("market");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [price, setPrice] = useState("");
  const [withFurniture, setWithFurniture] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let live = true;
    estateState(token).then((s) => { if (live) setState(s); }, (e: unknown) => { if (live) setError(estateErrText(e)); });
    return () => { live = false; };
  }, [token]);

  const act = async (fn: () => Promise<EstateState>, changed: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const s = await fn();
      setState(s);
      if (changed) onChanged(s);
    } catch (e) {
      setError(estateErrText(e));
      estateState(token).then(setState, () => {});
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const now = state?.serverNowMs ?? 0;
  const own = state?.own ?? null;
  const myListing = state?.listings.find((l) => l.mine) ?? null;
  const others = state?.listings.filter((l) => !l.mine) ?? [];
  const appraisal = own ? (withFurniture && own.items > 0 ? own.full : own.bare) : 0;
  const band = priceBand(appraisal);
  const asked = Number(price || appraisal);
  const share = saleShare(Number.isFinite(asked) ? asked : 0);
  const inBand = Number.isInteger(asked) && asked >= band.min && asked <= band.max;
  const cooling = state?.cooldownMs != null && state.cooldownMs > now;
  const props = [...new Set((state?.sales ?? []).map((s) => `${s.kind}:${s.no}`))];
  const sales = (state?.sales ?? []).filter((s) => !filter || `${s.kind}:${s.no}` === filter);

  const listingRow = (l: Listing) => (
    <li key={l.id} className="flex flex-col gap-1 rounded-sm border-2 border-gold-300 bg-cream p-2" data-testid={`estate-listing-${l.id}`}>
      <p className="font-bold text-burgundy">
        {icon(l)} {propertyName(l.kind, l.no)}{l.kind === "lot" ? (l.grid ? " · có nhà" : " · đất trống") : ""} · {formatXu(l.price)}
      </p>
      <p className="text-base">
        Người bán: <b>{l.sellerName ?? "Ai đó"}</b> · thẩm định {formatXu(l.appraisal)}
        {l.withFurniture ? ` · kèm nội thất (${l.items} món)` : " · không kèm nội thất"}
        {l.tenants > 0 && ` · ${l.tenants} phòng đang cho thuê (người thuê ở tiếp đến hết hạn)`}
        {` · hết hạn sau ${durationText(l.expiresMs - now)}`}
      </p>
      {!l.mine && (confirm === l.id ? (
        <span className="flex flex-wrap items-center gap-2">
          <span>Mua {propertyName(l.kind, l.no).toLowerCase()} với giá {formatXu(l.price)}?</span>
          <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => void act(() => estateBuy(token, l.id, l.price), true)}>Đồng ý mua</button>
          <button type="button" className="pch-btn" onClick={() => setConfirm(null)}>Thôi</button>
        </span>
      ) : (
        <div>
          <button type="button" className="pch-btn pch-btn-primary" disabled={busy || hasHome || (coins !== null && coins < l.price)}
            onClick={() => setConfirm(l.id)}>Mua ngay · {formatXu(l.price)}</button>
        </div>
      ))}
    </li>
  );

  return (
    <ParchmentModal title="🏘️ Sàn bất động sản" onClose={onClose} className="sm:max-w-2xl">
      <div className="flex flex-col gap-3 overflow-y-auto font-vt text-lg leading-tight" data-testid="estate-modal">
        <OfficeView listings={state?.listings.length ?? 0} />
        <p className="text-base">
          anh Tư: &quot;Mua bán căn hộ (mua đứt) và lô đất giữa bà con. Giá trong khoảng 50 %–300 % giá thẩm định, sàn thu phí {ESTATE_FEE_PERCENT} %
          (người bán chịu), tin rao {LISTING_DAYS} ngày.&quot;
        </p>
        <div className="flex flex-wrap gap-1" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`pch-btn px-2 py-0.5 ${tab === t.id ? "pch-btn-primary" : ""}`}
              onClick={() => { setTab(t.id); setError(null); }}>{t.name}</button>
          ))}
        </div>
        {state === null && !error && <p>Đang mở sổ…</p>}

        {state && tab === "market" && (
          <section className="flex flex-col gap-2" data-testid="estate-market">
            {hasHome && <p className="text-base">🏠 Bạn đã có nhà (căn hộ, lô đất hoặc phòng thuê) — mỗi người một nhà, bán hoặc trả nhà cũ trước khi mua.</p>}
            {others.length === 0 ? <p>Chưa có ai rao bán.</p> : <ul className="flex flex-col gap-2">{others.map(listingRow)}</ul>}
            <p className="text-sm opacity-80">Hai người vừa mua bán với nhau thì {ROUND_TRIP_DAYS} ngày sau mới giao dịch lại được.</p>
          </section>
        )}

        {state && tab === "sell" && (
          <section className="flex flex-col gap-2" data-testid="estate-sell">
            {myListing ? (
              <>
                <ul className="flex flex-col gap-2">{listingRow(myListing)}</ul>
                <div>
                  <button type="button" className="pch-btn" disabled={busy} onClick={() => void act(() => estateCancel(token), false)}>Gỡ tin rao</button>
                </div>
                <p className="text-sm opacity-80">Gỡ tin thì {RELIST_COOLDOWN_HOURS} giờ sau mới rao lại được.</p>
              </>
            ) : !own ? (
              <p>Bạn chưa có căn hộ mua đứt hoặc lô đất nào để bán (căn hộ thuê thì không bán được).</p>
            ) : cooling ? (
              <p>⏳ Bạn vừa gỡ tin, tin vừa hết hạn hoặc vừa mua nhà — rao lại sau {durationText((state.cooldownMs ?? now) - now)}.</p>
            ) : (
              <>
                <p>{icon(own)} <b>{propertyName(own.kind, own.no)}</b> · thẩm định {formatXu(own.bare)}{own.items > 0 && ` (kèm ${own.items} món nội thất: ${formatXu(own.full)})`}</p>
                {own.items > 0 && (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={withFurniture} onChange={(e) => setWithFurniture(e.target.checked)} />
                    <span>Bán kèm nội thất (không kèm thì đồ về kho của bạn)</span>
                  </label>
                )}
                <label className="flex flex-wrap items-center gap-2">
                  <span>Giá bán:</span>
                  <input type="number" inputMode="numeric" min={band.min} max={band.max} step={500} aria-label="Giá bán"
                    className="w-32 rounded border border-gold-300 bg-cream px-1" placeholder={String(appraisal)}
                    value={price} onChange={(e) => setPrice(e.target.value)} />
                  <span className="text-base">({formatXu(band.min)}–{formatXu(band.max)})</span>
                </label>
                <p className="text-base">Bạn nhận {formatXu(share.seller)} · phí sàn {formatXu(share.fee)}.</p>
                {own.kind === "lot" && <p className="text-sm opacity-80">Nhà đi theo đất; người thuê phòng ở tiếp đến hết hạn đã trả, tiền thuê sau đó về chủ mới.</p>}
                <div>
                  <button type="button" className="pch-btn pch-btn-primary" disabled={busy || !inBand}
                    onClick={() => void act(() => estateList(token, own.kind, asked, withFurniture && own.items > 0), false)}>
                    Đăng tin {LISTING_DAYS} ngày
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {state && tab === "history" && (
          <section className="flex flex-col gap-2" data-testid="estate-history">
            {props.length > 0 && (
              <label className="flex flex-wrap items-center gap-2">
                <span>Tài sản:</span>
                <select className="max-w-full rounded border border-gold-300 bg-cream px-1" value={filter} onChange={(e) => setFilter(e.target.value)}>
                  <option value="">Tất cả</option>
                  {props.map((p) => {
                    const [k, n] = p.split(":");
                    return <option key={p} value={p}>{propertyName(k as "apt" | "lot", Number(n))}</option>;
                  })}
                </select>
              </label>
            )}
            {sales.length === 0 ? <p>Chưa có giao dịch nào.</p> : (
              <ul className="flex flex-col gap-1 text-base">
                {sales.map((s) => (
                  <li key={s.id}>
                    {dateText(s.soldMs)} · {icon(s)} {propertyName(s.kind, s.no)} · <b>{formatXu(s.price)}</b> · {s.sellerName ?? "?"} → {s.buyerName ?? "?"}
                    {s.withFurniture && " · kèm nội thất"}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {coins !== null && <p className="text-sm opacity-80">Bạn có {formatXu(coins)}</p>}
        {error && <p role="alert" className="text-red-700">{error}</p>}
      </div>
    </ParchmentModal>
  );
}
