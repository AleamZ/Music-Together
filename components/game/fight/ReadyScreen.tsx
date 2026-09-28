"use client";

import { useState } from "react";
import { beltOf, martialByKey } from "@/lib/game/fight/dojo";
import { inputDelay, lagFrames, lagRefusal } from "@/lib/game/fight/net";
import { stancePoseIds } from "@/lib/game/fight/render/poses";
import { FEE_PCT, STAKES, recordText, stakeText, winnings, type RingFighter, type RingView } from "@/lib/game/fight/rings";
import type { Look } from "@/lib/game/types";
import { ParchmentModal } from "../Parchment";
import RigPreview from "./RigPreview";

/** The network line: measuring, then "Ping 84 ms · Trễ 4 khung", or the refusal of a link that is too slow. */
export function networkLine(rtt: number | null): { text: string; ok: boolean; n: number | null } {
  if (rtt === null) return { text: "📶 Đang đo mạng…", ok: false, n: null };
  const refusal = lagRefusal(rtt);
  if (refusal) return { text: `📶 ${refusal}`, ok: false, n: null };
  const n = inputDelay(lagFrames(rtt));
  return { text: `📶 Ping ${Math.round(rtt)} ms · Trễ ${n} khung`, ok: true, n };
}

function FighterCard({ f, corner, look, me }: { f: RingFighter | null; corner: "red" | "blue"; look: Look | null; me: boolean }) {
  const colour = corner === "red" ? "border-red-700" : "border-blue-700";
  const title = corner === "red" ? "🔴 Góc Đỏ" : "🔵 Góc Xanh";
  if (!f) {
    return (
      <div className={`flex min-h-44 flex-1 flex-col items-center justify-center gap-1 rounded border-2 border-dashed ${colour} p-2 text-center`}>
        <b>{title}</b>
        <span className="opacity-80">Đang chờ đối thủ…</span>
      </div>
    );
  }
  const style = f.style ? martialByKey(f.style) : null;
  const belt = style && f.rank !== null ? beltOf(style.id, f.rank) : null;
  return (
    <div className={`flex flex-1 flex-col items-center gap-1 rounded border-2 ${colour} p-2 text-center`} data-testid={`ring-${corner}`}>
      <b>{title}{me ? " · Bạn" : ""}</b>
      {look && style ? (
        <RigPreview look={look} style={style.id} rank={f.rank ?? 0} poses={stancePoseIds(style.id)} ms={420} label={`${f.name} thủ thế`} />
      ) : <div className="h-32" />}
      <span className="text-xl text-burgundy">{f.name}</span>
      <span>{style ? `${style.name} · ${belt?.name ?? ""}` : "Chưa mặc võ phục"}</span>
      {belt && <span className="inline-block h-2 w-16 rounded-sm border border-ink/40" style={{ background: belt.color }} aria-hidden="true" />}
      <span className="text-base opacity-80">{recordText(f)}</span>
    </div>
  );
}

/** v20.3 the ready screen (spec §v20.3 "Challenge flow" 2–4): both fighters in their uniforms with style, belt and PvP
 *  record, the ring's stake offer and who accepted it, the network line, and "Đồng ý", "Đổi mức cược", "Rời sàn".
 *  Presentational: the container measures the link and runs the RPCs. */
