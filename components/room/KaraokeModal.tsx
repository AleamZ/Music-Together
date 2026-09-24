"use client";

import { useEffect } from "react";
import type { LyricLine } from "@/lib/lyrics/parse-lrc";
import KaraokeView from "./KaraokeView";
import { formatClock } from "@/lib/format";
import type { QueueItem } from "@/lib/supabase";

export interface KaraokeModalProps {
  isOpen: boolean;
  onClose: () => void;
  lines: LyricLine[];
  activeLineIndex: number;
  loading: boolean;
  error: string | null;
  hasSynced: boolean;
  canSeek?: boolean;
  onSeekMs?: (ms: number) => void;
  onSearchManual?: (query: string) => void;
  onOpenSearchModal?: () => void;
  current: QueueItem | null;
  elapsedMs: number;
  durationMs: number;
  isPlaying: boolean;
  onPlayPause?: () => void;
  onSkip?: () => void;
  volume: number;
  onVolume: (v: number) => void;
}

export default function KaraokeModal({
  isOpen,
  onClose,
  lines,
  activeLineIndex,
  loading,
  error,
  hasSynced,
  canSeek,
  onSeekMs,
  onSearchManual,
  onOpenSearchModal,
  current,
  elapsedMs,
  durationMs,
  isPlaying,
  onPlayPause,
  onSkip,
  volume,
  onVolume,
}: KaraokeModalProps) {
  // ESC to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95 backdrop-blur-2xl text-white select-none animate-in fade-in duration-200">
      {/* Ambient Album Art Glow Background */}
      {current?.thumbnail_url && (
        <div
          className="absolute inset-0 pointer-events-none opacity-25 filter blur-3xl scale-125 bg-center bg-cover transition-all duration-1000"
          style={{ backgroundImage: `url(${current.thumbnail_url})` }}
        />
      )}

      {/* Top Bar: Song Title, Artist, Close */}
      <div className="relative z-10 flex items-center justify-between px-4 sm:px-8 py-4 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {current?.thumbnail_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={current.thumbnail_url}
              alt=""
              className="w-11 h-11 sm:w-13 sm:h-13 rounded-lg object-cover shadow-lg border border-white/20 shrink-0"
            />
          )}
          <div className="min-w-0">
            <h2 className="text-base sm:text-xl font-black truncate text-white tracking-wide">
              {current?.title || "Đang chờ bài hát..."}
            </h2>
            <p className="text-xs sm:text-sm text-white/60 truncate">
              {current?.added_by_name ? `Yêu cầu bởi ${current.added_by_name}` : "Sân khấu Karaoke"}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="h-10 w-10 rounded-full border border-white/20 bg-white/10 hover:bg-white/20 flex items-center justify-center text-lg text-white font-bold transition-all cursor-pointer shrink-0"
          title="Đóng sân khấu (ESC)"
        >
          ✕
        </button>
      </div>

      {/* Center Karaoke Stage */}
      <div className="relative z-10 flex-1 min-h-0 flex items-center justify-center max-w-4xl mx-auto w-full px-2 sm:px-6">
        <KaraokeView
          lines={lines}
          activeLineIndex={activeLineIndex}
          loading={loading}
          error={error}
          hasSynced={hasSynced}
          canSeek={canSeek}
          onSeekMs={onSeekMs}
          onSearchManual={onSearchManual}
          onOpenSearchModal={onOpenSearchModal}
          fullscreen={true}
          onCloseFullscreen={onClose}
          elapsedMs={elapsedMs}
          isPlaying={isPlaying}
        />
      </div>

      {/* Bottom Transport Controls Bar */}
      <div className="relative z-10 shrink-0 px-4 sm:px-8 py-3 bg-black/60 border-t border-white/10 backdrop-blur-md">
        {/* Timeline Seekbar */}
        <div className="flex items-center gap-3 text-xs mb-2">
          <span className="font-mono text-[11px] w-9 text-right text-white/70">
            {formatClock(elapsedMs)}
          </span>
          <input
            type="range"
            min={0}
            max={durationMs || 0}
            value={Math.min(elapsedMs, durationMs || 0)}
            disabled={!canSeek || !durationMs}
            onChange={(e) => onSeekMs?.(Number(e.target.value))}
            className="flex-1 accent-gold cursor-pointer disabled:cursor-not-allowed h-1.5 rounded-lg bg-white/20"
            aria-label="seek"
          />
          <span className="font-mono text-[11px] w-9 text-white/50">
            {formatClock(durationMs)}
          </span>
        </div>

        {/* Transport & Volume */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {canSeek && (
              <>
                <button
                  type="button"
                  onClick={onPlayPause}
                  className="h-9 w-9 rounded-full bg-white text-black font-bold flex items-center justify-center shadow-lg transition hover:scale-105 active:scale-95 cursor-pointer"
                  title={isPlaying ? "Tạm dừng" : "Phát tiếp"}
                >
                  {isPlaying ? "⏸" : "▶"}
                </button>
                <button
                  type="button"
                  onClick={onSkip}
                  className="px-3 py-1.5 rounded-lg border border-white/20 bg-white/10 text-white font-mono text-xs hover:bg-white/20 transition active:scale-95 cursor-pointer flex items-center gap-1"
                  title="Chuyển bài"
                >
                  <span>Chuyển bài</span>
                  <span>⏭</span>
                </button>
              </>
            )}
          </div>

          {/* Volume */}
          <div className="flex items-center gap-2 text-xs font-mono bg-white/10 px-3 py-1.5 rounded-full border border-white/15">
            <span>🔊</span>
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => onVolume(Number(e.target.value))}
              className="w-16 sm:w-24 accent-gold cursor-pointer"
              aria-label="volume"
            />
            <span className="text-[10px] w-7 text-right">{volume}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
