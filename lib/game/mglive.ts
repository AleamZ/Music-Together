"use client";

// v22 fixes (0087): the live channel of every server-replayed minigame. A *_start no longer answers the round (a seed
// let a bot compute the perfect inputs at once): the round stays on the server and public.mg_sync reveals it a bounded
// time ahead — the arrows 2 s before their beat, the drift, the grains, the treats, the strokes, the trail 0.5–1.5 s
// ahead; a "gate" (the hunted animal, the anvil's glow, the power meter's sweet spot, a dig's next vein) at a secret
// tick, or when the strike that uncovers it has been stamped. The first sync starts the round's clock (tick 0 is when
// its answer arrives here); every sync sends the inputs made so far, which the server stamps with its time — an input
// list may only grow, never run ahead of the server's clock, and each input must reach the server within 2 s of the
// tick it claims (the client syncs every 0.2 s), so a round can only be played live. An input acting on a gate may not
// claim a tick before that gate arrived (+ a human reaction): the overlays ignore presses for GATE_GUARD_MS after it.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

export type LiveGame = "world" | "brew" | "anvil" | "sort" | "care" | "row" | "dig" | "mine" | "press";
/** The revealed events: event number → its payload. */
export type LiveEvents = Record<number, Record<string, number>>;
export interface LiveSnap { t: number; ev: LiveEvents }
/** One sync: the input lists so far (null = unchanged). */
export type LiveSync = (a: readonly number[] | null, b: readonly number[] | null) => Promise<LiveSnap>;

/** How often the overlays sync while a round runs. */
export const SYNC_MS = 200;
const PUMP_MS = 40;
/** A press within this long after a gate arrived is ignored (the server refuses a claim < 0.1 s after the reveal). */
export const GATE_GUARD_MS = 250;

export function parseSync(raw: unknown): LiveSnap {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const ev: LiveEvents = {};
  for (const e0 of Array.isArray(o.ev) ? o.ev : []) {
    const e = e0 && typeof e0 === "object" ? (e0 as Record<string, unknown>) : {};
    const i = Number(e.i);
    const d = e.d && typeof e.d === "object" ? (e.d as Record<string, unknown>) : {};
    if (!Number.isInteger(i)) continue;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(d)) if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    ev[i] = out;
  }
  return { t: typeof o.t === "number" ? o.t : 0, ev };
}

export async function mgSync(token: string, game: LiveGame, a: readonly number[] | null, b: readonly number[] | null): Promise<LiveSnap> {
  const { data, error } = await supabase.rpc("mg_sync", { p_session_token: token, p_game: game, p_a: a, p_b: b });
  if (error) throw error;
  return parseSync(data);
}

/** The sync function of one game, for an overlay. */
export const liveSync = (token: string, game: LiveGame): LiveSync => (a, b) => mgSync(token, game, a, b);

/** A stand-in with every event known at once, for previews and tests (no server, nothing hidden). */
export const localLive = (ev: LiveEvents): LiveSync => () => Promise.resolve({ t: 0, ev });

/** The round's tick from wall time since tick 0 (no ticks are ever dropped: a claimed tick is never early). */
export const liveTick = (t0: number, now: number): number => Math.max(0, Math.floor(((now - t0) * 60) / 1000 + 1e-7));

export interface Live {
  /** The first sync has answered: tick 0 is `t0` (performance.now()). */
  ready: boolean;
  t0: number;
  /** The events revealed so far (a ref, read in the animation loop) and when each arrived (performance.now()). */
  ev: React.RefObject<LiveEvents>;
  at: React.RefObject<Record<number, number>>;
  /** The same events as state (for rendering). */
  events: LiveEvents;
  /** Bumped when new events arrive. */
  version: number;
  /** Sync now (after an input the next reveal depends on). */
  flush: () => void;
  /** Stop syncing (the round is over; the finish RPC stamps what is left). */
  stop: () => void;
  /** The round could not be synced (gone / network): the overlay should give up. */
  failed: boolean;
}

/**
 * Run a live round: sync at once (tick 0), then every SYNC_MS and on flush(), sending `inputs()` each time. One sync in
 * flight at a time; errors are retried until the round is stopped (a lost round shows as `failed` after 3 in a row).
 */
export function useLive(sync: LiveSync | null, inputs: () => [readonly number[] | null, readonly number[] | null]): Live {
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);
  const [failed, setFailed] = useState(false);
  const [t0s, setT0] = useState(0);
  const [events, setEvents] = useState<LiveEvents>({});
  const t0 = useRef(0);
  const ev = useRef<LiveEvents>({});
  const at = useRef<Record<number, number>>({});
  const busy = useRef(false);
  const again = useRef(false);
  const last = useRef(0);
  const stopped = useRef(false);
  const errors = useRef(0);
  const syncRef = useRef(sync);
  const inputsRef = useRef(inputs);
  useEffect(() => {
    syncRef.current = sync;
    inputsRef.current = inputs;
  });

  const run = useCallback(() => {
    const s = syncRef.current;
    if (!s || stopped.current) return;
    if (busy.current) { again.current = true; return; }
    busy.current = true;
    again.current = false;
    last.current = performance.now();
    const [a, b] = inputsRef.current();
    s(a ? a.slice() : null, b ? b.slice() : null).then((snap) => {
      const now = performance.now();
      if (t0.current === 0) {
        t0.current = now;
        setT0(now);
        setReady(true);
      }
      let fresh = false;
      for (const [k, v] of Object.entries(snap.ev)) {
        const i = Number(k);
        if (!(i in ev.current)) { ev.current = { ...ev.current, [i]: v }; at.current = { ...at.current, [i]: now }; fresh = true; }
      }
      if (fresh) {
        setEvents(ev.current);
        setVersion((x) => x + 1);
      }
      errors.current = 0;
    }, () => {
      errors.current += 1;
      if (errors.current >= 3 && !stopped.current) setFailed(true);
    }).finally(() => {
      busy.current = false;
    });
  }, []);

  useEffect(() => {
    if (!sync) return;
    stopped.current = false;
    run();
    // every SYNC_MS, and at once (within a pump) after a flush that found a sync in flight
    const id = window.setInterval(() => {
      if (again.current || performance.now() - last.current >= SYNC_MS) run();
    }, PUMP_MS);
    return () => {
      stopped.current = true;
      window.clearInterval(id);
    };
  }, [sync, run]);

  const stop = useCallback(() => { stopped.current = true; }, []);
  return { ready, t0: t0s, ev, at, events, version, flush: run, stop, failed };
}

/** Resolve once events 1 … n have all arrived (syncing meanwhile), or false after `ms`. A finish that reports a score
 *  replays it on the whole revealed round, so it waits for the last events a slow network may still owe. */
export async function waitEvents(live: Pick<Live, "ev" | "flush">, n: number, ms = 3000): Promise<boolean> {
  const all = () => { for (let i = 1; i <= n; i++) if (!live.ev.current?.[i]) return false; return true; };
  const until = performance.now() + ms;
  while (!all()) {
    if (performance.now() > until) return false;
    live.flush();
    await new Promise((r) => setTimeout(r, 100));
  }
  return true;
}
