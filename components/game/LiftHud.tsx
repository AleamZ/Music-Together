"use client";

import { useEffect } from "react";
import type { LiftView } from "@/hooks/useLift";
import { isTyping } from "@/lib/game/keys";

/** v18.13 Đi nhờ xe: "Xin đi nhờ" next to a rider, the driver's yes/no prompt, "Xuống xe" / "Cho xuống", and the E key
 *  (asking, getting off or dropping the passenger; a map prompt in range keeps E, except getting off); Y / N answer an ask
 *  through the HUD hotkeys. */
export default function LiftHud({ lift, keyEnabled, promptShown }: { lift: LiftView; keyEnabled: boolean; promptShown: boolean }) {
  const { state, candidate, offer, partner, ask, leave, drop, accept, decline } = lift;
  const canAsk = state.kind === "none" && candidate !== null;
  const aboard = state.kind === "passenger";
  const driving = state.kind === "driver";

  useEffect(() => {
    if (!keyEnabled || (!canAsk && !aboard && !driving)) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyE" || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (aboard) leave();
      else if (promptShown) return;
      else if (driving) drop();
      else ask();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keyEnabled, canAsk, aboard, driving, promptShown, ask, leave, drop]);

  return (
    <>
      {offer && (
        <div className="pch absolute left-1/2 top-24 z-30 flex -translate-x-1/2 flex-col items-center gap-1.5 p-2 font-vt text-lg leading-tight" role="alertdialog" aria-label="Xin đi nhờ">
          <span>🙋 <b>{offer.name}</b> muốn đi nhờ</span>
          <span className="flex gap-2">
            <button type="button" className="pch-btn pch-btn-primary" data-hotkey="liftAccept" aria-label="Đồng ý" title="Đồng ý (Y)" onClick={accept}><span className="pointer-coarse:hidden">Y · </span>Đồng ý</button>
            <button type="button" className="pch-btn" data-hotkey="liftDecline" aria-label="Từ chối" title="Từ chối (N)" onClick={decline}><span className="pointer-coarse:hidden">N · </span>Từ chối</button>
          </span>
        </div>
      )}
      {keyEnabled && (canAsk || state.kind !== "none") && (
        <div className="absolute bottom-36 left-1/2 z-10 -translate-x-1/2">
          {canAsk && candidate && (
            <button type="button" className="pch-btn text-xl" onClick={ask}>
              {!promptShown && <span className="pointer-coarse:hidden">E · </span>}🛵 Xin đi nhờ {candidate.name}
            </button>
          )}
          {state.kind === "asking" && <p className="pch px-3 py-1 font-vt text-lg">Đang chờ {partner} trả lời…</p>}
          {aboard && (
            <button type="button" className="pch-btn pch-btn-primary text-xl" onClick={leave}>
              <span className="pointer-coarse:hidden">E · </span>Xuống xe <span className="text-base opacity-80">({partner} chở)</span>
            </button>
          )}
          {state.kind === "driver" && (
            <button type="button" className="pch-btn text-lg" aria-label={`Cho ${partner} xuống`} onClick={drop}>{!promptShown && <span className="pointer-coarse:hidden">E · </span>}Cho {partner} xuống</button>
          )}
        </div>
      )}
    </>
  );
}
