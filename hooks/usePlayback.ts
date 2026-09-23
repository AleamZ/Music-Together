"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useYouTubePlayer } from "@/hooks/useYouTubePlayer";
import { computeElapsedMs } from "@/lib/identity";
import { needsResync, shouldPlay, targetSeconds } from "@/lib/playback-sync";
import { advanceQueue, seekPlayback, setPlayback, type QueueItem, type Room } from "@/lib/supabase";

const VOL_KEY = "music-together:volume";
const TICK_MS = 1000;
const DRIFT_EVERY_TICKS = 5;
const PLAY_ERROR = "Video này không phát được trên thiết bị của bạn.";

export interface PlaybackController {
  durationMs: number;
  volume: number;
  unlocked: boolean;              // autoplay gate passed on this device
  unlock: () => void;             // call from a click handler
  playError: string | null;       // this device could not play the current track
  togglePlay: () => void;         // DJ only (no-op otherwise)
  skip: () => void;               // DJ only
  seekMs: (ms: number) => void;   // DJ only
  setVolume: (v: number) => void; // everyone (local)
}

/** Playback engine for EVERY member. The hidden player follows the room row (track, play/pause,
 *  position, drift); only the DJ branches write room state (advance, play/pause, seek).
 *  Effects depend on primitives (ids, flags) and on the player hook's stable callbacks — never on the
 *  `room`/`current` objects, which are re-created on every realtime refetch and would re-seek the player. */
