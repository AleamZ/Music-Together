"use client";

import { useEffect, useState } from "react";
import { formatXu } from "@/lib/game/fishing/catalog";
import {
  APT_BUY, APT_COUNT, APT_GRACE_DAYS, APT_MAX_AHEAD_DAYS, APT_RENT, APT_RENT_DAYS, APT_SELL_SHARE, aptAdmit, aptBuy, aptEnter, aptKnock,
  aptMoveOut, aptRent, aptSetVisibility, errText, VISIBILITIES, type AptList, type Layout, type Visibility,
} from "@/lib/game/housing/apartment";
import { durationText } from "@/lib/game/housing/motel";
import { ParchmentModal } from "../Parchment";

const KNOCK_WAIT_MS = 60_000;
const KNOCK_TRY_MS = 3000;

interface ApartmentModalProps {
  token: string;
  roomId: string;
  state: AptList | null;
  coins: number | null;
  /** An action returned a new list (and maybe a new balance). */
  onState: (s: AptList) => void;
  /** I may go in: the unit's layout. */
  onEnter: (layout: Layout) => void;
  onClose: () => void;
}

/** 🏢 Chung cư Phú Mỹ · chú Sáu (v19.2): the 12 flats (3 floors × 4) to rent (1500 xu / 30 days) or buy (25 000 xu); my
 *  home (enter, extend, buy, move out, who may come in) and the knocks on my door; the other flats (enter or knock). */
