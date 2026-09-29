"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { AnticheatError } from "@/lib/anticheat";
import { BOAT, HEAT_TEXT, myBattle, type BattleBoard, type ExtrasState } from "@/lib/game/fishing/extras";
import {
  boardBoat, buyBoat, createBattle, digTreasure, extrasErrorMessage, fetchBattles, fetchExtras, joinBattle, leaveBattle,
  leaveBoat, startBattle,
} from "@/lib/game/fishing/extras-rpc";
import { formatXu } from "@/lib/game/fishing/catalog";

/** v21 (0076) the fishing extras for the fishing controller: the boat, the battles' board and the treasure maps. */
export interface FishingExtras {
  state: ExtrasState | null;
  board: BattleBoard | null;
  busy: boolean;
  reload: () => void;
  buyBoat: () => void;
  boardBoat: () => void;
  leave: () => void;
  createBattle: (fee: number, durationS: number) => void;
  joinBattle: (id: string) => void;
  leaveBattle: (id: string) => void;
  startBattle: (id: string) => void;
  /** Dig for map `id` where I stand (the server checks the spot and my position). */
  dig: (id: string) => void;
  /** The last dig's answer line, per map. */
  digNote: Record<string, string>;
  /** The map the canvas showed at the last syncMap (the treasure panel's "here"). */
  mapNow: string | null;
  syncMap: () => void;
  /** v22: my battle just ended (the fanfare card), until dismissed. */
  battleResult: { won: boolean; prize: number } | null;
  dismissBattleResult: () => void;
}

/** Battles are polled this often while the board is open or I am in one; else rarely. */
const BOARD_FAST_MS = 3000;
const BOARD_SLOW_MS = 20_000;

export function useFishingExtras({ token, roomId, canvas, toast, watching, onCoins }: {
  token: string;
  roomId: string;
  canvas: () => GameCanvasHandle | null;
  toast: (text: string) => void;
  /** The battle panel is open: poll the board fast. */
  watching: boolean;
  /** Coins moved (the fishing HUD reads its own state: fetch it again). */
  onCoins: () => void;
}): FishingExtras {
  const [state, setState] = useState<ExtrasState | null>(null);
  const [board, setBoard] = useState<BattleBoard | null>(null);
  const [busy, setBusy] = useState(false);
  const [digNote, setDigNote] = useState<Record<string, string>>({});
  const [mapNow, setMapNow] = useState<string | null>(null);
  const [battleResult, setBattleResult] = useState<{ won: boolean; prize: number } | null>(null);   // v22
  const live = useRef({ toast, onCoins, canvas });
  useEffect(() => {
    live.current = { toast, onCoins, canvas };
  });

  const reload = useCallback(() => {
    fetchExtras(token).then(setState).catch(() => {});
  }, [token]);
  const reloadBoard = useCallback(() => {
    fetchBattles(roomId, token).then(setBoard).catch(() => {});
  }, [roomId, token]);

  useEffect(() => {
    const t = setTimeout(reload, 0);
    return () => clearTimeout(t);
  }, [reload]);

  // the board: fast while watched or while I am in a battle, else slowly (a battle I am in ends on its own clock)
  const mine = myBattle(board);
  const fast = watching || mine !== null;
  useEffect(() => {
    const first = setTimeout(reloadBoard, 0);
    const timer = setInterval(reloadBoard, fast ? BOARD_FAST_MS : BOARD_SLOW_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [fast, reloadBoard]);
  // a battle of mine that just settled: the coins moved, say how it went
  const lastMine = useRef<string | null>(null);
  useEffect(() => {
    const prev = lastMine.current;
    lastMine.current = mine?.id ?? null;
    if (!prev || mine?.id === prev || !board) return;
    const done = board.battles.find((b) => b.id === prev);
    if (!done) return;
    if (done.status === "done") {
      setBattleResult({ won: done.winners.includes(board.me), prize: done.prize });                   // v22: the fanfare
      live.current.toast(done.winners.includes(board.me) ? `🏆 Bạn thắng trận câu! +${formatXu(done.prize)}` : "🎣 Trận câu đã xong — chúc lần sau may mắn!");
    } else if (done.status === "cancelled") {
      live.current.toast("Trận câu đã huỷ — tiền cược đã trả lại.");
    }
    live.current.onCoins();
  }, [mine, board]);

  const run = useCallback(async <T,>(job: () => Promise<T>, then: (r: T) => void) => {
    setBusy(true);
    try {
      then(await job());
    } catch (err) {
      if (!(err instanceof AnticheatError && err.info.strike >= 1)) live.current.toast(extrasErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const boardUp = useCallback((b: BattleBoard) => {
    setBoard(b);
    live.current.onCoins();
  }, []);

  return {
    state, board, busy, reload, digNote, mapNow, battleResult,
    dismissBattleResult: useCallback(() => setBattleResult(null), []),
    syncMap: useCallback(() => setMapNow(live.current.canvas()?.mapId() ?? null), []),
    buyBoat: useCallback(() => void run(() => buyBoat(roomId, token), (s) => {
      setState(s);
      live.current.onCoins();
      live.current.toast("⛵ Ghe là của bạn! Bấm \"Lên ghe\" để ra vùng nước sâu.");
    }), [run, roomId, token]),
    boardBoat: useCallback(() => void run(() => boardBoat(roomId, token), (s) => {
      setState(s);
      live.current.canvas()?.plant(BOAT.deck, "up");
      live.current.toast("⛵ Đã ra vùng nước sâu — bấm E hoặc chạm ghe để quăng cần.");
    }), [run, roomId, token]),
    leave: useCallback(() => void run(() => leaveBoat(roomId, token), (s) => {
      setState(s);
      live.current.canvas()?.plant(BOAT.pier, "down");
    }), [run, roomId, token]),
    createBattle: useCallback((fee: number, d: number) => void run(() => createBattle(roomId, token, fee, d), boardUp), [run, roomId, token, boardUp]),
    joinBattle: useCallback((id: string) => void run(() => joinBattle(roomId, token, id), boardUp), [run, roomId, token, boardUp]),
    leaveBattle: useCallback((id: string) => void run(() => leaveBattle(roomId, token, id), boardUp), [run, roomId, token, boardUp]),
    startBattle: useCallback((id: string) => void run(() => startBattle(roomId, token, id), setBoard), [run, roomId, token]),
    dig: useCallback((id: string) => {
      const c = live.current.canvas();
      const at = c?.localPos() ?? null, map = c?.mapId() ?? null;
      if (!at || !map) return;
      c?.puff({ x: at.x, y: at.y - 6 });
      void run(() => digTreasure(roomId, token, id, map, at.x, at.y), (r) => {
        if (r.result === "found") {
          live.current.toast(r.jackpot ? `💰 HŨ VÀNG! Kho báu ${formatXu(r.loot)}!` : `💰 Đào trúng kho báu: ${formatXu(r.loot)}!`);
          live.current.onCoins();
          reload();
        } else {
          setDigNote((n) => ({ ...n, [id]: HEAT_TEXT[r.heat] }));
        }
      });
    }, [run, roomId, token, reload]),
  };
}
