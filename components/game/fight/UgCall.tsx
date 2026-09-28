"use client";

import { useEffect, useState } from "react";
import type { UndergroundHook } from "@/hooks/useUnderground";
import { PingMeter } from "@/lib/game/fight/net";
import { matchTopic, topicTransport } from "@/lib/game/fight/transport";
import { UG_FEE_PCT, ratedWin, tierOf } from "@/lib/game/fight/underground";
import type { UgMine } from "@/lib/game/fight/ug-rpc";
import { formatXu } from "@/lib/game/fishing/catalog";
import { ParchmentModal } from "../Parchment";
import { networkLine } from "./ReadyScreen";

/** The link to the opponent on the match's topic: 10 pings (2 a second), the p90 of the round trips (null until
 *  measured); the opponent's pings are answered with pongs. */
export function useTopicPing(topic: string | null, me: string, foe: string | null): number | null {
  const [rtt, setRtt] = useState<{ key: string; ms: number } | null>(null);
  const key = `${topic}|${foe}`;
  useEffect(() => {
    if (!topic || !foe) return;
    const t = topicTransport(topic, foe);
    const meter = new PingMeter();
    t.onPacket((p) => {
      if (p.t === "fp") t.send({ t: "fq", id: me, n: p.n, ms: p.ms });
      else if (p.t === "fq") {
        meter.pong(p.n, performance.now());
        if (meter.ready) setRtt({ key: `${topic}|${foe}`, ms: meter.rtt });
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
  }, [topic, me, foe]);
  return rtt && rtt.key === key ? rtt.ms : null;
}

/** v20.4 a called match (plan ruling U2): the rated pair or a cup match — the opponent, the entry, the network line and
 *  "Sẵn sàng" within the call (30 s rated, 60 s a cup); not pressing it is a forfeit. */
export default function UgCall({ ug, mine, roomId, accountId, nowMs }: {
  ug: UndergroundHook;
  mine: UgMine;
  roomId: string;
  accountId: string;
  nowMs: number;
}) {
  const foe = mine.foe;
  const rtt = useTopicPing(matchTopic(roomId, mine.id), accountId, foe?.id ?? null);
  const net = networkLine(foe ? rtt : null);
  const bit = mine.side === 1 ? 1 : 2;
  const readyMine = (mine.ready & bit) !== 0;
  const left = mine.callUntilMs === null ? null : Math.max(0, Math.ceil((mine.callUntilMs - nowMs) / 1000));
  const cup = mine.kind === "ug_cup";
  return (
    <ParchmentModal title={cup ? "🌙 Tới lượt bạn!" : "🎲 Kèo đã ghép!"} onClose={() => {}} className="sm:max-w-md">
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight" data-testid="ug-call">
        <p>Đối thủ: <b className="text-burgundy">{foe?.name ?? "?"}</b>{foe?.rating != null ? ` · ${tierOf(foe.rating).icon} ${foe.rating}` : ""}</p>
        {cup ? <p className="text-base opacity-80">Trận trong Giải đêm — thắng đi tiếp, tiền nằm trong quỹ giải.</p> : (
          <p className="text-base opacity-80">Phí {formatXu(mine.entry)} · thắng nhận {formatXu(ratedWin(mine.entry).won)} (2 × phí − {UG_FEE_PCT}%) · hòa hoàn phí.</p>
        )}
        <p className={net.ok ? "" : "text-burgundy-accent"} role="status">{net.text}</p>
        {left !== null && <p role="timer">⏱️ Còn {left} giây — không bấm là xử thua.</p>}
        <div className="flex justify-end">
          <button type="button" className="pch-btn pch-btn-primary" disabled={readyMine || ug.busy}
            onClick={() => void ug.ready(mine.id, net.n ?? 6)}>
            {readyMine ? "✅ Đã sẵn sàng · chờ đối thủ" : "Sẵn sàng"}
          </button>
        </div>
      </div>
    </ParchmentModal>
  );
}