export default function ReadyScreen({ view, me, myLook, foeLook, rtt, busy, lockedUntilMs, nowMs, onOffer, onAccept, onLeave, onClose }: {
  view: RingView;
  me: "red" | "blue";
  myLook: Look;
  foeLook: Look | null;
  /** The measured RTT p90 (null while measuring). */
  rtt: number | null;
  busy: boolean;
  /** Staked fights locked until then (the 2-conflicts rule). */
  lockedUntilMs: number | null;
  nowMs: number;
  onOffer: (stake: number, n: number) => void;
  onAccept: (v: number, n: number) => void;
  onLeave: () => void;
  onClose: () => void;
}) {
  const offer = view.offer;
  const [pick, setPick] = useState<number>(offer?.stake ?? 0);
  const [changing, setChanging] = useState(false);
  const foe = me === "red" ? view.blue : view.red;
  const net = networkLine(foe ? rtt : null);
  const locked = lockedUntilMs !== null && lockedUntilMs > nowMs;
  const mineOk = offer ? (me === "red" ? offer.redOk : offer.blueOk) : false;
  const theirOk = offer ? (me === "red" ? offer.blueOk : offer.redOk) : false;
  const canPlay = !!foe && net.ok && net.n !== null && !busy;
  const w = winnings(offer?.stake ?? pick);
  const who = (ok: boolean, name: string) => `${ok ? "✅" : "⏳"} ${name}`;

  return (
    <ParchmentModal title={`🥊 Sàn ${view.ring} · Bãi đất trống`} onClose={onClose} className="sm:max-w-2xl">
      <div className="flex flex-col gap-3 font-vt text-lg leading-tight" data-testid="ready-screen">
        <div className="flex items-stretch gap-2">
          <FighterCard f={view.red} corner="red" look={me === "red" ? myLook : foeLook} me={me === "red"} />
          <span className="self-center text-3xl text-burgundy" aria-hidden="true">VS</span>
          <FighterCard f={view.blue} corner="blue" look={me === "blue" ? myLook : foeLook} me={me === "blue"} />
        </div>
        <p className={net.ok ? "" : "text-burgundy-accent"} role="status" data-testid="ring-net">{net.text}</p>
        {foe && (
          <div className="flex flex-col gap-2 rounded border border-ink/30 p-2">
            {offer ? (
              <>
                <p>Mức cược: <b className="text-burgundy">{stakeText(offer.stake)}</b> · {offer.by === (me === "red" ? 1 : 2) ? "bạn đề nghị" : `${foe.name} đề nghị`}</p>
                <p className="text-base">{who(mineOk, "Bạn")} · {who(theirOk, foe.name)}</p>
              </>
            ) : <p>Chưa ai đề nghị mức cược.</p>}
            {offer && offer.stake > 0 && (
              <p className="text-base opacity-80">
                Người thắng nhận {stakeText(w.won)} (2 × cược − {FEE_PCT}% phí {stakeText(w.fee)}); hòa thì hoàn cược. Thua mất cược, không ngất.
              </p>
            )}
            {offer && offer.stake === 0 && <p className="text-base opacity-80">Giao hữu: không mất xu, vẫn tính thắng thua.</p>}
            {(changing || !offer) && (
              <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Mức cược">
                {STAKES.map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={pick === s} disabled={busy || (locked && s > 0)}
                    className={`pch-btn px-2 py-0.5 text-base ${pick === s ? "pch-btn-primary" : ""}`} onClick={() => setPick(s)}>
                    {stakeText(s)}
                  </button>
                ))}
              </div>
            )}
            {locked && <p className="text-base text-burgundy-accent">🔒 Tạm khóa đấu cược đến {new Date(lockedUntilMs!).toLocaleString("vi-VN")} — vẫn đấu giao hữu được.</p>}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="pch-btn" disabled={busy} onClick={onLeave}>Rời sàn</button>
          {foe && offer && !changing && (
            <button type="button" className="pch-btn" disabled={busy} onClick={() => { setPick(offer.stake); setChanging(true); }}>Đổi mức cược</button>
          )}
          {foe && (changing || !offer) && (
            <button type="button" className="pch-btn pch-btn-primary" disabled={!canPlay || (locked && pick > 0)}
              onClick={() => { setChanging(false); onOffer(pick, net.n!); }}>
              {`Đề nghị ${stakeText(pick)}`}
            </button>
          )}
          {foe && offer && !changing && (
            <button type="button" className="pch-btn pch-btn-primary" disabled={!canPlay || mineOk} onClick={() => onAccept(offer.v, net.n!)}>
              {mineOk ? "Đã đồng ý · chờ đối thủ" : `Đồng ý · ${stakeText(offer.stake)}`}
            </button>
          )}
        </div>
      </div>
    </ParchmentModal>
  );
}
