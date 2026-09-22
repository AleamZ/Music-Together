"use client";

import { useEffect, useState } from "react";
import Turntable from "./Turntable";
import { computeElapsedMs } from "@/lib/identity";
import { formatClock } from "@/lib/format";
import type { Room, QueueItem } from "@/lib/supabase";
import { DragonCorners } from "./DragonDecorations";
import { useTheme } from "@/hooks/useTheme";

export interface NowPlayingProps {
  room: Room;
  current: QueueItem | null;
  canControl: boolean;          // DJ
  durationMs: number;           // from the player when DJ, else from current.duration_seconds*1000, else 0
  volume: number;               // 0..100 (local device — everyone)
  onPlayPause: () => void;
  onSkip: () => void;
  onSeekMs: (ms: number) => void;
  onVolume: (v: number) => void;
  djOnline: boolean;
  unlocked: boolean;            // autoplay gate passed on this device
  onUnlock: () => void;         // 🔈 button
  playError: string | null;     // this device could not play the current track
  children?: React.ReactNode;
}

export default function NowPlaying(p: NowPlayingProps) {
  const { room, current } = p;
  const { theme } = useTheme();
  const [elapsed, setElapsed] = useState(0);

  // Tick the local clock every 500ms; value derived purely from room fields.
  useEffect(() => {
    const tick = () => setElapsed(computeElapsedMs(room));
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [room.is_playing, room.started_at, room.paused_elapsed_ms]);

  const dur = p.durationMs || (current?.duration_seconds ? current.duration_seconds * 1000 : 0);

  if (theme === "dragon") {
    return (
      <section className="relative rounded-2xl border border-amber-400/40 bg-[#0c0b0f]/85 p-3 sm:p-4 shadow-[0_12px_32px_rgba(0,0,0,0.85)] backdrop-blur-xl">
        <DragonCorners size={64} />
        <div className="flex flex-col md:flex-row items-center md:items-stretch gap-4 sm:gap-6 w-full">
          {/* Left Column: Character Centerpiece */}
          <div className="shrink-0 flex items-center justify-center">
            <Turntable spinning={room.is_playing && !!current} thumbnail={current?.thumbnail_url} />
          </div>

          {/* Right Column: Music Info, Controls, Progress, Reactions */}
          <div className="flex-1 min-w-0 flex flex-col justify-between gap-3 text-left w-full py-0.5">
            {/* 1. Track Info */}
            {current ? (
              <div className="flex items-center gap-3">
                {current.thumbnail_url && (
                  <div className="relative h-13 w-13 sm:h-14 sm:w-14 shrink-0 overflow-hidden rounded-xl border border-amber-400/40 shadow-lg bg-black/50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={current.thumbnail_url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                    {room.is_playing && (
                      <div className="absolute inset-0 bg-amber-400/15 animate-pulse" />
                    )}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h2
                    className="truncate font-playfair text-base sm:text-lg font-bold text-amber-200 tracking-wide"
                    title={current.title || current.youtube_video_id}
                  >
                    {current.title || current.youtube_video_id}
                  </h2>
                  <p className="text-[11px] text-amber-400/70 truncate mt-0.5">
                    do <b className="text-amber-300 font-semibold">{current.added_by_name}</b> đóng góp
                  </p>
                </div>
              </div>
            ) : (
              <div className="py-2">
                <h2 className="font-playfair text-base text-amber-300/80">
                  {!p.djOnline ? "DJ đang offline — chờ DJ" : "Hàng đợi trống"}
                </h2>
                <p className="text-[11px] text-amber-400/50 mt-0.5">Thêm bài hát ở cột bên phải để giai nhân tấu khúc</p>
              </div>
            )}

            {/* 2. Timeline / Progress */}
            <div className="flex w-full items-center gap-2 text-xs text-amber-200/80">
              <span className="font-mono text-[11px] w-9 text-right text-amber-300/80">{formatClock(elapsed)}</span>
              <input
                type="range"
                min={0}
                max={dur || 0}
                value={Math.min(elapsed, dur || 0)}
                disabled={!p.canControl || dur === 0}
                onChange={(e) => p.onSeekMs(Number(e.target.value))}
                className="h-1.5 flex-1 accent-amber-400 cursor-pointer"
                aria-label="seek"
              />
              <span className="font-mono text-[11px] w-9 text-amber-300/80">{formatClock(dur)}</span>
            </div>

            {/* 3. Controls Row */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                {p.canControl && (
                  <>
                    <button
                      onClick={p.onPlayPause}
                      className="h-10 w-10 sm:h-11 sm:w-11 rounded-full bg-gradient-to-r from-amber-600 via-amber-500 to-amber-600 border border-amber-300/80 text-black font-bold text-sm shadow-[0_4px_14px_rgba(212,175,55,0.4)] transition hover:scale-105 active:scale-95 flex items-center justify-center cursor-pointer"
                      title={room.is_playing ? "Tạm dừng" : "Phát nhạc"}
                    >
                      {room.is_playing ? "⏸" : "▶"}
                    </button>
                    <button
                      onClick={p.onSkip}
                      className="h-8.5 px-3 rounded-full border border-amber-400/50 bg-[#1e1a26] text-amber-200 text-xs shadow-md transition hover:bg-amber-950/50 hover:scale-105 active:scale-95 cursor-pointer flex items-center gap-1.5"
                      title="Bỏ qua bài này"
                    >
                      <span>Chuyển bài</span>
                      <span>⏭</span>
                    </button>
                  </>
                )}

                {!p.unlocked && (
                  <button
                    onClick={p.onUnlock}
                    className="rounded-full bg-gradient-to-r from-red-800 to-amber-700 border border-amber-400/60 px-3.5 py-1.5 text-xs text-amber-100 shadow-md animate-pulse cursor-pointer"
                  >
                    🔈 Bật âm thanh
                  </button>
                )}
              </div>

              {/* Volume Slider */}
              <div className="flex items-center gap-1.5 text-xs text-amber-200/80 bg-black/40 px-3 py-1 rounded-full border border-amber-400/20">
                <span>🔊</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={p.volume}
                  onChange={(e) => p.onVolume(Number(e.target.value))}
                  className="w-16 sm:w-20 accent-amber-400 cursor-pointer"
                  aria-label="volume"
                />
                <span className="text-[10px] w-6 text-right font-mono text-amber-400/70">{p.volume}%</span>
              </div>
            </div>

            {/* 4. Room Info */}
            <div className="flex items-center justify-between text-[11px] text-amber-400/60">
              <p className="truncate">
                {p.canControl ? "✦ Bạn là DJ — Có quyền điều khiển phát / tua" : "✦ Đang nghe cùng phòng · DJ điều khiển"}
              </p>
              {p.playError && <p className="text-red-400 text-xs">{p.playError}</p>}
            </div>

            {/* 5. Reactions Bar */}
            <div className="pt-2 border-t border-amber-400/15 flex items-center justify-start">
              {p.children}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="relative flex flex-col items-center gap-1.5 rounded-xl border border-gold-200 bg-cream/60 p-2 sm:p-2.5 pt-2.5 sm:pt-3 text-center shadow-xs">
      <DragonCorners size={64} />
      <Turntable spinning={room.is_playing && !!current} thumbnail={current?.thumbnail_url} />
      {current ? (
        <div className="max-w-[92%] flex items-center justify-center gap-2.5 sm:gap-3">
          <div className="text-center min-w-0">
            <h2 className="truncate font-cormorant text-lg font-bold text-burgundy sm:text-xl" title={current.title || current.youtube_video_id}>
              {current.title || current.youtube_video_id}
            </h2>
            <p className="text-[11px] italic text-ink/80 leading-tight">do <b className="text-burgundy">{current.added_by_name}</b> đóng góp</p>
          </div>
        </div>
      ) : (
        <h2 className="font-cormorant text-base text-burgundy sm:text-lg">{!p.djOnline ? "DJ đang offline — chờ DJ" : "Hàng đợi trống"}</h2>
      )}

      <div className="flex w-[88%] items-center gap-2 text-xs text-ink/80">
        <span>{formatClock(elapsed)}</span>
        <input type="range" min={0} max={dur || 0} value={Math.min(elapsed, dur || 0)} disabled={!p.canControl || dur === 0}
          onChange={(e) => p.onSeekMs(Number(e.target.value))}
          className="h-1.5 flex-1 accent-burgundy" aria-label="seek" />
        <span>{formatClock(dur)}</span>
      </div>

      {!p.unlocked && (
        <button onClick={p.onUnlock} className="rounded-full bg-burgundy px-4 py-1.5 text-xs text-cream shadow-xs">🔈 Bật âm thanh</button>
      )}

      <div className="flex items-center gap-3">
        {p.canControl && (
          <>
            <button onClick={p.onPlayPause} className="h-11 w-11 rounded-full bg-burgundy px-3 py-1 text-cream shadow-xs transition hover:scale-105 active:scale-95">
              {room.is_playing ? "⏸" : "▶"}
            </button>
            <button onClick={p.onSkip} className="rounded-full border border-gold bg-cream px-3 py-1.5 text-xs text-burgundy shadow-xs transition hover:scale-105 active:scale-95">⏭</button>
          </>
        )}
        <label className="flex items-center gap-1 text-xs text-ink/80">🔊
          <input type="range" min={0} max={100} value={p.volume}
            onChange={(e) => p.onVolume(Number(e.target.value))} className="w-16 sm:w-20 accent-burgundy" aria-label="volume" />
        </label>
      </div>
      <p className="text-[10px] sm:text-[11px] text-green-vintage">
        {p.canControl ? "Điều khiển phát / tua — chỉ DJ" : "Đang nghe cùng phòng · DJ điều khiển"}
      </p>
      {p.playError && <p className="text-[11px] text-burgundy-accent">{p.playError}</p>}
      {p.children}
    </section>
  );
}
