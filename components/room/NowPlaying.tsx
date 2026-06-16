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
  volume: number;               // 0..100 (DJ local)
  onPlayPause: () => void;
  onSkip: () => void;
  onSeekMs: (ms: number) => void;
  onVolume: (v: number) => void;
  djOnline: boolean;
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
  const pct = dur > 0 ? Math.min(100, (elapsed / dur) * 100) : 0;

  return (
    <section className="flex flex-col items-center gap-3 rounded-xl border border-gold-200 bg-cream/60 p-4 text-center">
      <Turntable spinning={room.is_playing && !!current} thumbnail={current?.thumbnail_url} />
      {current ? (
        <>
          <h2 className="font-cormorant text-2xl font-bold text-burgundy">{current.title || current.youtube_video_id}</h2>
          <p className="text-sm italic text-ink/80">do <b>{current.added_by_name}</b> đóng góp</p>
        </>
      ) : (
        <h2 className="font-cormorant text-xl text-burgundy">{!p.djOnline ? "DJ đang offline — chờ DJ" : "Hàng đợi trống"}</h2>
      )}

      <div className="flex w-[86%] items-center gap-2 text-xs text-ink/80">
        <span>{formatClock(elapsed)}</span>
        <input type="range" min={0} max={dur || 0} value={Math.min(elapsed, dur || 0)} disabled={!p.canControl || dur === 0}
          onChange={(e) => p.onSeekMs(Number(e.target.value))}
          className="h-2 flex-1 accent-burgundy" aria-label="seek" />
        <span>{formatClock(dur)}</span>
      </div>

      {p.canControl && (
        <>
          <div className="flex items-center gap-3">
            <button onClick={p.onPlayPause} className="h-13 w-13 rounded-full bg-burgundy px-4 py-2 text-cream">
              {room.is_playing ? "⏸" : "▶"}
            </button>
            <button onClick={p.onSkip} className="rounded-full border border-gold bg-cream px-4 py-2 text-burgundy">⏭</button>
            <label className="ml-2 flex items-center gap-1 text-xs text-ink/80">🔊
              <input type="range" min={0} max={100} value={p.volume}
                onChange={(e) => p.onVolume(Number(e.target.value))} className="w-20 accent-burgundy" />
            </label>
          </div>
          <p className="text-[11px] text-green-vintage">Điều khiển phát / tua / âm lượng — chỉ DJ</p>
        </>
      )}
    </section>
  );
}
