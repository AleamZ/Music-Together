"use client";

import { useEffect, useState } from "react";
import type { PlaybackController } from "@/hooks/usePlayback";
import { formatClock } from "@/lib/format";
import { computeElapsedMs } from "@/lib/identity";
import type { QueueItem, Room } from "@/lib/supabase";

/** Top-right parchment card: what is playing, DJ transport (DJ only), volume, audio unlock, panel buttons. */
export default function HudNowPlaying({ room, current, djName, canControl, playback, canOpenSettings, onOpenQueue, onOpenBoard, onOpenSettings }: {
  room: Room;
  current: QueueItem | null;
  djName: string | null;
  canControl: boolean;
  playback: PlaybackController;
  canOpenSettings: boolean;
  onOpenQueue: () => void;
  onOpenBoard: () => void;
  onOpenSettings: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const { is_playing, started_at, paused_elapsed_ms } = room;
  useEffect(() => {
    const tick = () => setElapsed(computeElapsedMs({ is_playing, started_at, paused_elapsed_ms }));
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 500);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [is_playing, started_at, paused_elapsed_ms]);

  const dur = playback.durationMs || (current?.duration_seconds ? current.duration_seconds * 1000 : 0);
  const shown = dur ? Math.min(elapsed, dur) : elapsed;

  return (
    <div className="pch pointer-events-auto flex w-72 max-w-[calc(100vw-1rem)] flex-col gap-1.5 p-2 font-vt text-lg leading-none">
      <p className="truncate text-xl" title={current?.title ?? undefined}>🎵 {current?.title ?? "Chưa có bài nào"}</p>
      <p className="truncate text-base opacity-80">🎧 {djName ? `DJ: ${djName}` : "Chưa có DJ"}</p>
      <div className="flex items-center gap-2 text-base">
        <span className="w-10 text-right tabular-nums">{formatClock(shown)}</span>
        {canControl ? (
          <input
            type="range"
            min={0}
            max={dur || 0}
            value={shown}
            disabled={!current || !dur}
            onChange={(e) => playback.seekMs(Number(e.target.value))}
            className="flex-1 accent-burgundy"
            aria-label="Tua bài"
          />
        ) : (
          <div className="h-1.5 flex-1 overflow-hidden rounded-sm bg-parchment-300">
            <div className="h-full bg-burgundy" style={{ width: `${dur ? (shown / dur) * 100 : 0}%` }} />
          </div>
        )}
        <span className="w-10 tabular-nums">{dur ? formatClock(dur) : "--:--"}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {canControl && (
          <>
            <button type="button" className="pch-btn" onClick={playback.togglePlay} disabled={!current} aria-label={room.is_playing ? "Tạm dừng" : "Phát"}>
              {room.is_playing ? "⏸" : "▶"}
            </button>
            <button type="button" className="pch-btn" onClick={playback.skip} disabled={!current} aria-label="Bài tiếp">
              ⏭
            </button>
          </>
        )}
        <span aria-hidden="true">🔊</span>
        <input
          type="range"
          min={0}
          max={100}
          value={playback.volume}
          onChange={(e) => playback.setVolume(Number(e.target.value))}
          className="min-w-0 flex-1 accent-burgundy"
          aria-label="Âm lượng"
        />
      </div>
      {!playback.unlocked && (
        <button type="button" className="pch-btn pch-btn-primary" onClick={playback.unlock}>
          🔈 Bật âm thanh
        </button>
      )}
      {playback.playError && <p className="text-base text-burgundy-accent">{playback.playError}</p>}
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className="pch-btn" onClick={onOpenQueue}>📜 Hàng đợi</button>
        <button type="button" className="pch-btn" onClick={onOpenBoard}>🏆 Bảng tin</button>
        {canOpenSettings && (
          <button type="button" className="pch-btn" onClick={onOpenSettings} aria-label="Cài đặt phòng">⚙️</button>
        )}
      </div>
    </div>
  );
}
