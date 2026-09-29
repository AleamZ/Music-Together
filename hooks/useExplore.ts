"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { AnticheatError } from "@/lib/anticheat";
import { extrasErrorMessage } from "@/lib/game/fishing/extras-rpc";
import { formatXu } from "@/lib/game/fishing/catalog";
import { HEAT_TEXT } from "@/lib/game/fishing/extras";
import type { MapId, Spot } from "@/lib/game/maps/types";
import { detectorBeep, fanfare } from "@/lib/game/river/beep";
import {
  rowFinish, rowStart, treasureDigFinish, treasureDigStart, treasurePing, type RowDir, type RowFinish,
} from "@/lib/game/river/rpc";
import { beepMs, PING_IDLE_MS, PING_MOVE_PX, PING_MS } from "@/lib/game/river/treasure";
import { liveSync, type LiveSync } from "@/lib/game/mglive";

// v22 (0086) the explore minigames for the game shell: chèo ghe between Cầu ao and Sông Cái (the rowing rhythm, then the
// trip), the metal detector over a treasure map (pings while I walk, a beep that quickens), the shovel dig on the spot
// and the chest's reveal. The server decides every outcome; this only runs the rounds and moves me when it says so.

export interface RowView {
  dir: RowDir;
  phase: "starting" | "playing" | "sending" | "done";
  /** 0087: the round's live channel (mg_sync('row')); null before the start answered. */
  live: LiveSync | null;
  need: number;
  result: RowFinish | null;
}
export interface DetectorView { mapId: string; map: string; band: number | null; wrongMap: boolean }
export interface DigView {
  phase: "starting" | "playing" | "sending" | "done";
  mapId: string;
  /** 0087: the bar's period and the live channel (mg_sync('dig')). */
  period: number;
  live: LiveSync | null;
  need: number;
  win: number;
  message: string;
}
export interface ChestView { loot: number; jackpot: boolean; clean: boolean }

export interface Explore {
  row: RowView | null;
  detector: DetectorView | null;
  dig: DigView | null;
  chest: ChestView | null;
  /** An overlay that takes the input is open (the row, the dig, the chest). */
  open: boolean;
  rowOut: () => void;
  rowHome: () => void;
  rowEnd: (strokes: readonly number[], ticks: number) => void;
  closeRow: () => void;
  detect: (mapId: string, map: string) => void;
  stopDetect: () => void;
  digHere: () => void;
  digEnd: (strikes: readonly number[], ticks: number, pass: boolean) => void;
  closeDig: () => void;
  closeChest: () => void;
}

