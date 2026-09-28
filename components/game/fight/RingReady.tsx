"use client";

import { useEffect, useState } from "react";
import type { RingsHook } from "@/hooks/useRings";
import { PingMeter } from "@/lib/game/fight/net";
import { broadcastTransport } from "@/lib/game/fight/transport";
import type { Look } from "@/lib/game/types";
import ReadyScreen from "./ReadyScreen";

/** The ready screen's link measurement: both fighters join the ring's fight topic and trade 10 pings (2 a second); the
 *  p90 of the round trips (null until measured). Answers the opponent's pings with pongs. */
export function useRingPing(roomId: string, ring: number | null, me: string, foe: string | null): number | null {
  const [rtt, setRtt] = useState<{ key: string; ms: number } | null>(null);
  const key = `${ring}|${foe}`;
  useEffect(() => {
    if (ring === null || !foe) return;
    const t = broadcastTransport(roomId, ring, foe);
    const meter = new PingMeter();
    t.onPacket((p) => {
      if (p.t === "fp") t.send({ t: "fq", id: me, n: p.n, ms: p.ms });
      else if (p.t === "fq") {
        meter.pong(p.n, performance.now());
        if (meter.ready) setRtt({ key: `${ring}|${foe}`, ms: meter.rtt });
      }
    });
    const id = window.setInterval(() => {
      const ping = meter.ping(performance.now());
      if (ping) t.send({ t: "fp", id: me, ...ping });
    }, 100);
    return () => {
      window.clearInterval(id);
      t.close();
    };
  }, [roomId, ring, me, foe]);
  return rtt && rtt.key === key ? rtt.ms : null;
}

/** v20.3: the ring panel — my corner's ready screen (its link measured), or "Đang vào sàn…" while the corner is being
 *  taken; the panel closes itself when I hold no corner. */
export default function RingReady({ rings, roomId, accountId, myLook, lookOf, onClose }: {
  rings: RingsHook;
  roomId: string;
  accountId: string;
  myLook: Look;
  lookOf: (accountId: string) => Look | null;
  onClose: () => void;
}) {
  const c = rings.corner;
  const foe = c ? (c.corner === "red" ? c.view.blue : c.view.red) : null;
  const rtt = useRingPing(roomId, c?.ring ?? null, accountId, foe?.id ?? null);
  const [nowMs, setNowMs] = useState(() => rings.clock.now(Date.now()));
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(rings.clock.now(Date.now())), 1000);
    return () => window.clearInterval(id);
  }, [rings.clock]);
  const gone = !c && !rings.busy && rings.state !== null;
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);
  if (!c) {
    return (
      <div className="game-ui fixed inset-0 z-50 flex items-center justify-center bg-ink/30" role="status">
        <p className="pch p-3 font-vt text-xl">🥊 Đang vào sàn…</p>
      </div>
    );
  }
  return (
    <ReadyScreen
      view={c.view}
      me={c.corner}
      myLook={myLook}
      foeLook={foe ? lookOf(foe.id) : null}
      rtt={rtt}
      busy={rings.busy}
      lockedUntilMs={rings.state?.lockedUntilMs ?? null}
      nowMs={nowMs}
      onOffer={(stake, n) => void rings.offer(c.ring, stake, n)}
      onAccept={(v, n) => void rings.accept(c.ring, v, n)}
      onLeave={() => void rings.leave(c.ring).then(onClose)}
      onClose={onClose}
    />
  );
}
