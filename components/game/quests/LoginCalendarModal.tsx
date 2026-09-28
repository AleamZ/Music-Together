"use client";

import { useEffect, useState } from "react";
import { LOGIN_REWARDS, nextLoginSlot, questErrorMessage } from "@/lib/game/quests/model";
import { claimLoginReward, loginState, type LoginState } from "@/lib/game/quests/rpc";
import { ParchmentModal } from "../Parchment";

/** 🎁 Quà đăng nhập (v21 #69): a 7-day streak calendar, claimed once per VN day on the server. */
export default function LoginCalendarModal({ token, initial, onCoins, onClose }: {
  token: string; initial?: LoginState | null; onCoins: () => void; onClose: () => void;
}) {
  const [s, setS] = useState<LoginState | null>(initial ?? null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;
    let live = true;
    loginState(token).then((x) => { if (live) setS(x); }, () => { if (live) setMsg("Không tải được."); });
    return () => { live = false; };
  }, [token, initial]);

  const rewards = s?.rewards.length === 7 ? s.rewards : LOGIN_REWARDS;
  const slot = s ? nextLoginSlot(s.streak, s.claimedToday) : 1;

  const claim = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await claimLoginReward(token);
      setS(r);
      if (r.claimed) {
        setMsg(`Ngày ${r.slot}: +${r.amount} xu${r.paid !== r.amount ? ` (đã nhận ${(r.amount ?? 0) - (r.paid ?? 0)} xu quà ngày trước đó)` : ""}!`);
        onCoins();
      } else setMsg("Hôm nay đã nhận rồi.");
    } catch (e) {
      setMsg(questErrorMessage(e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : ""));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ParchmentModal title="🎁 Quà đăng nhập" onClose={onClose} className="sm:max-w-[560px]">
      <div className="flex flex-col gap-3 font-vt text-lg" data-testid="login-calendar">
        <p className="text-base">Ghé làng mỗi ngày để nhận quà. Bỏ một ngày thì chuỗi quay lại ngày 1.</p>
        <ol className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {rewards.map((xu, i) => {
            const day = i + 1;
            const got = s ? (s.claimedToday ? day <= slot : day < slot) && s.streak > 0 : false;
            const today = day === slot;
            return (
              <li key={day} className={`flex flex-col items-center rounded border-2 p-1 ${today ? "border-burgundy bg-gold-100" : "border-gold-300"} ${got ? "opacity-60" : ""}`}>
                <span className="text-base">Ngày {day}</span>
                <span className="text-2xl" aria-hidden="true">{day === 7 ? "💰" : "🪙"}</span>
                <span className="tabular-nums">{xu}</span>
                {got && <span className="text-sm">✅</span>}
              </li>
            );
          })}
        </ol>
        {msg && <p role="status" className="rounded bg-gold-100 px-2 text-burgundy">{msg}</p>}
        <button type="button" className="pch-btn pch-btn-primary self-center" disabled={busy || !s || s.claimedToday} onClick={() => void claim()}>
          {s?.claimedToday ? "Đã nhận hôm nay" : `Nhận quà ngày ${slot}`}
        </button>
      </div>
    </ParchmentModal>
  );
}
