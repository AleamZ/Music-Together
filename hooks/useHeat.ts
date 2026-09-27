import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import type { HeatProbe } from "@/lib/game/engine";
import { serverNow } from "@/lib/game/farm/clock";
import { heatChips, heatErrorMessage, WARM_MS, type HeatState } from "@/lib/game/heat/model";
import { heatState, jumpIn, leaveWater, rescueSwimmer, warmUpFinish, warmUpStart } from "@/lib/game/heat/rpc";
import type { VitalsWhere } from "@/lib/game/vitals-rpc";

// v18.10 Sốc nhiệt & bơi chủ động: the heat layer of the game shell. The server owns every state and roll; this hook
// shows it (the HUD chips, the red face), offers the pond-edge actions, plays the warm-up and the cramp, and answers
// E next to a cramping member.

const PROBE_MS = 250;
const CRAMP_POLL_MS = 1500;

/** Where I stand, for the heartbeat's heat (null while no world is up). */
export function heatWhere(canvas: GameCanvasHandle | null): VitalsWhere | null {
  const map = canvas?.mapId() ?? null;
  const p = canvas?.localPos() ?? null;
  return map && p ? { map, x: p.x, y: p.y } : null;
}

export interface HeatView {
  chips: Array<{ key: "shock" | "immune" | "warm"; text: string }>;
  probe: HeatProbe | null;
  busy: boolean;
  jump: () => void;
  warmUp: () => void;
  rescue: () => void;
}

/** The newer of two states (by the server time each was taken at). */
function newer(a: HeatState | null | undefined, b: HeatState | null | undefined): HeatState | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return b.serverNowMs >= a.serverNowMs ? b : a;
}

export function useHeat(opts: {
  token: string | null;
  roomId: string;
  canvasRef: RefObject<GameCanvasHandle | null>;
  /** The heartbeat's heat (vitals_tick). */
  fromVitals: HeatState | null | undefined;
  reloadVitals: () => Promise<void>;
  showToast: (text: string) => void;
}): HeatView {
  const { token, roomId, canvasRef, fromVitals, reloadVitals, showToast } = opts;
  const [answer, setAnswer] = useState<HeatState | null>(null);
  const [probe, setProbe] = useState<HeatProbe | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => serverNow());
  const heat = newer(fromVitals, answer);
  const warmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handledCramp = useRef<number | null>(null);

  // the probe (what the world offers now) and the chips' clock
  useEffect(() => {
    let last = "";
    const id = setInterval(() => {
      const p = canvasRef.current?.heatProbe() ?? null;
      const key = JSON.stringify(p);
      if (key !== last) {
        last = key;
        setProbe(p);
      }
    }, PROBE_MS);
    const clock = setInterval(() => setNow(serverNow()), 1000);
    return () => { clearInterval(id); clearInterval(clock); };
  }, [canvasRef]);

  // my red face and a cramp's countdown, in the world
  const shocked = heat?.shocked ?? false;
  const crampUntil = heat?.crampUntilMs ?? null;
  useEffect(() => {
    canvasRef.current?.setHeat({ shocked, crampLeftMs: crampUntil === null ? null : crampUntil - serverNow() });
  }, [canvasRef, shocked, crampUntil]);

  // while cramping: ask the server until the cramp ends — pulled out by someone, or drowned (the faint flow)
  useEffect(() => {
    if (!token || crampUntil === null) return;
    const id = setInterval(() => {
      void heatState(roomId, token).then((h) => {
        if (!h) return;
        setAnswer(h);
        if (h.crampUntilMs !== null || handledCramp.current === crampUntil) return;
        handledCramp.current = crampUntil;
        if (serverNow() >= crampUntil - 300) {
          showToast("🫧 Bạn bị chuột rút và đuối nước… ngất đi một lúc.");
          void reloadVitals();
        } else {
          canvasRef.current?.setHeat({ shocked: false, crampLeftMs: null, rescued: true });
          showToast("🛟 Có người kéo bạn lên bờ rồi!");
        }
      }).catch(() => { /* the next poll retries */ });
    }, CRAMP_POLL_MS);
    return () => clearInterval(id);
  }, [token, roomId, crampUntil, canvasRef, reloadVitals, showToast]);

  useEffect(() => () => { if (warmTimer.current) clearTimeout(warmTimer.current); }, []);

  const fail = useCallback((err: unknown) => {
    const text = heatErrorMessage(err);
    if (text) showToast(text);
  }, [showToast]);

  const jump = useCallback(() => {
    const at = canvasRef.current?.heatProbe()?.edge;
    if (!token || !at || busy) return;
    setBusy(true);
    jumpIn(roomId, token, at.col, at.row)
      .then((r) => {
        canvasRef.current?.jumpIn();
        if (r.heat) setAnswer(r.heat);
        showToast(r.cramp ? "😖 Chuột rút! Kêu cứu đi — còn 10 giây!" : "🌊 Ùm! Mát quá!");
      })
      .catch(fail)
      .finally(() => setBusy(false));
  }, [token, roomId, busy, canvasRef, fail, showToast]);

  const warmUp = useCallback(() => {
    const at = canvasRef.current?.heatProbe()?.edge;
    if (!token || !at || busy) return;
    setBusy(true);
    warmUpStart(roomId, token, at.col, at.row)
      .then(() => {
        if (!canvasRef.current?.warmUp()) return;
        warmTimer.current = setTimeout(() => {
          warmUpFinish(roomId, token)
            .then((h) => {
              if (h) setAnswer(h);
              showToast("🧘 Khởi động xong — 5 phút tới xuống nước an toàn hơn.");
            })
            .catch(fail);
        }, WARM_MS + 300);
      })
      .catch((e: unknown) => {
        canvasRef.current?.cancelWarmUp();
        fail(e);
      })
      .finally(() => setBusy(false));
  }, [token, roomId, busy, canvasRef, fail, showToast]);

  const rescueId = useCallback((id: string) => {
    const p = canvasRef.current?.heatProbe();
    if (!token || !p) return;
    const name = p.rescue?.id === id ? p.rescue.name : "";
    rescueSwimmer(roomId, token, id, p.cell.col, p.cell.row)
      .then(() => showToast(`🛟 Bạn đã cứu ${name || "một người"} lên bờ!`))
      .catch(fail);
  }, [token, roomId, canvasRef, fail, showToast]);

  const rescue = useCallback(() => {
    const id = canvasRef.current?.heatProbe()?.rescue?.id;
    if (id) rescueId(id);
  }, [canvasRef, rescueId]);

  // E next to a cramping member, and climbing out of the water (the 10 min immunity; a swim the server does not know,
  // like a fall from a fish, is refused quietly)
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !token) return;
    c.setHeatHandlers({
      onRescue: rescueId,
      onLeftWater: () => {
        leaveWater(roomId, token)
          .then((h) => {
            if (h) setAnswer(h);
            showToast("🏊 Mát rượi! Miễn sốc nhiệt 10 phút.");
          })
          .catch(fail);
      },
    });
    return () => c.setHeatHandlers(null);
  }, [canvasRef, token, roomId, rescueId, fail, showToast]);

  return { chips: heatChips(heat, now), probe, busy, jump, warmUp, rescue };
}
