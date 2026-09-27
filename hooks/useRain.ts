import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { serverNow } from "@/lib/game/farm/clock";
import {
  heldUmbrella, isCold, rainChips, rainErrorMessage, umbrellaSpec, type RainChipKey, type RainState, type UmbrellaKind,
} from "@/lib/game/rain/model";
import { buyUmbrella, holdUmbrella, rainState } from "@/lib/game/rain/rpc";

// v18.9 Ô và ướt sũng + sét đánh: the rain layer of the game shell. The server owns every state and roll (the
// heartbeat judges the rain); this hook shows it (the chips, the umbrella over me, the wet and the cold), plays a
// lightning strike on me, and buys and holds umbrellas for the shops' shelves.

export interface RainView {
  state: RainState | null;
  chips: Array<{ key: RainChipKey; text: string; title: string }>;
  cold: boolean;
  busy: boolean;
  buy: (kind: UmbrellaKind) => Promise<boolean>;
  hold: (id: number | null) => void;
}

/** The newer of two states (by the server time each was taken at). */
function newer(a: RainState | null | undefined, b: RainState | null | undefined): RainState | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return b.serverNowMs >= a.serverNowMs ? b : a;
}

export function useRain(opts: {
  token: string | null;
  canvasRef: RefObject<GameCanvasHandle | null>;
  /** The heartbeat's rain (vitals_tick). */
  fromVitals: RainState | null | undefined;
  /** Is it raining in the room now (rain, thunder, storm)? */
  raining: boolean;
  onCoinsChanged: () => void;
  showToast: (text: string) => void;
}): RainView {
  const { token, canvasRef, fromVitals, raining, onCoinsChanged, showToast } = opts;
  const [answer, setAnswer] = useState<RainState | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => serverNow());
  const state = newer(fromVitals, answer);

  useEffect(() => {
    if (!token) return;
    let live = true;
    rainState(token).then((s) => { if (live && s) setAnswer(s); }).catch(() => { /* the heartbeat brings it */ });
    const clock = setInterval(() => setNow(serverNow()), 1000);
    return () => { live = false; clearInterval(clock); };
  }, [token]);

  // my look in the world: wet, cold, and the umbrella open while it rains
  const wet = state?.wet ?? false;
  const cold = isCold(state, now);
  const open = raining ? heldUmbrella(state)?.kind ?? null : null;
  useEffect(() => {
    canvasRef.current?.setRain?.({ wet, cold, umbrella: open });
  }, [canvasRef, wet, cold, open]);

  // news from the heartbeat: a lightning strike, a broken umbrella, the cold coming on (each once)
  const seen = useRef<{ struck: number | null; broke: number | null; cold: boolean }>({ struck: null, broke: null, cold: false });
  const struck = fromVitals?.struckAtMs ?? null, broke = fromVitals?.brokeAtMs ?? null;
  useEffect(() => {
    if (struck === null || seen.current.struck === struck) return;
    seen.current.struck = struck;
    canvasRef.current?.strike?.();
    showToast("⚡ Sét đánh trúng bạn! Xỉu mất rồi…");
  }, [struck, canvasRef, showToast]);
  useEffect(() => {
    if (broke === null || seen.current.broke === broke) return;
    seen.current.broke = broke;
    showToast("☂️ Cây ô rách bươm rồi — mua cây mới nhé!");
  }, [broke, showToast]);
  useEffect(() => {
    if (cold === seen.current.cold) return;
    seen.current.cold = cold;
    showToast(cold ? "🤧 Hắt xì! Bạn bị cảm lạnh — ăn phở, bún bò hay canh chua nóng cho mau khỏi." : "😊 Hết cảm lạnh rồi!");
  }, [cold, showToast]);

  const buy = useCallback(async (kind: UmbrellaKind): Promise<boolean> => {
    if (!token || busy) return false;
    setBusy(true);
    try {
      const s = await buyUmbrella(token, kind);
      if (s) setAnswer(s);
      onCoinsChanged();
      showToast(`☂️ Đã mua ${umbrellaSpec(kind).name}!`);
      return true;
    } catch (e) {
      showToast(rainErrorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, [token, busy, onCoinsChanged, showToast]);

  const hold = useCallback((id: number | null) => {
    if (!token || busy) return;
    setBusy(true);
    holdUmbrella(token, id)
      .then((s) => { if (s) setAnswer(s); })
      .catch((e: unknown) => showToast(rainErrorMessage(e)))
      .finally(() => setBusy(false));
  }, [token, busy, showToast]);

  return { state, chips: rainChips(state, now, raining), cold, busy, buy, hold };
}
