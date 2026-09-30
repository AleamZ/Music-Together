"use client";

import { useEffect, useRef, useState } from "react";
import { paintMotelRoom, ROOM_H, ROOM_W, type RoomLookColors } from "@/lib/game/art/motel";
import { HAIR_COLOR, SKIN } from "@/lib/game/art/palettes";
import { formatXu } from "@/lib/game/fishing/catalog";
import {
  durationText, MOTEL_PLANS, motelErrorMessage, motelRent, motelSleep, REST_EFFECT_TEXT, REST_HOURS, SLEEP_MS, type MotelPlan,
  type MotelState,
} from "@/lib/game/housing/motel";
import type { Look } from "@/lib/game/types";
import { ParchmentModal } from "./Parchment";

/** The room view: a canvas painted by the game's art, animated while open. `sleepAt` (performance.now()) runs the
 *  cutscene: the lights dim, I sleep under the blanket, Zzz drift up. */
function RoomView({ sleeper, sleepAt }: { sleeper: RoomLookColors; sleepAt: number | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const c = cv?.getContext("2d");
    if (!c) return;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const draw = (now: number) => {
      const k = sleepAt === null ? 0 : Math.min(1, (now - sleepAt) / 900);
      c.clearRect(0, 0, ROOM_W, ROOM_H);
      paintMotelRoom(c, reduced ? 0 : now, sleepAt === null ? null : sleeper, k);
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [sleeper, sleepAt]);
  return (
    <canvas ref={ref} width={ROOM_W} height={ROOM_H} data-testid="motel-room"
      className="mx-auto w-full max-w-[480px] rounded-sm border-2 border-gold-300 [image-rendering:pixelated]" aria-hidden="true" />
  );
}

function errText(e: unknown): string {
  const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);
  return motelErrorMessage(msg);
}

interface MotelModalProps {
  token: string;
  state: MotelState | null;
  coins: number | null;
  look: Look;
  /** An action returned a new state (and maybe a new balance). */
  onState: (s: MotelState) => void;
  onClose: () => void;
}

/** 🏨 Nhà nghỉ Hoa Sen · cô Hồng (v19.1): rent a room by the night or the month; in the room, sleep once a day for
 *  "Ngủ ngon" (24 h: hunger and thirst −30 %, walking +7 %, stamina regen +20 %). The room is mine alone — nobody else
 *  sees it. */
export default function MotelModal({ token, state, coins, look, onState, onClose }: MotelModalProps) {
  const [inRoom, setInRoom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sleepAt, setSleepAt] = useState<number | null>(null);
  const [woke, setWoke] = useState(false);
  const stay = state?.stay ?? null;
  const nowMs = state?.serverNowMs ?? 0;
  const sleeper: RoomLookColors = { skin: SKIN[look.skin].s, hair: HAIR_COLOR[look.hairColor].h };

  useEffect(() => {
    if (sleepAt === null) return;
    const id = setTimeout(() => { setSleepAt(null); setWoke(true); }, SLEEP_MS);
    return () => clearTimeout(id);
  }, [sleepAt]);

  const rent = async (plan: MotelPlan) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onState(await motelRent(token, plan));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const sleep = async () => {
    if (busy || sleepAt !== null) return;
    setBusy(true);
    setError(null);
    setWoke(false);
    try {
      const s = await motelSleep(token);
      setSleepAt(performance.now());
      onState(s);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const sleeping = sleepAt !== null;
  return (
    <ParchmentModal title="🏨 Nhà nghỉ Hoa Sen · cô Hồng" onClose={sleeping ? undefined : onClose} className="sm:max-w-[560px]">
      <div className="flex flex-col gap-3 font-vt text-lg">
        {!inRoom ? (
          <>
            <p data-testid="motel-rest">
              “Phòng sạch, quạt mát, ngủ một giấc là khoẻ re!” Ngủ ở đây được <b>Ngủ ngon</b> {REST_HOURS} giờ: {REST_EFFECT_TEXT}.
              Mỗi ngày ngủ một lần.
            </p>
            <p data-testid="motel-stay">
              {stay
                ? <>🔑 Phòng của bạn còn <b>{durationText(stay.untilMs - nowMs)}</b> ({stay.plan === "month" ? "thuê tháng" : "thuê đêm"}).</>
                : "Bạn chưa thuê phòng."}
            </p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {MOTEL_PLANS.map((p) => (
                <li key={p.id} className="flex flex-col gap-1 rounded-sm border-2 border-gold-200 bg-cream p-2">
                  <span className="text-xl font-bold text-burgundy">{p.name}</span>
                  <span>{formatXu(p.price)} · {p.id === "night" ? "24 giờ" : "30 ngày (rẻ hơn ⅓)"}</span>
                  <button type="button" className="pch-btn pch-btn-primary" disabled={busy || (coins !== null && coins < p.price)}
                    onClick={() => void rent(p.id)}>{stay ? "Gia hạn" : "Thuê"}</button>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="pch-btn pch-btn-primary" disabled={!stay} onClick={() => { setInRoom(true); setError(null); }}>
                🚪 Vào phòng
              </button>
              {coins !== null && <span className="opacity-80">Bạn có {formatXu(coins)}</span>}
            </div>
          </>
        ) : (
          <>
            <RoomView sleeper={sleeper} sleepAt={sleepAt} />
            <p aria-live="polite" data-testid="motel-status">
              {sleeping ? "💤 Zzz… ngủ một giấc thật ngon…"
                : woke ? "☀️ Dậy rồi! Ngủ ngon trong 24 giờ: đói, khát chậm hơn, đi nhanh hơn và thể lực hồi nhanh hơn."
                : state?.rest.sleptToday ? "Hôm nay bạn ngủ rồi — mai quay lại nhé."
                : "Giường êm, quạt quay đều. Lên giường ngủ chứ?"}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="pch-btn pch-btn-primary" disabled={busy || sleeping || !!state?.rest.sleptToday}
                onClick={() => void sleep()}>🛏️ Ngủ</button>
              <button type="button" className="pch-btn" disabled={sleeping} onClick={() => setInRoom(false)}>Ra quầy</button>
              <button type="button" className="pch-btn" disabled={sleeping} onClick={onClose}>Ra phố</button>
            </div>
          </>
        )}
        {error && <p role="alert" className="text-red-700">{error}</p>}
      </div>
    </ParchmentModal>
  );
}