export function useExplore({ token, roomId, mapId, canvas, toast, travelTo, cancelCast, onCoins, onMaps }: {
  token: string;
  roomId: string;
  mapId: MapId;
  canvas: () => GameCanvasHandle | null;
  toast: (text: string) => void;
  travelTo: (to: { map: MapId; arrive: Spot }) => void;
  cancelCast: () => void;
  /** Coins moved. */
  onCoins: () => void;
  /** The treasure maps changed (one was found). */
  onMaps: () => void;
}): Explore {
  const [row, setRow] = useState<RowView | null>(null);
  const [detector, setDetector] = useState<DetectorView | null>(null);
  const [dig, setDig] = useState<DigView | null>(null);
  const [chest, setChest] = useState<ChestView | null>(null);
  const live = useRef({ toast, canvas, travelTo, cancelCast, onCoins, onMaps });
  useEffect(() => {
    live.current = { toast, canvas, travelTo, cancelCast, onCoins, onMaps };
  });
  const fail = useCallback((err: unknown) => {
    if (!(err instanceof AnticheatError && err.info.strike >= 1)) live.current.toast(extrasErrorMessage(err));
  }, []);

  // --- chèo ghe
  const startRow = useCallback((dir: RowDir) => {
    if (row) return;
    const c = live.current.canvas();
    const at = c?.localPos() ?? null;
    live.current.cancelCast();
    setRow({ dir, phase: "starting", live: null, need: 0, result: null });
    void rowStart(roomId, token, dir, dir === "home" && at ? at : undefined).then(
      (r) => setRow((cur) => cur && cur.phase === "starting" ? { ...cur, phase: "playing", live: liveSync(token, "row"), need: r.need } : cur),
      (err) => {
        setRow(null);
        fail(err);
      },
    );
  }, [row, roomId, token, fail]);
  const rowEnd = useCallback((strokes: readonly number[], ticks: number) => {
    setRow((cur) => cur && cur.phase === "playing" ? { ...cur, phase: "sending" } : cur);
    void rowFinish(roomId, token, strokes, ticks).then(
      (r) => {
        setRow((cur) => cur && { ...cur, phase: "done", result: r });
        if (r.result === "arrived") {
          const to = r.to;
          // the boat glides in: the result card shows a beat, then the fade
          setTimeout(() => {
            setRow(null);
            live.current.travelTo({ map: to.map, arrive: { x: to.x, y: to.y, dir: to.dir } });
          }, 1400);
        }
      },
      (err) => {
        setRow(null);
        fail(err);
      },
    );
  }, [roomId, token, fail]);

  // --- the detector: ping while I move (or every PING_IDLE_MS standing), beep at the band's pace
  const detMap = detector?.mapId ?? null;
  useEffect(() => {
    if (!detMap || !detector) return;
    const map = detector.map;
    let last: { x: number; y: number; at: number } | null = null;
    let busy = false;
    let stopped = false;
    const timer = setInterval(() => {
      const c = live.current.canvas();
      const at = c?.localPos(), here = c?.mapId();
      if (!at || busy) return;
      if (here !== map) {
        setDetector((d) => d && d.mapId === detMap ? { ...d, band: null, wrongMap: true } : d);
        return;
      }
      const now = performance.now();
      if (last && Math.hypot(at.x - last.x, at.y - last.y) < PING_MOVE_PX && now - last.at < PING_IDLE_MS) return;
      busy = true;
      last = { x: at.x, y: at.y, at: now };
      treasurePing(roomId, token, detMap, map, at.x, at.y).then((r) => {
        busy = false;
        if (stopped || "wait" in r) return;
        setDetector((d) => d && d.mapId === detMap ? { ...d, band: "band" in r ? r.band : null, wrongMap: "wrongMap" in r } : d);
      }, (err) => {
        busy = false;
        if (stopped) return;
        stopped = true;
        setDetector(null);
        fail(err);
      });
    }, PING_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // the loop lives as long as the detector is on this map id (its band updates do not restart it)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detMap, roomId, token, fail]);
  const band = detector?.band ?? null;
  useEffect(() => {
    const ms = beepMs(band);
    if (ms === null || band === null) return;
    detectorBeep(band);
    const timer = setInterval(() => detectorBeep(band), Math.max(110, ms));
    return () => clearInterval(timer);
  }, [band]);

  // --- the dig on the spot
  const digHere = useCallback(() => {
    if (!detector || dig) return;
    const c = live.current.canvas();
    const at = c?.localPos(), here = c?.mapId();
    if (!at || !here) return;
    const id = detector.mapId;
    setDig({ phase: "starting", mapId: id, period: 100, live: null, need: 3, win: 120, message: "" });
    c?.puff({ x: at.x, y: at.y - 6 });
    void treasureDigStart(roomId, token, id, here, at.x, at.y).then((r) => {
      if (r.result === "dig") setDig((d) => d && { ...d, phase: "playing", period: r.period, live: liveSync(token, "dig"), need: r.need, win: r.win });
      else {
        setDig(null);
        live.current.toast(HEAT_TEXT[r.heat]);
      }
    }, (err) => {
      setDig(null);
      fail(err);
    });
  }, [detector, dig, roomId, token, fail]);
  const digEnd = useCallback((strikes: readonly number[], ticks: number, pass: boolean) => {
    setDig((d) => d && { ...d, phase: "sending" });
    void treasureDigFinish(roomId, token, strikes, ticks, pass).then((r) => {
      if (r.result === "found") {
        setDig(null);
        setDetector(null);
        setChest({ loot: r.loot, jackpot: r.jackpot, clean: r.clean });
        fanfare();
        live.current.toast(r.jackpot ? `💰 HŨ VÀNG! Kho báu ${formatXu(r.loot)}!` : `💰 Đào trúng kho báu: ${formatXu(r.loot)}!`);
        live.current.onCoins();
        live.current.onMaps();
      } else {
        setDig((d) => d && {
          ...d, phase: "done",
          message: r.why === "expired" ? "Đào lâu quá — đất lấp lại mất rồi. Đào lại nhé!"
            : r.why === "late" ? "Mạng chập chờn — lượt đào không được tính, kho báu vẫn nằm đó."
            : "Xẻng trượt nhịp rồi — kho báu vẫn nằm đó, đào lại nhé!",
        });
      }
    }, (err) => {
      setDig(null);
      fail(err);
    });
  }, [roomId, token, fail]);

  // leaving the map stops the detector (another map's band would be a wrong-map anyway)
  const [seenMap, setSeenMap] = useState(mapId);
  if (seenMap !== mapId) {
    setSeenMap(mapId);
    if (row?.phase === "done") setRow(null);
  }

  return {
    row, detector, dig, chest,
    open: row !== null || dig !== null || chest !== null,
    rowOut: useCallback(() => startRow("out"), [startRow]),
    rowHome: useCallback(() => startRow("home"), [startRow]),
    rowEnd,
    closeRow: useCallback(() => setRow((r) => (r && (r.phase === "done" || r.phase === "playing") && r.result?.result !== "arrived" ? null : r)), []),
    detect: useCallback((id: string, map: string) => setDetector({ mapId: id, map, band: null, wrongMap: false }), []),
    stopDetect: useCallback(() => setDetector(null), []),
    digHere,
    digEnd,
    closeDig: useCallback(() => setDig((d) => (d && d.phase === "done" ? null : d)), []),
    closeChest: useCallback(() => setChest(null), []),
  };
}
