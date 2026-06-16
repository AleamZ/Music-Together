"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useYouTubePlayer } from "@/hooks/useYouTubePlayer";
import { computeElapsedMs, type Identity } from "@/lib/identity";
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

export function useDjController({ room, current, identity, isDj }: {
  room: Room; current: QueueItem | null; identity: Identity; isDj: boolean;
}): DjController {
  const [durationMs, setDurationMs] = useState(0);
  const [volume, setVol] = useState(100);
  const loadedRef = useRef<string | null>(null); // currently loaded video id

  // onEnded -> advance (DJ only). useYouTubePlayer keeps the latest callback.
  const yt = useYouTubePlayer(
    () => { if (isDj) void advanceQueue(identity).catch(() => {}); },
  );

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

  // Auto-advance: DJ online, nothing playing, queue has items -> start next.
  useEffect(() => {
    if (!isDj || !yt.ready) return;
    if (!room.current_item_id && room.is_playing === false) {
      // only kick off if there is something to play
      void advanceQueue(identity).catch(() => {});
    }
  }, [isDj, yt.ready, room.current_item_id, room.is_playing, identity]);

  const togglePlay = useCallback(() => {
    if (!isDj) return;
    const nowPlaying = !room.is_playing;
    if (nowPlaying) {
      // resume: started_at = now - paused_elapsed
      const startedAt = new Date(Date.now() - room.paused_elapsed_ms).toISOString();
      void setPlayback(identity, { isPlaying: true, startedAt, pausedElapsedMs: room.paused_elapsed_ms });
    } else {
      const elapsed = computeElapsedMs(room);
      void setPlayback(identity, { isPlaying: false, startedAt: null, pausedElapsedMs: elapsed });
    }
  }, [isDj, room, identity]);

  const skip = useCallback(() => { if (isDj) void advanceQueue(identity); }, [isDj, identity]);

  const seekMs = useCallback((ms: number) => {
    if (!isDj) return;
    yt.seekTo(ms / 1000);
    void seekPlayback(identity, Math.floor(ms));
  }, [isDj, identity, yt]);

  const setVolume = useCallback((v: number) => {
    setVol(v);
    localStorage.setItem(VOL_KEY, String(v));
    if (isDj) yt.setVolume(v);
  }, [isDj, yt]);

  return { durationMs, volume, togglePlay, skip, seekMs, setVolume };
}
