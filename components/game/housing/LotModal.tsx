"use client";

import { useState } from "react";
import { formatXu } from "@/lib/game/fishing/catalog";
import { VISIBILITIES, type Visibility } from "@/lib/game/housing/apartment";
import {
  houseEnter, houseErrText, houseRoomLeave, houseRoomPrice, houseRoomRent, houseSetVisibility, LAND_PRICE, LAND_REFUND_SHARE, lotBuy, lotSell,
  lotUpkeep, REPOSSESS_DAYS, RENT_OWNER_PERCENT, ROOFS, ROOM_RENT_DAYS, ROOM_RENT_MAX, ROOM_RENT_MIN, UPKEEP, UPKEEP_DAYS,
  type HouseLayout, type HouseList,
} from "@/lib/game/housing/house";
import { durationText } from "@/lib/game/housing/motel";
import { ParchmentModal } from "../Parchment";

interface LotModalProps {
  token: string;
  roomId: string;
  lot: number;
  state: HouseList | null;
  coins: number | null;
  /** I rent or own a flat (v19.2): one home per account. */
  hasFlat: boolean;
  onState: (s: HouseList) => void;
  onBuild: () => void;
  onEnter: (layout: HouseLayout) => void;
  onClose: () => void;
}

/** 🏡 A Khu nhà lot (v19.3): buy it from the city (40 000 xu, 30 days of upkeep included), pay the upkeep, build, list
 *  rooms for rent and see the tenants, give it back; on someone else's lot: go in, rent a listed room, extend or leave. */
