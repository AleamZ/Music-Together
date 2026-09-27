import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import type { LocalLift } from "@/lib/game/engine";
import type { MapId } from "@/lib/game/maps/types";
import type { LiftMessage } from "@/lib/game/net/protocol";
import { LIFT_IDLE, liftNoteText, liftReduce, type LiftEvent, type LiftModel, type LiftState } from "@/lib/game/travel/lift";
import type { VehicleId } from "@/lib/game/travel/vehicles";

// v18.13 Đi nhờ xe: the shell's lift layer. The state machine is lib/game/travel/lift.ts; this hook feeds it the
// buttons, the E key, the messages addressed to me, the expiries and my getting off, and applies what it answers
// (messages out, my lift on the canvas, toasts, following the driver through a portal).

const PROBE_MS = 250;
const TICK_MS = 500;

export interface LiftView {
  state: LiftState;
  /** A request shown to me (the driver): who asks. */
  offer: { from: string; name: string } | null;
  /** The rider I could ask now. */
  candidate: { id: string; name: string } | null;
  /** The partner's name (asking / riding with / carrying). */
  partner: string | null;
  /** I sit on someone's vehicle. */
  aboard: boolean;
  ask: () => void;
  accept: () => void;
  decline: () => void;
  /** The passenger's "Xuống xe". */
  leave: () => void;
  /** The driver's "Cho xuống". */
  drop: () => void;
  /** I (the driver) take a portal to `m`: my passenger follows. */
  portal: (m: MapId) => void;
  onMessage: (msg: LiftMessage) => void;
  onLost: () => void;
}

const toLocal = (s: LiftState): LocalLift | null =>
  s.kind === "driver" ? { role: "driver", peer: s.passenger } : s.kind === "passenger" ? { role: "passenger", peer: s.driver } : null;

const partnerOf = (s: LiftState): string | null =>
  s.kind === "driver" ? s.passenger : s.kind === "passenger" || s.kind === "asking" ? s.driver : null;

export function useLift(opts: {
  canvasRef: RefObject<GameCanvasHandle | null>;
  riding: VehicleId | null;
  /** May I ask for a lift now (on foot, nothing holds me: no cast, farm work, card seat, road, faint or panel)? */
  canAsk: boolean;
  /** May I take a passenger now (riding, not on the road or fainted)? */
  canCarry: boolean;
  fainted: boolean;
  /** On the road or fading through a portal: a partner's `bye` then is the trip, not a lost lift. */
  inTransit: () => boolean;
  nameOf: (id: string) => string;
  toast: (text: string) => void;
  /** Follow my driver through their portal to `m` on vehicle `v`; false when there is no such portal here. */
  follow: (m: MapId, v: VehicleId) => boolean;
}): LiftView {
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });
  const modelRef = useRef<LiftModel>(LIFT_IDLE);
  const [model, setModel] = useState<LiftModel>(LIFT_IDLE);
  const [candidate, setCandidate] = useState<{ id: string; name: string } | null>(null);

  const dispatch = useCallback((first: LiftEvent) => {
    const run = (ev: LiftEvent): void => {
      const prev = modelRef.current;
      const step = liftReduce(prev, ev);
      modelRef.current = step.model;
      const o = optsRef.current;
      const canvas = o.canvasRef.current;
      for (const m of step.send) canvas?.sendLift(m);
      if (step.model.state !== prev.state) canvas?.setLift(toLocal(step.model.state));
      if (step.model !== prev) setModel(step.model);
      if (step.note) o.toast(liftNoteText(step.note.kind, o.nameOf(step.note.who)));
      // no portal to that map here (it should not happen): get off rather than be left behind
      if (step.follow && step.model.state.kind === "passenger" && !o.follow(step.follow, step.model.state.v)) run({ e: "leave" });
    };
    run(first);
  }, []);

  // the rider I could ask, polled while I may ask
  const { canAsk, riding, fainted, canvasRef } = opts;
  const idle = model.state.kind === "none";
  useEffect(() => {
    if (!canAsk || !idle) return;
    const id = setInterval(() => setCandidate(canvasRef.current?.liftCandidate() ?? null), PROBE_MS);
    return () => {
      clearInterval(id);
      setCandidate(null);
    };
  }, [canAsk, idle, canvasRef]);

  // the expiries (my wait, the prompt shown to me)
  const waiting = model.state.kind === "asking" || model.offer !== null;
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => dispatch({ e: "tick", now: performance.now() }), TICK_MS);
    return () => clearInterval(id);
  }, [waiting, dispatch]);

  // getting off my vehicle drops my passenger (and declines a waiting request); a faint takes me off theirs
  useEffect(() => {
    if (riding === null) queueMicrotask(() => dispatch({ e: "dismounted" }));
  }, [riding, dispatch]);
  useEffect(() => {
    if (fainted) queueMicrotask(() => dispatch({ e: "leave" }));
  }, [fainted, dispatch]);

  const ask = useCallback(() => {
    const c = optsRef.current.canvasRef.current?.liftCandidate() ?? null;
    if (!c || !optsRef.current.canAsk) return;
    dispatch({ e: "ask", driver: c.id, now: performance.now() });
  }, [dispatch]);
  const accept = useCallback(() => {
    const o = optsRef.current, from = modelRef.current.offer?.from;
    // the asker must still be here and near; else the request is declined
    if (from && (!o.canCarry || !o.canvasRef.current?.nearForLift(from))) {
      dispatch({ e: "decline" });
      return;
    }
    dispatch({ e: "accept", riding: o.canCarry ? o.riding : null });
  }, [dispatch]);
  const decline = useCallback(() => dispatch({ e: "decline" }), [dispatch]);
  const leave = useCallback(() => dispatch({ e: "leave" }), [dispatch]);
  const drop = useCallback(() => dispatch({ e: "drop" }), [dispatch]);
  const portal = useCallback((m: MapId) => dispatch({ e: "portal", m }), [dispatch]);
  const onMessage = useCallback((msg: LiftMessage) => {
    const o = optsRef.current;
    dispatch({
      e: "msg", msg, now: performance.now(), riding: o.riding, free: o.canCarry,
      near: msg.t === "rq" ? o.canvasRef.current?.nearForLift(msg.id) ?? false : true,
    });
  }, [dispatch]);
  const onLost = useCallback(() => {
    // on the road (or fading through a portal) my partner's `bye` is the trip: keep the lift for the next world
    if (optsRef.current.inTransit()) {
      optsRef.current.canvasRef.current?.setLift(toLocal(modelRef.current.state));
      return;
    }
    dispatch({ e: "lost" });
  }, [dispatch]);

  const offer = model.offer ? { from: model.offer.from, name: opts.nameOf(model.offer.from) } : null;
  const p = partnerOf(model.state);
  return {
    state: model.state, offer, candidate: idle ? candidate : null, partner: p ? opts.nameOf(p) : null,
    aboard: model.state.kind === "passenger",
    ask, accept, decline, leave, drop, portal, onMessage, onLost,
  };
}