export function usePlayback({ room, current, isDj, queueLen, roomId, token }: {
  room: Room; current: QueueItem | null; isDj: boolean; queueLen: number; roomId: string; token: string;
}): PlaybackController {
  const [durationMs, setDurationMs] = useState(0);
  const [volume, setVol] = useState(100);
  const [unlocked, setUnlocked] = useState(false);
  const [playErr, setPlayErr] = useState<{ trackId: string; message: string } | null>(null);
  const loadedRef = useRef<string | null>(null); // currently loaded queue item id

  const currentId = current?.id ?? null;
  const currentVideoId = current?.youtube_video_id ?? null;
  const playing = room.is_playing;
  const startedAt = room.started_at;
  const pausedElapsed = room.paused_elapsed_ms;

  // Latest room row for timers/handlers (synced after render — never assigned during render).
  const roomRef = useRef(room);
  useEffect(() => { roomRef.current = room; });

  const advancingRef = useRef(false);
  const replayAttemptedRef = useRef(false);
  const advance = useCallback(() => {
    if (!isDj || advancingRef.current) return;
    advancingRef.current = true;
    void advanceQueue(roomId, token).catch(() => { advancingRef.current = false; });
  }, [isDj, roomId, token]);
  useEffect(() => {
    if (room.current_item_id || queueLen === 0) advancingRef.current = false;
    if (room.current_item_id || queueLen > 0) replayAttemptedRef.current = false;
  }, [room.current_item_id, queueLen]);

  // Listeners do nothing on ended: the DJ's advance changes current_item_id and realtime delivers it.
  const { ready, load, play, pause, seekTo, setVolume: setPlayerVolume, getDuration, getCurrentTime } = useYouTubePlayer(
    () => advance(),
    () => setPlayErr(currentId ? { trackId: currentId, message: PLAY_ERROR } : null),
  );

  // Restore saved volume once.
  useEffect(() => {
    const raw = localStorage.getItem(VOL_KEY);
    const v = raw === null ? NaN : Number(raw);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from localStorage
    if (Number.isFinite(v) && v >= 0 && v <= 100) setVol(v);
  }, []);
  // A document that already had a user gesture (e.g. the click that entered the room) may play with sound.
  useEffect(() => {
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of browser activation state
    if (ua?.hasBeenActive) setUnlocked(true);
  }, []);
  // Apply volume for everyone whenever it changes / the player becomes ready.
  useEffect(() => { if (ready) setPlayerVolume(volume); }, [ready, volume, setPlayerVolume]);

  // Load + position the current track whenever it changes (everyone).
  useEffect(() => {
    if (!ready) return;
    if (!currentId || !currentVideoId) {
      loadedRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- duration belongs to the loaded track; reset before the tick re-captures it
      setDurationMs(0);
      return;
    }
    if (loadedRef.current === currentId) return;
    loadedRef.current = currentId;
    setDurationMs(0);
    const r = roomRef.current;
    load(currentVideoId, targetSeconds(r));
    if (shouldPlay(r, unlocked, true)) play(); else pause();
  }, [ready, currentId, currentVideoId, unlocked, load, play, pause]);

  // Follow play/pause (everyone). playVideo() on a playing player is a no-op, so re-runs are harmless.
  useEffect(() => {
    if (!ready || !currentId) return;
    if (shouldPlay({ is_playing: playing }, unlocked, true)) play(); else pause();
  }, [ready, playing, unlocked, currentId, play, pause]);

  // Follow seeks / pause-resume (everyone): a changed clock origin means "jump to the room position".
  useEffect(() => {
    if (!ready || !currentId || loadedRef.current !== currentId) return;
    seekTo(targetSeconds(roomRef.current));
  }, [ready, currentId, startedAt, pausedElapsed, seekTo]);

  // Tick (everyone): capture the duration once known; every 5 s correct drift against the room clock.
  useEffect(() => {
    if (!ready || !currentId) return;
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      const d = getDuration();
      if (d > 0) setDurationMs((prev) => (prev === d * 1000 ? prev : d * 1000));
      const r = roomRef.current;
      if (n % DRIFT_EVERY_TICKS === 0 && r.is_playing && unlocked && needsResync(getCurrentTime(), r)) {
        seekTo(targetSeconds(r));
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [ready, currentId, unlocked, getDuration, getCurrentTime, seekTo]);

  // DJ only — auto-advance: nothing playing and (queue has items OR auto_replay_history) -> start the next track.
  useEffect(() => {
    if (!isDj || !ready) return;
    if (!room.current_item_id && !room.is_playing) {
      if (queueLen > 0) {
        advance();
      } else if (room.auto_replay_history && !replayAttemptedRef.current) {
        replayAttemptedRef.current = true;
        advance();
      }
    }
  }, [isDj, ready, room.current_item_id, room.is_playing, queueLen, room.auto_replay_history, advance]);

  /** Autoplay gate: must run inside a click handler so the browser honours play(). */
  const unlock = useCallback(() => {
    setUnlocked(true);
    const r = roomRef.current;
    if (r.is_playing && currentId) { seekTo(targetSeconds(r)); play(); }
  }, [currentId, seekTo, play]);

  const togglePlay = useCallback(() => {
    if (!isDj) return;
    if (!room.current_item_id && room.auto_replay_history) {
      advance();
      return;
    }
    const nowPlaying = !room.is_playing;
    if (nowPlaying) {
      // resume: started_at = now - paused_elapsed
      const startedAtIso = new Date(Date.now() - room.paused_elapsed_ms).toISOString();
      void setPlayback(roomId, token, { isPlaying: true, startedAt: startedAtIso, pausedElapsedMs: room.paused_elapsed_ms });
    } else {
      const elapsed = computeElapsedMs(room);
      void setPlayback(roomId, token, { isPlaying: false, startedAt: null, pausedElapsedMs: elapsed });
    }
  }, [isDj, room, roomId, token, advance]);

  const skip = useCallback(() => advance(), [advance]);

  const seekMs = useCallback((ms: number) => {
    if (!isDj) return;
    seekTo(ms / 1000);
    void seekPlayback(roomId, token, Math.floor(ms));
  }, [isDj, roomId, token, seekTo]);

  const setVolume = useCallback((v: number) => {
    setVol(v);
    localStorage.setItem(VOL_KEY, String(v));
    setPlayerVolume(v);
  }, [setPlayerVolume]);

  const playError = playErr && playErr.trackId === currentId ? playErr.message : null;

  return { durationMs, volume, unlocked, unlock, playError, togglePlay, skip, seekMs, setVolume };
}
