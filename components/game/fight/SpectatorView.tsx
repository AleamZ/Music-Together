"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { G_RESULT, isOver, type State } from "@/lib/game/fight/engine";
import { fightErrorMessage } from "@/lib/game/fight/messages";
import type { FighterLook } from "@/lib/game/fight/render/rig";
import { fightState } from "@/lib/game/fight/rpc";
import { SpectatorFeed } from "@/lib/game/fight/spectate";
import { matchTopic, spectatorTransport } from "@/lib/game/fight/transport";
import type { UgLive } from "@/lib/game/fight/ug-rpc";
import type { Look } from "@/lib/game/types";
import Arena, { type FightDriver } from "./Arena";

/** fight_state is read again this often: a late join, a gap from a lost packet, the end. */
export const SPECTATE_POLL_MS = 5000;

/** v20.4 watching the cage (spec §v20.4 "Spectating the cage", plan ruling U13): the fight on confirmed inputs only, 30
 *  frames behind, never rolled back, in the arena without controls. The spectator hears both fighters' packets
 *  receive-only (it sends nothing but presence) and starts from fight_state; a full cage (6 watching) keeps it out. */
export default function SpectatorView({ token, roomId, me, match, looks, onClose }: {
  token: string;
  roomId: string;
  me: string;
  match: UgLive;
  looks: readonly [Look, Look];
  onClose: () => void;
}) {
  const feed = useMemo(() => new SpectatorFeed(match.params), [match.params]);
  const [full, setFull] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // the fighters' packets on the match topic
  useEffect(() => {
    const h = spectatorTransport(matchTopic(roomId, match.id), me, [match.p1, match.p2], {
      onPacket: (side, p) => feed.onPacket(side, p),
      onFull: () => setFull(true),
    });
    return () => h.close();
  }, [roomId, match.id, match.p1, match.p2, me, feed]);

  // fight_state: the start (a late join) and the backstop
  useEffect(() => {
    let live = true;
    const read = () => {
      fightState(token, match.id).then(({ value }) => {
        if (!live) return;
        feed.seed(value.sim, value.simFrame, value.runs, value.oppRuns);
        if (value.status !== "live") setEnded(value.status);
      }).catch((e: unknown) => { if (live) setError(fightErrorMessage(e)); });
    };
    read();
    const id = window.setInterval(read, SPECTATE_POLL_MS);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [token, match.id, feed]);

  const driver = useMemo((): FightDriver => ({
    tick: () => feed.tick(),
    confirmed: () => feed.shown,
  }), [feed]);
  const [look1, look2] = looks;   // the pair is often a fresh array: memo on its members
  const fighters = useMemo((): readonly [FighterLook, FighterLook] => [
    { look: look1, style: match.params.p1.style, rank: match.params.p1.rank },
    { look: look2, style: match.params.p2.style, rank: match.params.p2.rank },
  ], [look1, look2, match.params]);
  const [over, setOver] = useState<State | null>(null);

  return (
    <div className="game-ui fixed inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-[#120c14]/95 p-2 text-ink" role="dialog" aria-modal="true" aria-label="Xem trận trong lồng">
      <p className="pch px-2 py-0.5 font-vt text-base" data-testid="spectate-bar">
        👀 {match.p1Name} vs {match.p2Name} · {match.kind === "ug_cup" ? "Giải đêm" : "Kèo ngầm"} · trễ ½ giây
      </p>
      {full ? (
        <p className="pch p-3 font-vt text-xl" role="status">Lồng đông quá — đứng ngoài chờ lượt khác nhé.</p>
      ) : (
        <Arena driver={driver} arena="ham_ngam" fighters={fighters} names={[match.p1Name, match.p2Name]} paused={false} controls={false}
          onEsc={() => onCloseRef.current()} onOver={setOver} />
      )}
      {over && isOver(over) && (
        <p className="font-vt text-xl text-[#fff4d8]" role="status">
          {over[G_RESULT] === 1 ? `${match.p1Name} thắng!` : over[G_RESULT] === 2 ? `${match.p2Name} thắng!` : "Hòa!"}
        </p>
      )}
      {ended && !over && <p className="font-vt text-lg text-[#fff4d8]" role="status">Trận đã kết thúc.</p>}
      {error && <p className="font-vt text-lg text-red-300" role="alert">{error}</p>}
      <button type="button" className="pch-btn" onClick={onClose}>Thôi xem (Esc)</button>
    </div>
  );
}
