"use client";

import { useEffect, useState } from "react";
import { formatXu } from "@/lib/game/fishing/catalog";
import {
  assetValue, econErrText, freeQty, kindIcon, RECV_MIN_DAYS, RECV_MIN_LEVEL, TRADE_IDLE_MIN, TRADE_ITEMS, tradeXuLeg,
  type Asset, type Offer, type Trade, type TradeState,
  isStackable, lotName, qtyUnit,
} from "@/lib/game/economy/model";
import { econState, tradeCancel, tradeConfirm, tradeOffer } from "@/lib/game/economy/rpc";
import { MAIL_DAYS } from "@/lib/game/mail/model";
import { ParchmentModal } from "../Parchment";

const keyOf = (a: { kind: string; ref: string }) => `${a.kind}:${a.ref}`;

function OfferView({ offer, title, ok }: { offer: Offer; title: string; ok: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-sm border-2 border-gold-300 bg-cream p-2">
      <p className="font-bold text-burgundy">{title} {ok ? "✅" : "⏳"}</p>
      {offer.coins > 0 && <p>💰 {formatXu(offer.coins)}</p>}
      {offer.items.map((a) => <p key={keyOf(a)}>{kindIcon(a.kind)} {a.name} <span className="text-base opacity-80">({formatXu(a.value)})</span></p>)}
      {offer.coins === 0 && offer.items.length === 0 && <p className="opacity-70">(chưa đưa gì)</p>}
    </div>
  );
}

/** 🤝 The trade window (v21 #40): both sides put coins, fish, clothes and produce in, both confirm, and the server swaps
 *  everything at once (standing near each other). Any change resets both confirmations. */
