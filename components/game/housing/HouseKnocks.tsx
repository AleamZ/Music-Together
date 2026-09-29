"use client";

import { useCallback, useEffect, useState } from "react";
import { houseEnter, houseErrText, type HouseLayout } from "@/lib/game/housing/house";
import { errText, houseAdmit, houseKnock, houseKnocks, type HouseKnocks } from "@/lib/game/pets/v2";
import { PET_ANIM_CSS, useReducedMotion } from "../pets/petArt";

const KNOCK_WAIT_MS = 60_000;
const KNOCK_TRY_MS = 3000;
const OWNER_POLL_MS = 8000;

/** ✊ Gõ cửa (v21, 0074): knock on a house the way one knocks on a flat — the owner sees it and may open; meanwhile
 *  the door is tried every few seconds for a minute. */
export function KnockButton({ token, roomId, lot, disabled, onEnter }: {
  token: string; roomId: string; lot: number; disabled?: boolean; onEnter: (l: HouseLayout) => void;
}) {
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [knocks, setKnocks] = useState(0);                      // v22: the door-knock animation's run
  const reduced = useReducedMotion();
  useEffect(() => {
    if (waitUntil === null) return;
    let stop = false;
    const id = setInterval(() => {
      if (Date.now() > waitUntil) { setWaitUntil(null); setError("Chủ nhà chưa mở cửa. Thử lại sau nhé."); return; }
      houseEnter(token, roomId, lot).then((l) => { if (!stop) { setWaitUntil(null); onEnter(l); } }, () => { /* still locked */ });
    }, KNOCK_TRY_MS);
    return () => { stop = true; clearInterval(id); };
  }, [waitUntil, token, roomId, lot, onEnter]);
  const knock = async () => {
    setError(null);
    setKnocks((n) => n + 1);
    try {
      await houseKnock(token, roomId, lot);
      try { onEnter(await houseEnter(token, roomId, lot)); return; } catch { /* not yet: wait for the owner */ }
      setWaitUntil(Date.now() + KNOCK_WAIT_MS);
    } catch (e) {
      setError(houseErrText(e));
    }
  };
  return (
    <span className="flex flex-wrap items-center gap-2">
      {knocks > 0 && (
        <span key={knocks} className="relative inline-flex h-10 w-8 items-end" aria-hidden="true">
          <style>{PET_ANIM_CSS}</style>
          <span className="block h-10 w-7 rounded-t-sm border-2 border-[#3a2418] bg-[#8a5a2a]"
            style={{ animation: reduced ? undefined : "pmg-knock 0.6s ease-in-out 2" }}>
            <span className="absolute right-1.5 top-5 h-1 w-1 rounded-full bg-[#f2c93a]" />
          </span>
          <span className="absolute -right-3 top-2 text-base" style={{ animation: reduced ? undefined : "pmg-fist 0.6s ease-in-out 2" }}>✊</span>
          {!reduced && <span className="absolute -top-4 left-0 whitespace-nowrap text-sm font-bold text-burgundy" style={{ animation: "pmg-float 1.2s ease-out forwards" }}>Cốc! Cốc!</span>}
        </span>
      )}
      <button type="button" className="pch-btn" disabled={disabled || waitUntil !== null} onClick={() => void knock()}>✊ Gõ cửa</button>
      {waitUntil !== null && <span aria-live="polite">Đã gõ cửa, chờ chủ nhà mở…</span>}
      {error && <span role="alert" className="text-red-700">{error}</span>}
    </span>
  );
}

/** The knocks on my house's door and the guests I let in (3 h), polled while the lot panel is open. */
export function OwnerKnocks({ token }: { token: string }) {
  const [state, setState] = useState<HouseKnocks | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => houseKnocks(token).then(setState, () => { /* before 0074: nothing to show */ }), [token]);
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const id = setInterval(() => void load(), OWNER_POLL_MS);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [load]);
  const admit = async (account: string, yes: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { setState(await houseAdmit(token, account, yes)); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  if (!state || (state.knocks.length === 0 && state.guests.length === 0)) return null;
  return (
    <div className="flex flex-col gap-1" data-testid="house-knocks">
      {state.knocks.map((k) => (
        <p key={k.accountId} className="flex flex-wrap items-center gap-2">
          <span>✊ <b>{k.name}</b> đang gõ cửa</span>
          <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => void admit(k.accountId, true)}>Mở cửa</button>
          <button type="button" className="pch-btn" disabled={busy} onClick={() => void admit(k.accountId, false)}>Từ chối</button>
        </p>
      ))}
      {state.guests.length > 0 && (
        <p className="flex flex-wrap items-center gap-2 text-base">
          <span>Khách được vào:</span>
          {state.guests.map((g) => (
            <button key={g.accountId} type="button" className="pch-btn px-1.5 py-0.5 text-sm" disabled={busy} title="Thu hồi quyền vào"
              onClick={() => void admit(g.accountId, false)}>{g.name} ✕</button>
          ))}
        </p>
      )}
      {error && <p role="alert" className="text-red-700">{error}</p>}
    </div>
  );
}
