"use client";

import { useEffect, useState } from "react";
import Turntable from "./Turntable";
import { computeElapsedMs } from "@/lib/identity";
import { formatClock } from "@/lib/format";
import type { Room, QueueItem } from "@/lib/supabase";

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
  const [elapsed, setElapsed] = useState(0);

  // Tick the local clock every 500ms; value derived purely from room fields.
  useEffect(() => {
    const tick = () => setElapsed(computeElapsedMs(room));
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [room.is_playing, room.started_at, room.paused_elapsed_ms]);

  const dur = p.durationMs || (current?.duration_seconds ? current.duration_seconds * 1000 : 0);

  return (
    <section className="flex flex-col items-center gap-2.5 rounded-xl border border-gold-200 bg-cream/60 p-3 sm:p-4 text-center shadow-xs">
      <Turntable spinning={room.is_playing && !!current} thumbnail={current?.thumbnail_url} />
      {current ? (
        <div className="max-w-[92%]">
          <h2 className="truncate font-cormorant text-xl font-bold text-burgundy sm:text-2xl" title={current.title || current.youtube_video_id}>
            {current.title || current.youtube_video_id}
          </h2>
          <p className="text-xs italic text-ink/80">do <b className="text-burgundy">{current.added_by_name}</b> đóng góp</p>
        </div>
      ) : (
        <h2 className="font-cormorant text-lg text-burgundy sm:text-xl">{!p.djOnline ? "DJ đang offline — chờ DJ" : "Hàng đợi trống"}</h2>
      )}

      <div className="flex w-[88%] items-center gap-2 text-xs text-ink/80">
        <span>{formatClock(elapsed)}</span>
        <input type="range" min={0} max={dur || 0} value={Math.min(elapsed, dur || 0)} disabled={!p.canControl || dur === 0}
          onChange={(e) => p.onSeekMs(Number(e.target.value))}
          className="h-2 flex-1 accent-burgundy" aria-label="seek" />
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