export default function TradeWindow({ token, trade, onState, onChanged }: {
  token: string;
  trade: Trade;
  onState: (s: TradeState) => void;
  /** The swap happened: the shell reloads the wallet and the bag. */
  onChanged: () => void;
}) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [coins, setCoins] = useState(0);
  const [draftCoins, setDraftCoins] = useState(String(trade.mine.coins));
  const [draft, setDraft] = useState<Asset[]>(trade.mine.items);
  const [pick, setPick] = useState("");
  const [kg, setKg] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    econState(token).then((s) => { if (live) { setAssets(s.assets); setCoins(s.coins); } }, () => {});
    return () => { live = false; };
  }, [token]);

  const run = async (fn: () => Promise<TradeState>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const s = await fn();
      onState(s);
      if (!s.trade) onChanged();
    } catch (e) {
      setError(econErrText(e));
    } finally {
      setBusy(false);
    }
  };

  const available = assets.filter((a) => freeQty(a) > 0 && !draft.some((d) => keyOf(d) === keyOf(a)));
  const chosen = available.find((a) => keyOf(a) === pick) ?? null;
  const add = () => {
    if (!chosen || draft.length >= TRADE_ITEMS) return;
    const qty = isStackable(chosen.kind) ? Math.max(1, Math.min(freeQty(chosen), Number(kg || freeQty(chosen)) | 0)) : 1;
    setDraft([...draft, { ...chosen, qty, value: assetValue(chosen, qty), name: lotName(chosen.kind, chosen.name, qty) }]);
    setPick("");
    setKg("");
  };
  // Kinh tế v2 (0106): the xu leg burns, and only an old enough account at level 5 receives xu, so much a day
  const leg = tradeXuLeg(trade);
  const taker = leg?.toMe ? "Bạn" : trade.partnerName;
  const c = Math.max(0, Math.floor(Number(draftCoins) || 0));
  const changed = c !== trade.mine.coins || draft.length !== trade.mine.items.length
    || draft.some((d, i) => keyOf(d) !== keyOf(trade.mine.items[i]) || d.qty !== trade.mine.items[i].qty);

  return (
    <ParchmentModal title={`🤝 Giao dịch với ${trade.partnerName}`} onClose={() => void run(() => tradeCancel(token, trade.id))} className="sm:max-w-2xl">
      <div className="flex flex-col gap-3 overflow-y-auto font-vt text-lg leading-tight" data-testid="trade-window">
        <p className="text-base">Hai bên đưa đồ vào, cùng bấm xác nhận thì đổi ngay. Phải đứng gần nhau; bỏ không {TRADE_IDLE_MIN} phút thì tự huỷ.</p>
        <p className="text-base" data-testid="trade-mail-note">
          📬 Đổi xong, đồ và xu bên kia đưa sẽ gửi vào Hòm thư của bạn (nút 📬 trên thanh công cụ) — mở thư và bấm &quot;Nhận&quot;. Thư
          không nhận trong {MAIL_DAYS} ngày sẽ trả lại người đưa.
        </p>
        <p className="text-sm opacity-80">
          Xu đưa qua giao dịch bị đốt {trade.feePct} % (người nhận được {100 - trade.feePct} %); người nhận xu cần tài khoản từ {RECV_MIN_DAYS} ngày
          tuổi và cấp {RECV_MIN_LEVEL} trở lên. Đồ vật thì đổi thoải mái, không mất phí.
        </p>
        {leg && (
          <p className="text-base" data-testid="trade-xu-leg">
            💸 {taker} nhận {formatXu(leg.got)} (đốt {formatXu(leg.gross - leg.got)}).
          </p>
        )}
        {leg?.blocked === "age" && (
          <p role="alert" className="text-red-700">
            ⚠️ {taker} chưa nhận xu được: cần tài khoản từ {RECV_MIN_DAYS} ngày tuổi và cấp {RECV_MIN_LEVEL} trở lên. Bỏ xu ra hoặc chỉ đổi đồ nhé.
          </p>
        )}
        {leg?.blocked === "limit" && (
          <p role="alert" className="text-red-700">
            ⚠️ Hôm nay {leg.toMe ? "bạn" : trade.partnerName} chỉ còn nhận được {formatXu(leg.left ?? 0)} qua giao dịch.
          </p>
        )}
        {error && <p role="alert" className="text-red-700">{error}</p>}
        <div className="flex flex-col gap-2 sm:flex-row">
          <OfferView offer={trade.mine} title="Bạn đưa" ok={trade.myOk} />
          <OfferView offer={trade.theirs} title={`${trade.partnerName} đưa`} ok={trade.theirOk} />
        </div>

        <details className="rounded-sm border-2 border-gold-300 p-2" open={!trade.myOk}>
          <summary className="cursor-pointer">✏️ Sửa đề nghị của tôi</summary>
          <div className="mt-2 flex flex-col gap-2">
            <label className="flex flex-wrap items-center gap-2">
              <span>Xu:</span>
              <input type="number" inputMode="numeric" min={0} max={coins} aria-label="Xu đưa" value={draftCoins}
                className="w-32 rounded border border-gold-300 bg-cream px-1" onChange={(e) => setDraftCoins(e.target.value)} />
              <span className="text-base">(có {formatXu(coins)})</span>
            </label>
            <ul className="flex flex-col gap-1">
              {draft.map((d) => (
                <li key={keyOf(d)} className="flex items-center gap-2">
                  <span>{kindIcon(d.kind)} {d.name}</span>
                  <button type="button" className="pch-btn px-1 py-0" aria-label={`Bỏ ${d.name}`} onClick={() => setDraft(draft.filter((x) => keyOf(x) !== keyOf(d)))}>✕</button>
                </li>
              ))}
            </ul>
            {draft.length < TRADE_ITEMS && available.length > 0 && (
              <span className="flex flex-wrap items-center gap-2">
                <select aria-label="Thêm món" className="max-w-full rounded border border-gold-300 bg-cream px-1" value={pick} onChange={(e) => setPick(e.target.value)}>
                  <option value="">— thêm món —</option>
                  {available.map((a) => (
                    <option key={keyOf(a)} value={keyOf(a)}>{kindIcon(a.kind)} {a.name}{isStackable(a.kind) ? ` (còn ${freeQty(a)} ${qtyUnit(a.kind)})` : ""}</option>
                  ))}
                </select>
                {chosen && isStackable(chosen.kind) && (
                  <input type="number" inputMode="numeric" min={1} max={freeQty(chosen)} aria-label={`Số ${qtyUnit(chosen.kind)}`} placeholder={String(freeQty(chosen))}
                    className="w-20 rounded border border-gold-300 bg-cream px-1" value={kg} onChange={(e) => setKg(e.target.value)} />
                )}
                <button type="button" className="pch-btn" disabled={!chosen} onClick={add}>Thêm</button>
              </span>
            )}
            <div>
              <button type="button" className="pch-btn" disabled={busy || !changed || c > coins}
                onClick={() => void run(() => tradeOffer(token, trade.id, { coins: c, items: draft }))}>Cập nhật đề nghị</button>
            </div>
          </div>
        </details>

        <div className="flex flex-wrap gap-2">
          <button type="button" className="pch-btn pch-btn-primary" disabled={busy || trade.myOk || changed || leg?.blocked != null}
            onClick={() => void run(() => tradeConfirm(token, trade.id, trade.rev))}>
            {trade.myOk ? "Đã xác nhận — chờ bên kia" : "✅ Xác nhận đổi"}
          </button>
          <button type="button" className="pch-btn" disabled={busy} onClick={() => void run(() => tradeCancel(token, trade.id))}>Huỷ giao dịch</button>
        </div>
        {changed && <p className="text-sm opacity-80">Bấm &quot;Cập nhật đề nghị&quot; trước khi xác nhận.</p>}
      </div>
    </ParchmentModal>
  );
}
