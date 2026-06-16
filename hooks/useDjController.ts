"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useYouTubePlayer } from "@/hooks/useYouTubePlayer";
import { computeElapsedMs } from "@/lib/identity";
import { advanceQueue, seekPlayback, setPlayback, type QueueItem, type Room } from "@/lib/supabase";

const VOL_KEY = "music-together:volume";

export interface DjController {
  durationMs: number;
  volume: number;
  togglePlay: () => void;
  skip: () => void;
  seekMs: (ms: number) => void;
  setVolume: (v: number) => void;
}

export function useDjController({ room, current, isDj, queueLen, roomId, token }: {
  room: Room; current: QueueItem | null; isDj: boolean; queueLen: number; roomId: string; token: string;
}): DjController {
  const [durationMs, setDurationMs] = useState(0);
  const [volume, setVol] = useState(100);
  const loadedRef = useRef<string | null>(null); // currently loaded video id

  // Single-flight guard: onEnded / auto-advance / skip must never advance twice
  // for one slot. Set before the RPC; released when a new current lands, the queue
  // empties, or the call errors.
  const advancingRef = useRef(false);
  const advance = useCallback(() => {
    if (!isDj || advancingRef.current) return;
    advancingRef.current = true;
    void advanceQueue(roomId, token).catch(() => { advancingRef.current = false; });
  }, [isDj, roomId, token]);
  useEffect(() => {
    if (room.current_item_id || queueLen === 0) advancingRef.current = false;
  }, [room.current_item_id, queueLen]);

  // onEnded -> advance (DJ only). useYouTubePlayer keeps the latest callback.
  const yt = useYouTubePlayer(() => advance());

  // Restore saved volume once.
  useEffect(() => {
    const v = Number(localStorage.getItem(VOL_KEY));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!Number.isNaN(v) && v > 0) setVol(v);
  }, []);
  // Apply volume to the player whenever it changes / becomes ready.
  useEffect(() => { if (isDj && yt.ready) yt.setVolume(volume); }, [isDj, yt.ready, volume, yt]);

  // Load + sync the current track for the DJ whenever it changes.
  useEffect(() => {
    if (!isDj || !yt.ready) return;
    if (!current) { loadedRef.current = null; return; }

    if (loadedRef.current !== current.id) {
      loadedRef.current = current.id;
      const startSec = Math.max(0, Math.floor(computeElapsedMs(room) / 1000));
      yt.load(current.youtube_video_id, startSec);
      if (room.is_playing) yt.play(); else yt.pause();
      // capture duration shortly after load
      const t = setTimeout(() => setDurationMs(yt.getDuration() * 1000), 1200);
      return () => clearTimeout(t);
    }
  }, [isDj, yt.ready, current?.id, current?.youtube_video_id, room.is_playing, room, yt]);

  // Reflect play/pause state changes (e.g. another admin reassigned, or remote toggle).
  useEffect(() => {
    if (!isDj || !yt.ready || !current) return;
    if (room.is_playing) yt.play(); else yt.pause();
  }, [isDj, yt.ready, room.is_playing, current, yt]);

  // Auto-advance: DJ ready, nothing playing, and the queue has items -> start next.
  // Depends on queueLen so adding the first song to an idle room kicks playback off.
  useEffect(() => {
    if (!isDj || !yt.ready) return;
    if (!room.current_item_id && !room.is_playing && queueLen > 0) advance();
  }, [isDj, yt.ready, room.current_item_id, room.is_playing, queueLen, advance]);

  const togglePlay = useCallback(() => {
    if (!isDj) return;
    const nowPlaying = !room.is_playing;
    if (nowPlaying) {
      // resume: started_at = now - paused_elapsed
      const startedAt = new Date(Date.now() - room.paused_elapsed_ms).toISOString();
      void setPlayback(roomId, token, { isPlaying: true, startedAt, pausedElapsedMs: room.paused_elapsed_ms });
    } else {
      const elapsed = computeElapsedMs(room);
      void setPlayback(roomId, token, { isPlaying: false, startedAt: null, pausedElapsedMs: elapsed });
    }
  }, [isDj, room, roomId, token]);

  const skip = useCallback(() => advance(), [advance]);

  const seekMs = useCallback((ms: number) => {
    if (!isDj) return;
    yt.seekTo(ms / 1000);
    void seekPlayback(roomId, token, Math.floor(ms));
  }, [isDj, roomId, token, yt]);

  const setVolume = useCallback((v: number) => {
    setVol(v);
    localStorage.setItem(VOL_KEY, String(v));
    if (isDj) yt.setVolume(v);
  }, [isDj, yt]);

  return { durationMs, volume, togglePlay, skip, seekMs, setVolume };
}