export default function LotModal({ token, roomId, lot, state, coins, hasFlat, onState, onBuild, onEnter, onClose }: LotModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<number, string>>({});
  const [confirmSell, setConfirmSell] = useState(false);
  const info = state?.lots.find((l) => l.no === lot) ?? null;
  const mine = state?.mine?.no === lot ? state.mine : null;
  const tenancy = state?.tenancy ?? null;
  const myRoomHere = tenancy?.lot === lot ? tenancy : null;
  const now = state?.serverNowMs ?? 0;
  const hasHome = hasFlat || state?.mine != null || tenancy !== null;

  const act = async (fn: () => Promise<HouseList>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { onState(await fn()); } catch (e) { setError(houseErrText(e)); } finally { setBusy(false); }
  };
  const enter = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { onEnter(await houseEnter(token, roomId, lot)); } catch (e) { setError(houseErrText(e)); } finally { setBusy(false); }
  };

  const refund = LAND_PRICE * LAND_REFUND_SHARE;
  const arrears = mine?.paidUntilMs != null && mine.paidUntilMs <= now;
  const roofName = ROOFS.find((r) => r.id === info?.roof)?.name ?? "";
  return (
    <ParchmentModal title={`🏡 Lô đất ${lot}`} onClose={onClose} className="sm:max-w-2xl">
      <div className="flex flex-col gap-3 overflow-y-auto font-vt text-lg leading-tight" data-testid="lot-modal">
        {state === null && <p>Đang xem sổ đỏ…</p>}

        {info && !info.owned && (
          <section className="flex flex-col gap-2" data-testid="lot-free">
            <p>
              Đất trống 20 × 14 ô. Giá <b>{formatXu(LAND_PRICE)}</b> (đã gồm {UPKEEP_DAYS} ngày phí giữ đất), sau đó {formatXu(UPKEEP)} mỗi {UPKEEP_DAYS} ngày.
              Nợ phí quá {REPOSSESS_DAYS} ngày thì thành phố thu hồi và trả lại {formatXu(refund)}.
            </p>
            {hasHome && <p>🏠 Bạn đã có nhà (căn hộ, lô đất hoặc phòng thuê) — mỗi người một nhà thôi.</p>}
            <div>
              <button type="button" className="pch-btn pch-btn-primary" disabled={busy || hasHome || (coins !== null && coins < LAND_PRICE)}
                onClick={() => void act(() => lotBuy(token, lot))}>Mua lô đất · {formatXu(LAND_PRICE)}</button>
            </div>
          </section>
        )}

        {mine && info && (
          <section className="flex flex-col gap-2 rounded-sm border-2 border-gold-300 bg-cream p-2" data-testid="lot-mine">
            <p className="text-xl font-bold text-burgundy">🏡 Lô {lot} của bạn · {info.grid ? `nhà mái ${roofName.toLowerCase()}` : "chưa xây"}</p>
            <p>
              {arrears
                ? <>⚠️ Nợ phí giữ đất! Còn {durationText((mine.repossessMs ?? now) - now)} trước khi bị thu hồi. Chưa đóng phí thì không xây và không cho thuê được.</>
                : <>Phí giữ đất còn {durationText((mine.paidUntilMs ?? now) - now)}.</>}
              {mine.buildCost > 0 && <> · Đã xây hết {formatXu(mine.buildCost)}.</>}
            </p>
            <div className="flex flex-wrap gap-2">
              {info.grid && <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => void enter()}>🚪 Vào nhà</button>}
              <button type="button" className="pch-btn" disabled={busy} onClick={onBuild}>🏗️ {info.grid ? "Sửa nhà" : "Xây nhà"}</button>
              <button type="button" className="pch-btn" disabled={busy || (coins !== null && coins < UPKEEP)}
                onClick={() => void act(() => lotUpkeep(token))}>Đóng phí {UPKEEP_DAYS} ngày · {formatXu(UPKEEP)}</button>
            </div>
            <label className="flex flex-wrap items-center gap-2">
              <span>Cửa nhà:</span>
              <select className="max-w-full rounded border border-gold-300 bg-cream px-1" value={mine.visibility} disabled={busy}
                onChange={(e) => void act(() => houseSetVisibility(token, e.target.value as Visibility))}>
                {VISIBILITIES.map((v) => <option key={v.id} value={v.id}>{v.name} — {v.note.replace(" (gõ cửa)", " và người thuê")}</option>)}
              </select>
            </label>
            {mine.rooms.length > 0 && (
              <div className="flex flex-col gap-1" data-testid="lot-rooms">
                <p>🛏️ Cho thuê phòng ({formatXu(ROOM_RENT_MIN)}–{formatXu(ROOM_RENT_MAX)} mỗi {ROOM_RENT_DAYS} ngày; bạn nhận {RENT_OWNER_PERCENT} %):</p>
                <ul className="flex flex-col gap-1">
                  {mine.rooms.map((r) => (
                    <li key={r.no} className="flex flex-wrap items-center gap-2 text-base" data-testid={`lot-room-${r.no}`}>
                      <span>Phòng <b>{r.no}</b> · {r.cells} ô</span>
                      {r.tenantName && <span>👤 {r.tenantName} · còn {durationText((r.untilMs ?? now) - now)}</span>}
                      {r.price !== null && <span>· {formatXu(r.price)}</span>}
                      <input type="number" inputMode="numeric" min={ROOM_RENT_MIN} max={ROOM_RENT_MAX} step={50} aria-label={`Giá phòng ${r.no}`}
                        className="w-24 rounded border border-gold-300 bg-cream px-1" placeholder={String(r.price ?? 1000)}
                        value={prices[r.no] ?? ""} onChange={(e) => setPrices({ ...prices, [r.no]: e.target.value })} />
                      <button type="button" className="pch-btn px-1.5 py-0.5 text-sm" disabled={busy}
                        onClick={() => void act(() => houseRoomPrice(token, r.no, Number(prices[r.no] || r.price || 1000)))}>
                        {r.price === null ? "Cho thuê" : "Đổi giá"}
                      </button>
                      {r.price !== null && (
                        <button type="button" className="pch-btn px-1.5 py-0.5 text-sm" disabled={busy}
                          onClick={() => void act(() => houseRoomPrice(token, r.no, null))}>Ngừng cho thuê</button>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="text-sm opacity-80">Ngừng cho thuê thì người đang thuê ở đến hết hạn đã trả, rồi phòng trả lại cho bạn.</p>
              </div>
            )}
            {!confirmSell ? (
              <div>
                <button type="button" className="pch-btn" disabled={busy} onClick={() => setConfirmSell(true)}>Trả đất cho thành phố · nhận {formatXu(refund)}</button>
              </div>
            ) : (
              <span className="flex flex-wrap items-center gap-2">
                <span>Chắc chưa? Nhà bị dỡ (không hoàn tiền xây), đồ đạc về kho.</span>
                <button type="button" className="pch-btn" disabled={busy} onClick={() => { setConfirmSell(false); void act(() => lotSell(token)); }}>Đồng ý</button>
                <button type="button" className="pch-btn" onClick={() => setConfirmSell(false)}>Thôi</button>
              </span>
            )}
          </section>
        )}

        {info && info.owned && !mine && (
          <section className="flex flex-col gap-2" data-testid="lot-other">
            <p>Chủ đất: <b>{info.ownerName ?? "Ai đó"}</b> · {info.grid ? `nhà mái ${roofName.toLowerCase()}` : "chưa xây nhà"}</p>
            {info.grid && (
              <div>
                <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => void enter()}>🚪 Vào nhà</button>
              </div>
            )}
            {myRoomHere && (
              <div className="flex flex-col gap-1 rounded-sm border-2 border-gold-300 bg-cream p-2" data-testid="lot-tenancy">
                <p>🛏️ Bạn đang thuê phòng {myRoomHere.room} · còn {durationText(myRoomHere.paidUntilMs - now)}.</p>
                {!myRoomHere.listed && <p>Chủ nhà đã ngừng cho thuê phòng này: hết hạn thì bạn dọn đi (đồ đạc về kho).</p>}
                <div className="flex flex-wrap gap-2">
                  {myRoomHere.listed && (
                    <button type="button" className="pch-btn" disabled={busy} onClick={() => void act(() => houseRoomRent(token, lot, myRoomHere.room))}>
                      Gia hạn {ROOM_RENT_DAYS} ngày · {formatXu(info.rooms.find((r) => r.no === myRoomHere.room)?.price ?? myRoomHere.price)}
                    </button>
                  )}
                  <button type="button" className="pch-btn" disabled={busy} onClick={() => void act(() => houseRoomLeave(token))}>Trả phòng</button>
                </div>
              </div>
            )}
            {info.rooms.some((r) => r.price !== null && !r.mine) && (
              <ul className="flex flex-col gap-1" data-testid="lot-for-rent">
                {info.rooms.filter((r) => r.price !== null && !r.mine).map((r) => (
                  <li key={r.no} className="flex flex-wrap items-center gap-2">
                    <span>Phòng <b>{r.no}</b> · {r.cells} ô · {formatXu(r.price!)} / {ROOM_RENT_DAYS} ngày</span>
                    {r.taken ? <span className="opacity-70">Đã có người thuê</span> : (
                      <button type="button" className="pch-btn pch-btn-primary px-1.5 py-0.5 text-sm"
                        disabled={busy || hasHome || (coins !== null && coins < r.price!)}
                        onClick={() => void act(() => houseRoomRent(token, lot, r.no))}>Thuê phòng</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!myRoomHere && hasHome && info.rooms.some((r) => r.price !== null && !r.taken) && (
              <p className="text-sm opacity-80">Bạn đã có nhà nên không thuê thêm phòng được.</p>
            )}
          </section>
        )}
        {coins !== null && <p className="text-sm opacity-80">Bạn có {formatXu(coins)}</p>}
        {error && <p role="alert" className="text-red-700">{error}</p>}
      </div>
    </ParchmentModal>
  );
}
