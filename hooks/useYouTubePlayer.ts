"use client";

import { useCallback, useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    YT?: typeof YT;
    onYouTubeIframeAPIReady?: () => void;
  }
}

declare namespace YT {
  export enum PlayerState { UNSTARTED = -1, ENDED = 0, PLAYING = 1, PAUSED = 2, BUFFERING = 3, CUED = 5 }
  export interface PlayerEvent { target: Player; }
  export interface OnStateChangeEvent extends PlayerEvent { data: PlayerState; }
  export interface PlayerOptions {
    height?: string | number; width?: string | number; videoId?: string;
    playerVars?: Record<string, string | number>;
    events?: {
      onReady?: (e: PlayerEvent) => void;
      onStateChange?: (e: OnStateChangeEvent) => void;
      onError?: (e: { data: number }) => void;
    };
  }
  export class Player {
    constructor(el: HTMLElement | string, opts: PlayerOptions);
    loadVideoById(id: string, startSeconds?: number): void;
    cueVideoById(id: string, startSeconds?: number): void;
    playVideo(): void;
    pauseVideo(): void;
    seekTo(seconds: number, allowSeekAhead?: boolean): void;
    setVolume(volume: number): void;
    getVolume(): number;
    getDuration(): number;
    getCurrentTime(): number;
    getPlayerState(): PlayerState;
    destroy(): void;
  }
}

let apiPromise: Promise<typeof YT> | null = null;

function loadYouTubeApi(): Promise<typeof YT> {
  if (typeof window === "undefined") return Promise.reject(new Error("YT API requires a browser"));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<typeof YT>((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT as typeof YT); };
    if (!document.querySelector("script[data-yt-iframe-api]")) {
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.async = true;
      s.dataset.ytIframeApi = "true";
      document.head.appendChild(s);
    }
  });
  return apiPromise;
}

export interface UseYouTubePlayer {
  ready: boolean;
  load: (videoId: string, startSeconds?: number) => void;
  play: () => void;
  pause: () => void;
  seekTo: (sec: number) => void;
  setVolume: (v: number) => void;
  getDuration: () => number;
  getCurrentTime: () => number;
  onError?: (handler: (code: number) => void) => void;
}

export function useYouTubePlayer(onEnded?: () => void, onError?: (code: number) => void): UseYouTubePlayer {
  const playerRef = useRef<YT.Player | null>(null);
  const [ready, setReady] = useState(false);
  const queueRef = useRef<Array<(p: YT.Player) => void>>([]);
  const onEndedRef = useRef(onEnded); onEndedRef.current = onEnded;
  const onErrorRef = useRef(onError); onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    const host = document.createElement("div");
    host.style.cssText = "position:absolute;width:1px;height:1px;left:-9999px;top:0;opacity:0;pointer-events:none;";
    document.body.appendChild(host);

    loadYouTubeApi().then((YTApi) => {
      if (cancelled) return;
      playerRef.current = new YTApi.Player(host, {
        width: 1, height: 1,
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, playsinline: 1, origin: window.location.origin },
        events: {
          onReady: (e) => {
            if (cancelled) { e.target.destroy(); return; }
            setReady(true);
            const q = queueRef.current; queueRef.current = [];
            q.forEach((fn) => fn(e.target));
          },
          onStateChange: (e) => { if (e.data === YTApi.PlayerState.ENDED) onEndedRef.current?.(); },
          onError: (e) => onErrorRef.current?.(e.data),
        },
      });
    }).catch(() => { /* API failed: player stays null */ });

    return () => {
      cancelled = true;
      try { playerRef.current?.destroy(); } catch { /* ignore */ }
      playerRef.current = null;
      host.remove();
    };
  }, []);

  const run = useCallback((fn: (p: YT.Player) => void) => {
    const p = playerRef.current;
    if (p && ready) fn(p); else queueRef.current.push(fn);
  }, [ready]);

  const load = useCallback((videoId: string, startSeconds = 0) => run((p) => p.loadVideoById(videoId, startSeconds)), [run]);
  const play = useCallback(() => run((p) => p.playVideo()), [run]);
  const pause = useCallback(() => run((p) => p.pauseVideo()), [run]);
  const seekTo = useCallback((sec: number) => run((p) => p.seekTo(sec, true)), [run]);
  const setVolume = useCallback((v: number) => run((p) => p.setVolume(Math.max(0, Math.min(100, v)))), [run]);
  const getDuration = useCallback(() => (playerRef.current && ready ? playerRef.current.getDuration() : 0), [ready]);
  const getCurrentTime = useCallback(() => (playerRef.current && ready ? playerRef.current.getCurrentTime() : 0), [ready]);

  return { ready, load, play, pause, seekTo, setVolume, getDuration, getCurrentTime };
}
