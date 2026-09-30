"use client";

import { useEffect, useState } from "react";
import { formatXu } from "@/lib/game/fishing/catalog";
import {
  econErrText, kindIcon, leftText, SALE_FEE_MIN_PERCENT, SALE_FEE_PERCENT, saleShare, STALL_DAY, STALL_MAX_DAYS, STALL_SLOTS, type EconState, type Stall,
} from "@/lib/game/economy/model";
import { econState, marketCancel, shopBuy, shopRent, shopStock } from "@/lib/game/economy/rpc";
import { ParchmentModal } from "../Parchment";
import SellForm from "./SellForm";
import StallRowView from "./StallRowView";

/** 🏮 chú Bảy's row of rented stalls at Chợ Lớn (v21 #45): rent a stall, stock it with my things at my prices, and
 *  they sell while I am away; buy from other players' stalls. Each call claims the stall row on the server. */
export default function StallModal({ token, onChanged, onClose, onStalls }: { token: string; onChanged: () => void; onClose: () => void; /** P4: each econ_state's stalls (the 3D market draws them). */ onStalls?: (stalls: EconState["stalls"]) => void }) {
  const [state, setState] = useState<EconState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [days, setDays] = useState(1);

  useEffect(() => {
    let live = true;
    econState(token).then((s) => { if (live) setState(s); }, (e: unknown) => { if (live) setError(econErrText(e)); });
    return () => { live = false; };
  }, [token]);

  const act = async (fn: () => Promise<EconState>, done: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setState(await fn());
      setNotice(done);
      onChanged();
    } catch (e) {
      setError(econErrText(e));
      econState(token).then(setState, () => {});
    } finally {
      setBusy(false);
    }
  };

  const stalls = state?.stalls;
  useEffect(() => {
    if (stalls) onStalls?.(stalls);
  }, [stalls, onStalls]);

  const now = state?.serverNowMs ?? 0;
  const mine = state?.stalls.find((s) => s.mine) ?? null;
  const shown: Stall | null = state?.stalls.find((s) => s.no === (open ?? mine?.no)) ?? null;
  const maxDays = mine?.paidMs ? Math.max(0, STALL_MAX_DAYS - Math.ceil((mine.paidMs - now) / 86_400_000)) : STALL_MAX_DAYS;

  return (
    <ParchmentModal title="🏮 Dãy sạp cho thuê · chú Bảy" onClose={onClose} className="sm:max-w-2xl">
      <div className="flex flex-col gap-3 overflow-y-auto font-vt text-lg leading-tight" data-testid="stall-modal">
        <StallRowView rented={(state?.stalls ?? []).map((s) => s.renterName !== null)} notes={0} />
        <p className="text-base">
          chú Bảy: &quot;Thuê sạp {formatXu(STALL_DAY)} một ngày (tối đa {STALL_MAX_DAYS} ngày), bày {STALL_SLOTS} món, giá tự đặt. Bà con mua cả lúc
          con đi vắng; chợ thu {SALE_FEE_PERCENT} % mỗi món bán được (Thương nhân có kỹ năng Mồm mép: {SALE_FEE_MIN_PERCENT} %).&quot;
        </p>
        {error && <p role="alert" className="text-red-700">{error}</p>}
        {notice && <p className="text-emerald-800">{notice}</p>}
        {state === null && !error && <p>Đang mở sổ…</p>}
        {state && (
          <div className="flex flex-wrap gap-1" role="tablist">
            {state.stalls.map((s) => (
              <button key={s.no} type="button" role="tab" aria-selected={shown?.no === s.no}
                className={`pch-btn px-2 py-0.5 ${shown?.no === s.no ? "pch-btn-primary" : ""}`} onClick={() => setOpen(s.no)}>
                Sạp {s.no}{s.mine ? " (của tôi)" : s.renterName ? ` · ${s.renterName}` : " · trống"}
              </button>
            ))}
          </div>
        )}

        {state && shown && (
          <section className="flex flex-col gap-2" data-testid={`stall-${shown.no}`}>
            {shown.renterName === null ? (
              <>
                <p>Sạp {shown.no} đang trống.</p>
                {mine ? <p className="text-base">Bạn đang thuê sạp {mine.no} rồi.</p> : (
                  <span className="flex flex-wrap items-center gap-2">
                    <select aria-label="Số ngày" className="rounded border border-gold-300 bg-cream px-1" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                      {Array.from({ length: STALL_MAX_DAYS }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d} ngày</option>)}
                    </select>
                    <button type="button" className="pch-btn pch-btn-primary" disabled={busy || state.coins < STALL_DAY * days}
                      onClick={() => void act(() => shopRent(token, shown.no, days), `Đã thuê sạp ${shown.no}!`)}>
                      Thuê · {formatXu(STALL_DAY * days)}
                    </button>
                  </span>
                )}
              </>
            ) : (
              <>
                <p>
                  {shown.mine ? "Sạp của bạn" : `Sạp của ${shown.renterName}`}
                  {shown.paidMs !== null && ` · còn ${leftText(shown.paidMs - now)}`} · {shown.items.length}/{STALL_SLOTS} món
                </p>
                {shown.items.length === 0 ? <p className="text-base">Sạp chưa bày món nào.</p> : (
                  <ul className="flex flex-col gap-2">
                    {shown.items.map((l) => (
                      <li key={l.id} className="flex flex-wrap items-center gap-2 rounded-sm border-2 border-gold-300 bg-cream p-2" data-testid={`stall-item-${l.id}`}>
                        <span className="font-bold text-burgundy">{kindIcon(l.kind)} {l.name} · {formatXu(l.price)}</span>
                        <span className="text-base">giá trị {formatXu(l.value)}</span>
                        {l.mine ? (
                          <button type="button" className="pch-btn" disabled={busy} onClick={() => void act(() => marketCancel(token, l.id), "Đã cất món về.")}>Cất về</button>
                        ) : (
                          <button type="button" className="pch-btn pch-btn-primary" disabled={busy || state.coins < l.price}
                            onClick={() => void act(() => shopBuy(token, l.id, l.price), `Đã mua ${l.name}!`)}>Mua</button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {shown.mine && (
                  <>
                    {maxDays > 0 && (
                      <span className="flex flex-wrap items-center gap-2">
                        <select aria-label="Gia hạn" className="rounded border border-gold-300 bg-cream px-1" value={Math.min(days, maxDays)} onChange={(e) => setDays(Number(e.target.value))}>
                          {Array.from({ length: maxDays }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d} ngày</option>)}
                        </select>
                        <button type="button" className="pch-btn" disabled={busy}
                          onClick={() => { const d = Math.min(days, maxDays); void act(() => shopRent(token, shown.no, d), "Đã gia hạn."); }}>
                          Gia hạn · {formatXu(STALL_DAY * Math.min(days, maxDays))}
                        </button>
                      </span>
                    )}
                    {shown.items.length < STALL_SLOTS && (
                      <details className="rounded-sm border-2 border-gold-300 p-2">
                        <summary className="cursor-pointer">➕ Bày thêm món</summary>
                        <SellForm assets={state.assets} busy={busy}
                          note={(p) => `Bán được bạn nhận ${formatXu(saleShare(p.price).seller)}.`}
                          submit={{
                            label: (p) => `Bày lên sạp · ${formatXu(p.price)}`,
                            onSubmit: (p) => void act(() => shopStock(token, p.asset.kind, p.asset.ref, p.qty, p.price), "Đã bày lên sạp!"),
                          }} />
                      </details>
                    )}
                  </>
                )}
              </>
            )}
          </section>
        )}
      </div>
    </ParchmentModal>
  );
}
