"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { progressState, setTitle as rpcSetTitle, waypointTravel, type ProgressState, type TeleportResult } from "@/lib/game/progression/rpc";
import { progressionErrorText } from "@/lib/game/progression/model";

const POLL_MS = 60_000;

/** v21 progression: my level, XP, titles, Fishdex and waypoints (0070). Polled once a minute (and on demand) so a level-up
 *  shows up on the HUD; a level gained since the last read is announced with `onLevelUp`. */
export function useProgress(token: string | null, opts: { onLevelUp?: (level: number) => void; toast?: (t: string) => void } = {}) {
  const [state, setState] = useState<ProgressState | null>(null);
  const [busy, setBusy] = useState(false);
  const lastLevel = useRef<number | null>(null);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const apply = useCallback((s: ProgressState) => {
    if (lastLevel.current !== null && s.level > lastLevel.current) optsRef.current.onLevelUp?.(s.level);
    lastLevel.current = s.level;
    setState(s);
  }, []);

  const fail = useCallback((e: unknown) => {
    const msg = (e as { message?: string } | null)?.message ?? "";
    optsRef.current.toast?.(progressionErrorText(msg) ?? (msg === "account locked" ? "Tài khoản đang bị khoá tạm thời." : "Không thực hiện được — thử lại nhé."));
  }, []);

  const reload = useCallback(async () => {
    if (!token) return;
    try {
      apply(await progressState(token));
    } catch {
      /* the next poll retries */
    }
  }, [token, apply]);

  useEffect(() => {
    if (!token) return;
    const first = window.setTimeout(() => void reload(), 0);
    const id = window.setInterval(() => void reload(), POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [token, reload]);

  const setTitle = useCallback(async (achievement: string | null) => {
    if (!token || busy) return;
    setBusy(true);
    try {
      apply(await rpcSetTitle(token, achievement));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }, [token, busy, apply, fail]);

  const travel = useCallback(async (to: string): Promise<TeleportResult | null> => {
    if (!token || busy) return null;
    setBusy(true);
    try {
      const r = await waypointTravel(token, to);
      void reload();
      return r;
    } catch (e) {
      fail(e);
      return null;
    } finally {
      setBusy(false);
    }
  }, [token, busy, reload, fail]);

  return { state, busy, reload, setTitle, travel };
}