export default function ApartmentModal({ token, roomId, state, coins, onState, onEnter, onClose }: ApartmentModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState<number | null>(null);
  const [waiting, setWaiting] = useState<{ no: number; until: number } | null>(null);
  const [confirmOut, setConfirmOut] = useState(false);
  const mine = state?.mine ?? null;
  const now = state?.serverNowMs ?? 0;
  const lapsed = mine?.tenure === "rent" && mine.paidUntilMs !== null && mine.paidUntilMs <= now;

  const act = async (fn: () => Promise<AptList>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onState(await fn());
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const enter = async (no: number) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onEnter(await aptEnter(token, roomId, no));
    } catch (e) {
      const text = errText(e);
      setError(text);
      if (text.includes("gõ cửa")) setLocked(no);
    } finally {
      setBusy(false);
    }
  };
  const knock = async (no: number) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await aptKnock(token, roomId, no);
      setWaiting({ no, until: Date.now() + KNOCK_WAIT_MS });
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  // after a knock: try the door every few seconds until the owner opens it (or a minute passes)
  useEffect(() => {
    if (!waiting) return;
    let stop = false;
    const id = setInterval(() => {
      if (Date.now() > waiting.until) {
        setWaiting(null);
        setError("Chủ nhà chưa mở cửa — thử lại sau nhé.");
        return;
      }
      aptEnter(token, roomId, waiting.no).then((l) => { if (!stop) { setWaiting(null); onEnter(l); } }, () => { /* still locked */ });
    }, KNOCK_TRY_MS);
    return () => { stop = true; clearInterval(id); };
  }, [waiting, token, roomId, onEnter]);

  const units = state?.units ?? [];
  const floors = [3, 2, 1].map((f) => Array.from({ length: 4 }, (_, i) => (f - 1) * 4 + i + 1));
  return (
    <ParchmentModal title="🏢 Chung cư Phú Mỹ · chú Sáu" onClose={onClose} className="sm:max-w-3xl">
      <div className="flex flex-col gap-3 font-vt text-lg leading-tight">
        <p>
          “Căn hộ {APT_COUNT} căn, 3 tầng. Thuê {formatXu(APT_RENT)} mỗi {APT_RENT_DAYS} ngày (trả trước tối đa {APT_MAX_AHEAD_DAYS} ngày),
          hoặc mua đứt {formatXu(APT_BUY)}. Có nhà rồi thì sắm đồ ở tiệm cô Năm bên Chợ Lớn nha!”
        </p>

        {mine && (
          <section className="flex flex-col gap-2 rounded-sm border-2 border-gold-300 bg-cream p-2" data-testid="apt-mine">
            <p className="text-xl font-bold text-burgundy">🏠 Căn {mine.no} của bạn · {mine.tenure === "own" ? "đã mua" : "đang thuê"}</p>
            {mine.tenure === "rent" && mine.paidUntilMs !== null && (
              <p>
                {lapsed
                  ? <>⚠️ Hết hạn thuê! Còn {durationText((mine.graceUntilMs ?? now) - now)} để gia hạn, sau đó căn hộ được trả lại (đồ đạc về kho).</>
                  : <>Còn {durationText(mine.paidUntilMs - now)} thuê.</>}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="pch-btn pch-btn-primary" disabled={busy || lapsed} onClick={() => void enter(mine.no)}>🚪 Vào nhà</button>
              {mine.tenure === "rent" && (
                <>
                  <button type="button" className="pch-btn" disabled={busy || (coins !== null && coins < APT_RENT)}
                    onClick={() => void act(() => aptRent(token, mine.no))}>Gia hạn {APT_RENT_DAYS} ngày · {formatXu(APT_RENT)}</button>
                  <button type="button" className="pch-btn" disabled={busy || (coins !== null && coins < APT_BUY)}
                    onClick={() => void act(() => aptBuy(token, mine.no))}>Mua luôn · {formatXu(APT_BUY)}</button>
                </>
              )}
              {!confirmOut ? (
                <button type="button" className="pch-btn" disabled={busy} onClick={() => setConfirmOut(true)}>
                  {mine.tenure === "own" ? `Bán lại · ${formatXu(APT_BUY * APT_SELL_SHARE)}` : "Trả nhà"}
                </button>
              ) : (
                <span className="flex flex-wrap items-center gap-2">
                  <span>Chắc chưa? Đồ đạc sẽ về kho.</span>
                  <button type="button" className="pch-btn" disabled={busy} onClick={() => { setConfirmOut(false); void act(() => aptMoveOut(token)); }}>Đồng ý</button>
                  <button type="button" className="pch-btn" onClick={() => setConfirmOut(false)}>Thôi</button>
                </span>
              )}
            </div>
            <label className="flex flex-wrap items-center gap-2">
              <span>Cửa nhà:</span>
              <select className="max-w-full rounded border border-gold-300 bg-cream px-1" value={mine.visibility} disabled={busy}
                onChange={(e) => void act(() => aptSetVisibility(token, e.target.value as Visibility))}>
                {VISIBILITIES.map((v) => <option key={v.id} value={v.id}>{v.name} — {v.note}</option>)}
              </select>
            </label>
            {(state?.knocks.length ?? 0) > 0 && (
              <ul className="flex flex-col gap-1" data-testid="apt-knocks">
                {state!.knocks.map((k) => (
                  <li key={k.accountId} className="flex flex-wrap items-center gap-2">
                    <span>✊ <b>{k.name}</b> đang gõ cửa</span>
                    <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => void act(() => aptAdmit(token, k.accountId, true))}>Mở cửa</button>
                    <button type="button" className="pch-btn" disabled={busy} onClick={() => void act(() => aptAdmit(token, k.accountId, false))}>Từ chối</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <div className="flex flex-col gap-1" data-testid="apt-units">
          {floors.map((row, i) => (
            <div key={i} className="grid grid-cols-2 gap-1 sm:grid-cols-4">
              {row.map((no) => {
                const u = units.find((x) => x.no === no);
                const free = !u || u.status === "free";
                return (
                  <div key={no} data-testid={`apt-unit-${no}`}
                    className={`flex flex-col gap-1 rounded-sm border-2 p-1.5 ${u?.mine ? "border-burgundy bg-[#fff4d6]" : "border-gold-200 bg-cream"}`}>
                    <span className="text-base">Tầng {3 - i} · Căn <b>{no}</b></span>
                    {free ? (
                      <>
                        <span className="text-sm opacity-80">Trống</span>
                        <div className="flex flex-wrap gap-1 [&_.pch-btn]:px-1.5 [&_.pch-btn]:py-0.5 [&_.pch-btn]:text-sm">
                          <button type="button" className="pch-btn pch-btn-primary" disabled={busy || !!mine || (coins !== null && coins < APT_RENT)}
                            onClick={() => void act(() => aptRent(token, no))}>Thuê</button>
                          <button type="button" className="pch-btn" disabled={busy || !!mine || (coins !== null && coins < APT_BUY)}
                            onClick={() => void act(() => aptBuy(token, no))}>Mua</button>
                        </div>
                      </>
                    ) : u.mine ? (
                      <span className="text-sm">🏠 Nhà bạn</span>
                    ) : (
                      <>
                        <span className="truncate text-sm" title={u.ownerName ?? ""}>
                          {u.visibility === "open" ? "🚪" : u.visibility === "room" ? "🎵" : "🔒"} {u.ownerName ?? "Ai đó"}
                        </span>
                        <div className="flex flex-wrap gap-1 [&_.pch-btn]:px-1.5 [&_.pch-btn]:py-0.5 [&_.pch-btn]:text-sm">
                          <button type="button" className="pch-btn" disabled={busy || waiting !== null} onClick={() => void enter(no)}>Vào</button>
                          {locked === no && (
                            <button type="button" className="pch-btn pch-btn-primary" disabled={busy || waiting !== null} onClick={() => void knock(no)}>✊ Gõ cửa</button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {waiting && <p aria-live="polite">✊ Đã gõ cửa căn {waiting.no} — chờ chủ nhà mở…</p>}
        <p className="text-sm opacity-80">
          Hết hạn thuê có {APT_GRACE_DAYS} ngày ân hạn; sau đó căn hộ được trả lại, đồ đạc về kho của bạn (không mất).
          {coins !== null && <> · Bạn có {formatXu(coins)}</>}
        </p>
        {error && <p role="alert" className="text-red-700">{error}</p>}
      </div>
    </ParchmentModal>
  );
}
