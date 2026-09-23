"use client";

import { useEffect, useState } from "react";
import Turntable from "./Turntable";
import { computeElapsedMs } from "@/lib/identity";
import { formatClock } from "@/lib/format";
import type { Room, QueueItem } from "@/lib/supabase";
import { DragonCorners } from "./DragonDecorations";
import { CyberpunkCorners } from "./CyberpunkDecorations";
import { MikuNekomimiEars } from "./MikuDecorations";
import { useTheme } from "@/hooks/useTheme";

const MIKU_EQ_BARS = [
  { delay: "0.1s", dur: "0.65s" },
  { delay: "0.3s", dur: "0.85s" },
  { delay: "0.0s", dur: "0.6s" },
  { delay: "0.4s", dur: "0.9s" },
  { delay: "0.2s", dur: "0.7s" },
  { delay: "0.5s", dur: "0.8s" },
  { delay: "0.15s", dur: "0.6s" },
  { delay: "0.35s", dur: "0.75s" },
  { delay: "0.25s", dur: "0.95s" },
  { delay: "0.05s", dur: "0.7s" },
  { delay: "0.45s", dur: "0.85s" },
  { delay: "0.2s", dur: "0.65s" },
  { delay: "0.1s", dur: "0.8s" },
  { delay: "0.4s", dur: "0.7s" },
  { delay: "0.3s", dur: "0.9s" },
  { delay: "0.15s", dur: "0.6s" },
];

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

  const [lastVolume, setLastVolume] = useState(p.volume > 0 ? p.volume : 100);

  const handleVolumeChange = (v: number) => {
    if (v > 0) setLastVolume(v);
    p.onVolume(v);
  };

  const toggleAudio = () => {
    if (!p.unlocked) {
      p.onUnlock();
      if (p.volume === 0) {
        p.onVolume(lastVolume || 100);
      }
    } else {
      if (p.volume > 0) {
        setLastVolume(p.volume);
        p.onVolume(0);
      } else {
        p.onVolume(lastVolume || 100);
      }
    }
  };

  if (theme === "miku") {
    return (
      <section className="relative rounded-2xl border-2 border-[#00f0ff]/50 bg-[#07111e]/90 p-3.5 sm:p-5 shadow-[0_8px_32px_rgba(0,0,0,0.8),0_0_20px_rgba(0,240,255,0.25)] backdrop-blur-xl mt-4 sm:mt-5">
        {/* Nekomimi Cat Ears atop player */}
        <MikuNekomimiEars />

        {/* Cyber Deck Header Bar */}
        <div className="flex items-center justify-between border-b border-[#00f0ff]/30 pb-2.5 mb-3.5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] font-black tracking-widest px-2.5 py-0.5 rounded-full bg-gradient-to-r from-[#00f0ff] to-[#39c5bb] text-[#050d18] shadow-[0_0_10px_rgba(0,240,255,0.8)]">
              #01 MIKU DECK
            </span>
            <span className="font-mono text-[10px] text-[#ff007f] font-extrabold tracking-wider hidden sm:inline drop-shadow-[0_0_6px_rgba(255,0,127,0.8)]">
              VOCALOID • SYNTH ENGINE
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span
                className={`absolute inline-flex h-full w-full rounded-full ${
                  room.is_playing ? "bg-[#00f0ff] animate-ping opacity-75" : "bg-zinc-500"
                }`}
              />
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${
                  room.is_playing ? "bg-[#00f0ff] shadow-[0_0_6px_#00f0ff]" : "bg-zinc-600"
                }`}
              />
            </span>
            <span className="font-mono text-[10px] text-[#a5f3fc] font-bold uppercase tracking-wider">
              {room.is_playing ? "ON STAGE" : "STANDBY"}
            </span>
          </div>
        </div>

        <div className="flex flex-col md:flex-row items-center md:items-stretch gap-4 sm:gap-6 w-full">
          {/* Left Column: Centerpiece Holographic Turntable */}
          <div className="shrink-0 flex items-center justify-center relative">
            <Turntable
              spinning={room.is_playing && !!current}
              thumbnail={current?.thumbnail_url}
              title={current?.title || current?.youtube_video_id}
              uploader={current?.added_by_name}
            />
          </div>

          {/* Right Column: Song Info, Equalizer, Seekbar, Controls */}
          <div className="flex-1 min-w-0 flex flex-col justify-between gap-3 text-left w-full py-0.5">
            {/* 1. Track Info */}
            {current ? (
              <div className="min-w-0 w-full">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#00f0ff]/20 border border-[#00f0ff]/50 text-[#00f0ff] tracking-wider uppercase">
                    初音ミク LIVE
                  </span>
                  <span className="font-mono text-[9px] text-[#ff77b9] font-bold">
                    MAGICAL MIRAI
                  </span>
                </div>
                <h2
                  className="truncate font-sans text-base sm:text-xl font-black text-white tracking-wide"
                  style={{ textShadow: "0 0 12px rgba(0,240,255,0.7)" }}
                  title={current.title || current.youtube_video_id}
                >
                  {current.title || current.youtube_video_id}
                </h2>
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  <span className="font-mono text-[9px] sm:text-[10px] uppercase px-2 py-0.5 rounded bg-[#ff007f] border border-[#ff3399] text-white font-extrabold tracking-wider shrink-0 shadow-[0_0_8px_rgba(255,0,127,0.6)]">
                    YÊU CẦU BỞI
                  </span>
                  <span className="font-mono text-xs sm:text-sm text-[#00f0ff] font-bold drop-shadow-[0_0_6px_rgba(0,240,255,0.7)] flex items-center gap-1">
                    <span>{current.added_by_name}</span>
                    {current.is_replay && (
                      <span className="text-[9px] px-1 py-0.2 rounded bg-[#00f0ff]/20 text-[#00f0ff] border border-[#00f0ff]/40">🔁 REPLAY</span>
                    )}
                  </span>
                  <span className="text-white/40">•</span>
                  <span className="font-mono text-xs text-[#a5f3fc]/80">
                    {dur ? formatClock(dur) : "--:--"}
                  </span>
                </div>
              </div>
            ) : (
              <div className="min-w-0 w-full py-2">
                <h2 className="font-mono text-sm sm:text-base font-bold text-[#00f0ff] tracking-wider drop-shadow-[0_0_8px_rgba(0,240,255,0.6)]">
                  [ SÂN KHẤU ĐANG CHỜ BÀI HÁT ]
                </h2>
                <p className="text-xs text-[#a5f3fc]/70 mt-1">
                  Hãy thêm bài hát từ YouTube để Miku biểu diễn trên sân khấu ảo!
                </p>
              </div>
            )}

            {/* 2. 16-Band Bouncy Equalizer Visualizer */}
            <div className="w-full bg-[#050c16]/90 p-2 sm:p-2.5 rounded-xl border border-[#00f0ff]/30 shadow-inner">
              <div className="flex items-center justify-between mb-1.5 px-1 font-mono text-[9px] text-[#00f0ff]/80">
                <span className="font-bold flex items-center gap-1">
                  <span className="text-[#ff007f]">▲</span> SPECTRUM ANALYZER (16-BAND)
                </span>
                <span className="text-[#39c5bb] tracking-wider">
                  {room.is_playing ? "44.1 kHz • STEREO" : "PAUSED"}
                </span>
              </div>
              <div className="flex items-end justify-between gap-1 sm:gap-1.5 h-10 sm:h-12 px-1">
                {MIKU_EQ_BARS.map((bar, idx) => (
                  <div
                    key={idx}
                    className="flex-1 rounded-t-sm transition-all"
                    style={{
                      height: room.is_playing && current ? undefined : "12%",
                      animation:
                        room.is_playing && current
                          ? `miku-eq-bounce ${bar.dur} ease-in-out infinite alternate ${bar.delay}`
                          : "none",
                      background: "linear-gradient(180deg, #ff007f 0%, #00f0ff 100%)",
                      boxShadow:
                        room.is_playing && current ? "0 0 8px rgba(0, 240, 255, 0.6)" : "none",
                    }}
                  />
                ))}
              </div>
            </div>

            {/* 3. Holographic Timeline / Seekbar */}
            <div className="flex items-center gap-2 text-xs">
              <span className="font-mono text-[11px] w-9 text-right text-[#00f0ff] font-bold drop-shadow-[0_0_6px_rgba(0,240,255,0.7)]">
                {formatClock(elapsed)}
              </span>
              <input
                type="range"
                min={0}
                max={dur || 0}
                value={Math.min(elapsed, dur || 0)}
                disabled={!p.canControl || !dur}
                onChange={(e) => p.onSeekMs(Number(e.target.value))}
                className="flex-1 accent-[#00f0ff] cursor-pointer disabled:cursor-not-allowed h-1.5 rounded-lg bg-[#0b1928]"
                aria-label="seek"
              />
              <span className="font-mono text-[11px] w-9 text-[#ff77b9] font-bold">
                {formatClock(dur)}
              </span>
            </div>

            {/* 4. Controls Row */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                {p.canControl && (
                  <>
                    <button
                      onClick={p.onPlayPause}
                      className="h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-gradient-to-r from-[#00f0ff] to-[#39c5bb] border border-[#a5f3fc] text-[#050e18] font-black text-sm shadow-[0_0_18px_rgba(0,240,255,0.85)] transition hover:scale-105 active:scale-95 flex items-center justify-center cursor-pointer"
                      title={room.is_playing ? "Tạm dừng" : "Phát sóng"}
                    >
                      {room.is_playing ? "⏸" : "▶"}
                    </button>
                    <button
                      onClick={p.onSkip}
                      className="h-8.5 px-3 rounded-lg border border-[#ff007f]/60 bg-[#1a0a18] text-[#ff77b9] font-mono text-xs shadow-[0_0_12px_rgba(255,0,127,0.35)] transition hover:bg-[#ff007f]/20 hover:scale-105 active:scale-95 cursor-pointer flex items-center gap-1.5"
                      title="Chuyển sang bài tiếp theo"
                    >
                      <span>NEXT BEAT</span>
                      <span>⏭</span>
                    </button>
                  </>
                )}

                {/* Audio On/Off Toggle Icon */}
                <button
                  onClick={toggleAudio}
                  className={`h-8.5 w-8.5 rounded-lg font-mono text-sm shadow-md transition hover:scale-105 active:scale-95 cursor-pointer flex items-center justify-center ${
                    !p.unlocked
                      ? "bg-gradient-to-r from-[#00f0ff] to-[#39c5bb] border border-[#a5f3fc] text-black shadow-[0_0_16px_#00f0ff] animate-pulse"
                      : p.volume === 0
                      ? "bg-[#180a14] border border-[#ff007f]/50 text-[#ff007f]"
                      : "bg-[#0b1626] border border-[#00f0ff]/50 text-[#00f0ff] hover:border-[#00f0ff] shadow-[0_0_10px_rgba(0,240,255,0.5)]"
                  }`}
                  title={
                    !p.unlocked
                      ? "Nhấn để bật âm thanh nghe trên thiết bị này"
                      : p.volume === 0
                      ? "Bật lại tiếng (Unmute)"
                      : "Tắt tiếng (Mute)"
                  }
                >
                  {!p.unlocked || p.volume === 0 ? "🔇" : "🔊"}
                </button>
              </div>

              {/* Volume Slider */}
              <div className="flex items-center gap-1.5 font-mono text-xs text-white bg-[#050c18]/90 px-3 py-1.5 rounded-lg border border-[#00f0ff]/40 shadow-[0_0_8px_rgba(0,240,255,0.2)]">
                <span className="text-[#00f0ff] font-bold text-[10px]">VOL</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={p.volume}
                  onChange={(e) => handleVolumeChange(Number(e.target.value))}
                  className="w-16 sm:w-20 accent-[#00f0ff] cursor-pointer"
                  aria-label="volume"
                />
                <span className="text-[10px] w-7 text-right font-mono text-[#00f0ff] font-bold">
                  {p.volume}%
                </span>
              </div>
            </div>

            {/* 5. Room Role Info */}
            <div className="flex items-center justify-between font-mono text-[10px] text-[#a5f3fc]/70">
              <p className="truncate">
                {p.canControl
                  ? "● BẠN LÀ DJ — TOÀN QUYỀN ĐIỀU PHỐI SÂN KHẤU MIKU 01"
                  : "● ĐANG KẾT NỐI SÂN KHẤU VOCALOID · DJ ĐIỀU PHỐI"}
              </p>
              {p.playError && <p className="text-red-400 font-bold">{p.playError}</p>}
            </div>

            {/* 6. Reactions Bar */}
            <div className="pt-2 border-t border-[#00f0ff]/25 flex items-center justify-start">
              {p.children}
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (theme === "itv") {
    return (
      <section className="relative rounded-xl border border-[#76cb00]/40 bg-[#080d16]/95 p-3 sm:p-4 shadow-xl backdrop-blur-xl">
        <div className="flex flex-col md:flex-row items-center md:items-stretch gap-4 sm:gap-6 w-full">
          {/* Left Column: Television Broadcast Centerpiece */}
          <div className="shrink-0 flex items-center justify-center">
            <Turntable
              spinning={room.is_playing && !!current}
              thumbnail={current?.thumbnail_url}
              title={current?.title || current?.youtube_video_id}
              uploader={current?.added_by_name}
            />
          </div>

          {/* Right Column: Song Info, Broadcast Controls, Timeline */}
          <div className="flex-1 min-w-0 flex flex-col justify-between gap-3 text-left w-full py-0.5">
            {/* 1. Track Info (Expanded & No duplicate thumbnail) */}
            {current ? (
              <div className="min-w-0 w-full">
                <h2
                  className="truncate font-sans text-base sm:text-xl font-black text-white tracking-wide"
                  style={{ textShadow: "0 0 10px rgba(118,203,0,0.6)" }}
                  title={current.title || current.youtube_video_id}
                >
                  {current.title || current.youtube_video_id}
                </h2>
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  <span className="font-mono text-[9px] sm:text-[10px] uppercase px-2 py-0.5 rounded bg-[#ff6600] border border-[#ff8800] text-white font-extrabold tracking-wider shrink-0 shadow-xs">
                    YÊU CẦU BỞI
                  </span>
                  <span className="font-mono text-xs sm:text-sm text-[#84e800] font-bold flex items-center gap-1">
                    <span>{current.added_by_name}</span>
                    {current.is_replay && (
                      <span className="text-[9px] px-1 py-0.2 rounded bg-[#84e800]/20 text-[#84e800] border border-[#84e800]/40">🔁 REPLAY</span>
                    )}
                  </span>
                  <span className="text-white/40">•</span>
                  <span className="font-mono text-xs text-[#ffcc00] font-bold">
                    MÃ BÀI HÁT: #{current.id ? String(current.id).slice(-4) : "8730"}
                  </span>
                </div>
              </div>
            ) : (
              <div className="py-2">
                <h2 className="font-sans text-base font-bold text-[#84e800] tracking-wide">
                  {!p.djOnline ? "● TRỰC TIẾP: DJ ĐANG OFFLINE — CHỜ TÍN HIỆU" : "● HÀNG ĐỢI RỖNG — SOẠN ITV GỬI 8730"}
                </h2>
                <p className="font-sans text-[11px] text-white/70 mt-0.5">
                  Thêm bài hát ở bảng bên phải để gửi lên phát sóng truyền hình iTV
                </p>
              </div>
            )}

            {/* 2. Timeline / Progress */}
            <div className="flex w-full items-center gap-2 text-xs text-white/80">
              <span className="font-mono text-[11px] w-9 text-right text-[#84e800] font-bold">
                {formatClock(elapsed)}
              </span>
              <input
                type="range"
                min={0}
                max={dur || 0}
                value={Math.min(elapsed, dur || 0)}
                disabled={!p.canControl || dur === 0}
                onChange={(e) => p.onSeekMs(Number(e.target.value))}
                className="h-1.5 flex-1 accent-[#76cb00] cursor-pointer"
                aria-label="seek"
              />
              <span className="font-mono text-[11px] w-9 text-[#ff9900] font-bold">
                {formatClock(dur)}
              </span>
            </div>

            {/* 3. Controls Row */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                {p.canControl && (
                  <>
                    <button
                      onClick={p.onPlayPause}
                      className="h-10 w-10 sm:h-11 sm:w-11 rounded-lg bg-gradient-to-r from-[#76cb00] to-[#84e800] border border-[#a3ff12] text-black font-extrabold text-sm shadow-[0_0_16px_rgba(118,203,0,0.7)] transition hover:scale-105 active:scale-95 flex items-center justify-center cursor-pointer"
                      title={room.is_playing ? "Tạm dừng" : "Phát sóng"}
                    >
                      {room.is_playing ? "⏸" : "▶"}
                    </button>
                    <button
                      onClick={p.onSkip}
                      className="h-8.5 px-3 rounded-lg border border-[#ff6600]/60 bg-[#1e1008] text-[#ff9900] font-mono text-xs shadow-[0_0_10px_rgba(255,102,0,0.3)] transition hover:bg-[#ff6600]/20 hover:scale-105 active:scale-95 cursor-pointer flex items-center gap-1.5"
                      title="Chuyển bài tiếp theo"
                    >
                      <span>CHUYỂN BÀI</span>
                      <span>⏭</span>
                    </button>
                  </>
                )}

                {/* Audio On/Off Toggle Icon */}
                <button
                  onClick={toggleAudio}
                  className={`h-8.5 w-8.5 rounded-lg font-mono text-sm shadow-md transition hover:scale-105 active:scale-95 cursor-pointer flex items-center justify-center ${
                    !p.unlocked
                      ? "bg-gradient-to-r from-[#76cb00] to-[#84e800] border border-[#a3ff12] text-black shadow-[0_0_14px_#84e800] animate-pulse"
                      : p.volume === 0
                      ? "bg-[#181005] border border-[#ff6600]/50 text-[#ff6600]"
                      : "bg-[#0b1624] border border-[#76cb00]/50 text-[#84e800] hover:border-[#84e800] shadow-[0_0_8px_rgba(118,203,0,0.4)]"
                  }`}
                  title={
                    !p.unlocked
                      ? "Nhấn để bật âm thanh nghe trên thiết bị này"
                      : p.volume === 0
                      ? "Bật lại tiếng (Unmute)"
                      : "Tắt tiếng (Mute)"
                  }
                >
                  {!p.unlocked || p.volume === 0 ? "🔇" : "🔊"}
                </button>
              </div>

              {/* Volume Slider */}
              <div className="flex items-center gap-1.5 font-mono text-xs text-white bg-black/60 px-3 py-1 rounded-lg border border-[#76cb00]/40">
                <span className="text-[#84e800] font-bold">VOL</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={p.volume}
                  onChange={(e) => handleVolumeChange(Number(e.target.value))}
                  className="w-16 sm:w-20 accent-[#76cb00] cursor-pointer"
                  aria-label="volume"
                />
                <span className="text-[10px] w-7 text-right font-mono text-[#84e800] font-bold">
                  {p.volume}%
                </span>
              </div>
            </div>

            {/* 4. Room Info & SMS Notice */}
            <div className="flex items-center justify-between font-mono text-[10px] text-white/70">
              <p className="truncate">
                {p.canControl
                  ? "● BẠN LÀ DJ — TOÀN QUYỀN ĐIỀU PHỐI SÓNG TRUYỀN HÌNH"
                  : "● ĐANG KẾT NỐI SÓNG iTV LIVE · DJ ĐIỀU PHỐI"}
              </p>
              {p.playError && <p className="text-red-400 font-bold">{p.playError}</p>}
            </div>

            {/* 5. Reactions Bar */}
            <div className="pt-2 border-t border-[#76cb00]/25 flex items-center justify-start">
              {p.children}
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (theme === "lofi") {
    const progress = dur > 0 ? Math.min(elapsed, dur) / dur : 0;
    // Left spool supplies tape: shrinks from 72px to 38px
    const leftTapeDiameter = Math.round(72 - progress * 34);
    // Right spool takes up tape: grows from 38px to 72px
    const rightTapeDiameter = Math.round(38 + progress * 34);

    return (
      <section className="relative rounded-xl border border-gold-200 bg-cream/50 p-2.5 sm:p-3.5 shadow-xl backdrop-blur-md overflow-hidden">
        {/* Soft overhead warm lamp glow */}
        <div className="pointer-events-none absolute inset-0 rounded-xl bg-[radial-gradient(ellipse_at_50%_0%,rgba(245,158,11,0.14)_0%,transparent_75%)]" />

        {/* ===================================================================== */}
        {/* AUTHENTIC TRANSLUCENT COMPACT CASSETTE TAPE (Vỏ nhựa trong suốt mờ)  */}
        {/* ===================================================================== */}
        <div className="relative z-10 w-full max-w-[620px] mx-auto rounded-2xl border-2 border-[#5c3a21]/60 bg-[#1a110a]/35 p-2 sm:p-3 shadow-[0_12px_28px_rgba(0,0,0,0.65),inset_0_1px_2px_rgba(255,255,255,0.18)] backdrop-blur-sm">
          {/* Top Write-Protect Notches (2 tai khuyết chống xoá băng trên đỉnh) */}
          <div className="absolute -top-1 left-7 sm:left-9 w-6 h-2 bg-[#0c0704] border-x border-b border-[#4a2e1b] rounded-b-xs select-none pointer-events-none" />
          <div className="absolute -top-1 right-7 sm:right-9 w-6 h-2 bg-[#0c0704] border-x border-b border-[#4a2e1b] rounded-b-xs select-none pointer-events-none" />

          {/* Top Center Grip Ribs (Gờ khía cầm tay trên đỉnh vỏ cassette) */}
          <div className="absolute -top-[2px] left-1/2 -translate-x-1/2 w-24 h-1.5 bg-[#26150a]/90 rounded-b-xs border-b border-[#4a2e1b] flex items-center justify-around px-2 select-none pointer-events-none">
            <span className="w-[1px] h-1 bg-[#4a2e1b]" />
            <span className="w-[1px] h-1 bg-[#4a2e1b]" />
            <span className="w-[1px] h-1 bg-[#4a2e1b]" />
            <span className="w-[1px] h-1 bg-[#4a2e1b]" />
            <span className="w-[1px] h-1 bg-[#4a2e1b]" />
          </div>

          {/* 4 Corner Screws (Ốc kim loại 4 góc) */}
          <div className="absolute top-2 left-2 w-3.5 h-3.5 rounded-full bg-gradient-to-br from-[#807060] via-[#524436] to-[#241c14] border border-[#140e08] shadow-xs flex items-center justify-center select-none pointer-events-none">
            <div className="w-1.5 h-[1px] bg-[#140e08] rotate-45" />
          </div>
          <div className="absolute top-2 right-2 w-3.5 h-3.5 rounded-full bg-gradient-to-br from-[#807060] via-[#524436] to-[#241c14] border border-[#140e08] shadow-xs flex items-center justify-center select-none pointer-events-none">
            <div className="w-1.5 h-[1px] bg-[#140e08] -rotate-30" />
          </div>
          <div className="absolute bottom-2.5 left-2 w-3.5 h-3.5 rounded-full bg-gradient-to-br from-[#807060] via-[#524436] to-[#241c14] border border-[#140e08] shadow-xs flex items-center justify-center select-none pointer-events-none">
            <div className="w-1.5 h-[1px] bg-[#140e08] rotate-15" />
          </div>
          <div className="absolute bottom-2.5 right-2 w-3.5 h-3.5 rounded-full bg-gradient-to-br from-[#807060] via-[#524436] to-[#241c14] border border-[#140e08] shadow-xs flex items-center justify-center select-none pointer-events-none">
            <div className="w-1.5 h-[1px] bg-[#140e08] rotate-60" />
          </div>

          {/* 1. VINTAGE PAPER STICKER LABEL (Phần nhãn dán nửa trên) */}
          <div className="relative rounded-xl border border-[#c4b39b]/90 bg-gradient-to-b from-[#fcf9f2]/95 via-[#f5eee1]/90 to-[#e8decf]/90 p-2.5 sm:p-3.5 text-[#2b180d] shadow-sm backdrop-blur-xs">
            {/* Fine Paper Texture Lines */}
            <div className="pointer-events-none absolute inset-0 rounded-xl bg-[linear-gradient(rgba(180,140,90,0.06)_1px,transparent_1px)] bg-[size:100%_4px]" />

            {/* Label Header: Red SIDE A Stamp, Specs & Mixtape ID */}
            <div className="relative z-10 flex items-center justify-between gap-2 border-b border-[#dfcca9] pb-1.5 select-none">
              <div className="flex items-center gap-2">
                <span className="bg-[#8b1e1e] text-white font-mono text-[9px] sm:text-[10px] font-black px-1.5 py-0.5 rounded-xs tracking-widest shadow-xs">
                  SIDE A
                </span>
                <span className="font-mono text-[8px] sm:text-[9px] text-[#6b4e33] font-semibold tracking-wider">
                  NORMAL BIAS (TYPE I) • 120µs EQ
                </span>
              </div>
              <div className="flex items-center gap-1.5 font-mono text-[8px] sm:text-[9px] text-[#6b4e33]">
                <span className="font-bold text-[#8b1e1e]">C-90</span>
                <span>•</span>
                <span className="font-semibold text-[#3b2314]">
                  TẬP #{current?.id ? String(current.id).slice(-4) : "8730"}
                </span>
              </div>
            </div>

            {/* Label Track Info Row with Album Sticker */}
            <div className="relative z-10 flex items-center gap-2.5 sm:gap-3 py-1.5">
              {/* Mini Album Cover Sticker (Dán trên nhãn băng) */}
              <div className="shrink-0 relative">
                <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xs p-0.5 bg-white border border-[#c4b39b] shadow-[0_2px_4px_rgba(0,0,0,0.15)] overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={current?.thumbnail_url || "/themes/lofi/bg.jpg"}
                    alt={current?.title || "Mixtape Album"}
                    className={`w-full h-full object-cover transition-all duration-500 ${
                      room.is_playing ? "brightness-100" : "brightness-90 contrast-95"
                    }`}
                  />
                </div>
                {/* Washi tape on sticker */}
                <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-6 h-1.5 bg-[#b45309]/50 border border-amber-700/40 rounded-xs rotate-[-3deg] shadow-xs" />
              </div>

              {/* Ruled Lines Track Titles */}
              <div className="min-w-0 flex-1">
                <div className="border-b border-[#cbb79a] pb-0.5">
                  <h2
                    className="truncate font-serif text-sm sm:text-base font-extrabold text-[#2a170d] tracking-wide"
                    title={current?.title || current?.youtube_video_id || "Gác Mái Chiều Mưa"}
                  >
                    {current ? (current.title || current.youtube_video_id) : "Gác Mái Chiều Mưa • Chờ DJ chọn bài"}
                  </h2>
                </div>
                <div className="flex items-center justify-between text-[10px] sm:text-[11px] font-serif text-[#5c3a21] pt-1">
                  <span className="truncate">
                    {current ? `✍️ Yêu cầu bởi: ${current.added_by_name}` : "☕ Bật nhạc để sưởi ấm gác mái"}
                  </span>
                  <span className="shrink-0 font-mono text-[9px] text-[#785b3a] ml-2">
                    🌧️ 21°C
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 2. TRANSPARENT CASSETTE WINDOW (Cửa sổ mica trong suốt lộ cuộn băng & Bánh răng) */}
          <div className="relative my-2 h-24 sm:h-28 w-full rounded-2xl border-2 border-[#4a2e1b]/60 bg-[#0d0704]/45 shadow-[inset_0_2px_12px_rgba(0,0,0,0.85)] overflow-hidden flex items-center justify-between px-6 sm:px-14 backdrop-blur-xs">
            {/* Glass Glare Reflection Line */}
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,transparent_30%,rgba(255,255,255,0.08)_45%,rgba(255,255,255,0.02)_55%,transparent_70%)]" />

            {/* REALISTIC DIAGONAL MAGNETIC TAPE PATH (Đường băng từ nối xuống con lăn góc) */}
            {/* Left diagonal tape band running towards bottom-left roller */}
            <div className="pointer-events-none absolute left-12 sm:left-20 top-1/2 bottom-0 w-3 bg-[#26140b] -rotate-15 origin-top border-l border-[#3d2012]/80 opacity-85" />
            {/* Right diagonal tape band running towards bottom-right roller */}
            <div className="pointer-events-none absolute right-12 sm:right-20 top-1/2 bottom-0 w-3 bg-[#26140b] rotate-15 origin-top border-r border-[#3d2012]/80 opacity-85" />

            {/* Left Spool: Supply Reel (Thu nhỏ dần theo thời gian) */}
            <div className="relative z-10 w-18 h-18 sm:w-20 sm:h-20 flex items-center justify-center">
              {/* Magnetic Tape Pack */}
              <div
                className="rounded-full bg-gradient-to-br from-[#2b170c] via-[#1a0e07] to-[#120804] border border-[#3d2012] flex items-center justify-center shadow-[inset_0_1px_2px_rgba(255,255,255,0.08),0_2px_8px_rgba(0,0,0,0.7)] transition-[width,height] duration-500"
                style={{
                  width: `${leftTapeDiameter}px`,
                  height: `${leftTapeDiameter}px`,
                }}
              >
                {/* White 6-Tooth Cassette Gear Hub */}
                <svg
                  viewBox="0 0 40 40"
                  className="w-8 h-8 sm:w-9 sm:h-9 shrink-0 select-none pointer-events-none"
                  style={{
                    animation: room.is_playing ? "spin 3.2s linear infinite" : "none",
                  }}
                >
                  <circle cx="20" cy="20" r="17" fill="#fdfbf7" stroke="#cfbeaa" strokeWidth="1.2" />
                  <circle cx="20" cy="20" r="12" fill="none" stroke="#dfd4c4" strokeWidth="0.8" />
                  <circle cx="20" cy="20" r="8.5" fill="#0d0704" stroke="#4a301c" strokeWidth="0.8" />
                  <rect x="18.5" y="7.5" width="3" height="4" rx="0.5" fill="#fdfbf7" />
                  <rect x="18.5" y="28.5" width="3" height="4" rx="0.5" fill="#fdfbf7" />
                  <g transform="rotate(60 20 20)">
                    <rect x="18.5" y="7.5" width="3" height="4" rx="0.5" fill="#fdfbf7" />
                    <rect x="18.5" y="28.5" width="3" height="4" rx="0.5" fill="#fdfbf7" />
                  </g>
                  <g transform="rotate(120 20 20)">
                    <rect x="18.5" y="7.5" width="3" height="4" rx="0.5" fill="#fdfbf7" />
                    <rect x="18.5" y="28.5" width="3" height="4" rx="0.5" fill="#fdfbf7" />
                  </g>
                </svg>
              </div>
            </div>

            {/* Window Center: Real Cassette Scale Markings (100 - 50 - 0) */}
            <div className="relative z-10 flex flex-col items-center select-none pointer-events-none px-2">
              <div className="flex items-center gap-1.5 sm:gap-2.5 text-[8px] sm:text-[9px] font-mono text-amber-200/60 font-bold tracking-widest">
                <span>100</span>
                <span className="text-amber-400/80">•</span>
                <span>50</span>
                <span className="text-amber-400/80">•</span>
                <span>0</span>
              </div>
              {/* Gauge tick lines */}
              <div className="flex items-center gap-1 sm:gap-1.5 my-1 text-[7px] text-amber-500/50">
                <span>|</span>
                <span>:</span>
                <span>|</span>
                <span className="text-red-400 font-bold">▲</span>
                <span>|</span>
                <span>:</span>
                <span>|</span>
              </div>
              <span className="font-mono text-[7px] sm:text-[8px] text-amber-400/60 tracking-wider">
                INDEX
              </span>
            </div>

            {/* Right Spool: Take-up Reel (Dày dần theo thời gian) */}
            <div className="relative z-10 w-18 h-18 sm:w-20 sm:h-20 flex items-center justify-center">
              {/* Magnetic Tape Pack */}
              <div
                className="rounded-full bg-gradient-to-br from-[#2b170c] via-[#1a0e07] to-[#120804] border border-[#3d2012] flex items-center justify-center shadow-[inset_0_1px_2px_rgba(255,255,255,0.08),0_2px_8px_rgba(0,0,0,0.7)] transition-[width,height] duration-500"
                style={{
                  width: `${rightTapeDiameter}px`,
                  height: `${rightTapeDiameter}px`,
                }}
              >
                {/* White 6-Tooth Cassette Gear Hub */}
                <svg
                  viewBox="0 0 40 40"
                  className="w-8 h-8 sm:w-9 sm:h-9 shrink-0 select-none pointer-events-none"
                  style={{
                    animation: room.is_playing ? "spin 3.2s linear infinite" : "none",
                  }}
                >
                  <circle cx="20" cy="20" r="17" fill="#fdfbf7" stroke="#cfbeaa" strokeWidth="1.2" />
                  <circle cx="20" cy="20" r="12" fill="none" stroke="#dfd4c4" strokeWidth="0.8" />
                  <circle cx="20" cy="20" r="8.5" fill="#0d0704" stroke="#4a301c" strokeWidth="0.8" />
                  <rect x="18.5" y="7.5" width="3" height="4" rx="0.5" fill="#fdfbf7" />
                  <rect x="18.5" y="28.5" width="3" height="4" rx="0.5" fill="#fdfbf7" />
                  <g transform="rotate(60 20 20)">
                    <rect x="18.5" y="7.5" width="3" height="4" rx="0.5" fill="#fdfbf7" />
                    <rect x="18.5" y="28.5" width="3" height="4" rx="0.5" fill="#fdfbf7" />
                  </g>
                  <g transform="rotate(120 20 20)">
                    <rect x="18.5" y="7.5" width="3" height="4" rx="0.5" fill="#fdfbf7" />
                    <rect x="18.5" y="28.5" width="3" height="4" rx="0.5" fill="#fdfbf7" />
                  </g>
                </svg>
              </div>
            </div>
          </div>

          {/* 3. CASSETTE BOTTOM TAPE-HEAD TRAPEZOID (Phần khuyết đầu từ đặc trưng 100% của băng cassette) */}
          <div className="relative mx-auto mt-1 w-[82%] sm:w-[78%] h-12 sm:h-14 rounded-b-lg bg-[#140b05]/50 border-x-2 border-b-2 border-[#5c3a21]/60 shadow-[inset_0_2px_6px_rgba(0,0,0,0.7)] flex items-center justify-between px-3 sm:px-6 backdrop-blur-xs">
            {/* Left Corner Guide Roller Pin (Con lăn dẫn hướng trái) */}
            <div className="relative w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-[#fdfbf7]/90 border border-[#bfa588] shadow-inner flex items-center justify-center select-none pointer-events-none">
              <div className="w-1.5 h-1.5 rounded-full bg-[#3d2012]" />
            </div>

            {/* Left Capstan Drive Hole (Lỗ trục truyền động tròn) */}
            <div className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full bg-[#080402] border-2 border-[#5c3a21] shadow-inner" />

            {/* Center Tape Head Opening with Bronze Spring Shield & Felt Pad */}
            <div className="relative w-20 sm:w-28 h-6 sm:h-7 bg-[#0a0503] border border-[#4a2e1b] rounded-xs flex items-center justify-center overflow-hidden shadow-inner">
              {/* Copper / Bronze Shield Spring */}
              <div className="absolute inset-x-2 bottom-1 h-3 bg-gradient-to-t from-[#92400e] to-[#d97706] rounded-xs opacity-75" />
              {/* White Felt Pressure Pad */}
              <div className="relative z-10 w-3.5 h-2 bg-[#fdf2f2] border border-[#ef4444]/60 rounded-xs shadow-xs" />
              {/* Magnetic Tape Ribbon running across the head opening */}
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2.5 bg-[#26140b] border-y border-[#3d2012]/80 opacity-90" />
            </div>

            {/* Right Capstan Drive Hole (Lỗ trục truyền động tròn) */}
            <div className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full bg-[#080402] border-2 border-[#5c3a21] shadow-inner" />

            {/* Right Corner Guide Roller Pin (Con lăn dẫn hướng phải) */}
            <div className="relative w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-[#fdfbf7]/90 border border-[#bfa588] shadow-inner flex items-center justify-center select-none pointer-events-none">
              <div className="w-1.5 h-1.5 rounded-full bg-[#3d2012]" />
            </div>

            {/* Bottom Center Screw */}
            <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-gradient-to-br from-[#807060] via-[#524436] to-[#241c14] border border-[#140e08] shadow-xs flex items-center justify-center select-none pointer-events-none">
              <div className="w-1 h-[1px] bg-[#140e08] rotate-45" />
            </div>
          </div>
        </div>

        {/* ========================================================= */}
        {/* CASSETTE DECK TRANSPORT TRAY (Khay phím cơ mờ trong suốt) */}
        {/* ========================================================= */}
        <div className="relative z-10 w-full max-w-[620px] mx-auto mt-3 rounded-xl border border-gold-200/30 bg-[#120a05]/30 p-2.5 sm:p-3 shadow-inner backdrop-blur-md">
          {/* Timeline & Tape Counter Row */}
          <div className="flex items-center gap-2.5 mb-2.5">
            {/* Mechanical Counter Display */}
            <div className="shrink-0 px-2 py-1 rounded bg-[#090503]/80 border border-amber-900/60 font-mono text-[11px] font-bold text-[#f59e0b] shadow-inner select-none">
              {formatClock(elapsed)}
            </div>

            {/* Smooth Tape Timeline Seekbar */}
            <div className="relative flex-1 flex items-center h-4">
              <div className="absolute inset-x-0 h-1.5 rounded-full bg-[#24150c]/80 border border-amber-900/40" />
              <div
                className="absolute left-0 h-1.5 rounded-full bg-gradient-to-r from-amber-700 via-amber-500 to-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.5)]"
                style={{ width: `${dur ? (Math.min(elapsed, dur) / dur) * 100 : 0}%` }}
              />
              <input
                type="range"
                min={0}
                max={dur || 0}
                value={Math.min(elapsed, dur || 0)}
                disabled={!p.canControl || dur === 0}
                onChange={(e) => p.onSeekMs(Number(e.target.value))}
                className="relative z-20 w-full h-4 opacity-0 cursor-pointer"
                aria-label="seek"
              />
              {/* Tape Position Red Indicator Needle */}
              <div
                className="absolute z-10 pointer-events-none -top-0.5 h-3.5 w-1 bg-gradient-to-b from-red-500 to-amber-500 rounded-xs shadow-[0_0_6px_#f59e0b]"
                style={{
                  left: `calc(${dur ? (Math.min(elapsed, dur) / dur) * 100 : 0}% - 2px)`,
                }}
              />
            </div>

            {/* Total Duration Counter */}
            <div className="shrink-0 px-2 py-1 rounded bg-[#090503]/80 border border-amber-900/40 font-mono text-[11px] text-[#dfcca9]/70 select-none">
              {formatClock(dur)}
            </div>
          </div>

          {/* Mechanical Piano Transport Keys & Volume Control */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1 border-t border-amber-900/30">
            {/* Piano Keys Buttons */}
            <div className="flex items-center gap-2">
              {p.canControl && (
                <>
                  {/* [ PLAY / PAUSE ] Key */}
                  <button
                    onClick={p.onPlayPause}
                    className="px-3.5 py-1.5 rounded-md bg-gradient-to-b from-[#d97706] to-[#853907] border-t border-amber-300 border-b-2 border-[#3b1501] text-[#1a0f07] font-black text-xs uppercase shadow-[0_2px_6px_rgba(0,0,0,0.6)] active:translate-y-0.5 cursor-pointer transition hover:brightness-110 flex items-center gap-1.5"
                    title={room.is_playing ? "Tạm dừng" : "Phát nhạc"}
                  >
                    <span>{room.is_playing ? "⏸" : "⏵"}</span>
                    <span>{room.is_playing ? "PAUSE" : "PLAY"}</span>
                  </button>

                  {/* [ F.FWD / CHUYỂN BÀI ] Key */}
                  <button
                    onClick={p.onSkip}
                    className="px-3 py-1.5 rounded-md bg-gradient-to-b from-[#331d10] to-[#1e1008] border-t border-amber-700/50 border-b-2 border-black text-[#fcd34d] font-mono text-xs shadow-[0_2px_5px_rgba(0,0,0,0.5)] active:translate-y-0.5 cursor-pointer transition hover:bg-[#422515] flex items-center gap-1"
                    title="Chuyển bài tiếp theo"
                  >
                    <span>FWD</span>
                    <span>⏭</span>
                  </button>
                </>
              )}

              {/* [ AUDIO / MUTE ] Key */}
              <button
                onClick={toggleAudio}
                className={`px-3 py-1.5 rounded-md border-t border-b-2 font-mono text-xs shadow-[0_2px_5px_rgba(0,0,0,0.5)] active:translate-y-0.5 cursor-pointer flex items-center gap-1.5 transition ${
                  !p.unlocked
                    ? "bg-gradient-to-b from-[#d97706] to-[#853907] border-amber-300 border-b-[#3b1501] text-[#1a0f07] animate-pulse"
                    : p.volume === 0
                    ? "bg-[#1e1008] border-amber-900/50 border-b-black text-amber-600/70"
                    : "bg-gradient-to-b from-[#331d10] to-[#1e1008] border-amber-700/50 border-b-black text-[#fcd34d] hover:border-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.2)]"
                }`}
                title={
                  !p.unlocked
                    ? "Nhấn để bật âm thanh nghe trên thiết bị này"
                    : p.volume === 0
                    ? "Bật lại tiếng (Unmute)"
                    : "Tắt tiếng (Mute)"
                }
              >
                <span>{!p.unlocked || p.volume === 0 ? "🔇" : "🔊"}</span>
                <span className="text-[10px] hidden sm:inline">
                  {!p.unlocked || p.volume === 0 ? "MUTE" : "AUDIO"}
                </span>
              </button>
            </div>

            {/* Volume Fader Slider */}
            <div className="flex items-center gap-2 font-mono text-xs text-white bg-[#0a0503]/80 px-2.5 py-1 rounded-md border border-amber-900/40">
              <span className="text-[#f59e0b] font-bold text-[9px] select-none">VOL</span>
              <input
                type="range"
                min={0}
                max={100}
                value={p.volume}
                onChange={(e) => handleVolumeChange(Number(e.target.value))}
                className="w-16 sm:w-24 accent-[#d97706] cursor-pointer"
                aria-label="volume"
              />
              <span className="text-[9px] w-6 text-right font-mono text-[#fcd34d] font-bold">
                {p.volume}%
              </span>
            </div>
          </div>
        </div>

        {/* Reactions bar */}
        <div className="pt-2.5 mt-2.5 border-t border-amber-900/30 flex items-center justify-center">
          {p.children}
        </div>
      </section>
    );
  }

  if (theme === "cyberpunk") {
    return (
      <section className="relative rounded-xl border border-cyan-500/50 bg-[#080914]/90 p-3 sm:p-4 shadow-[0_0_28px_rgba(0,240,255,0.22),inset_0_1px_0_rgba(0,240,255,0.4)] backdrop-blur-xl">
        <CyberpunkCorners size={44} allFour />
        <div className="flex flex-col md:flex-row items-center md:items-stretch gap-4 sm:gap-6 w-full">
          {/* Left Column: Cyber-Deck Cassette Centerpiece */}
          <div className="shrink-0 flex items-center justify-center">
            <Turntable spinning={room.is_playing && !!current} thumbnail={current?.thumbnail_url} />
          </div>

          {/* Right Column: Digital HUD Info, Controls, Timeline */}
          <div className="flex-1 min-w-0 flex flex-col justify-between gap-3 text-left w-full py-0.5">
            {/* 1. Track Info */}
            {current ? (
              <div className="flex items-center gap-3">
                {current.thumbnail_url && (
                  <div className="relative h-13 w-13 sm:h-14 sm:w-14 shrink-0 overflow-hidden rounded-lg border border-pink-500/60 shadow-[0_0_12px_rgba(255,0,85,0.35)] bg-black/60">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={current.thumbnail_url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                    {room.is_playing && (
                      <div className="absolute inset-0 bg-cyan-400/20 animate-pulse" />
                    )}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h2
                    className="truncate font-mono text-base sm:text-lg font-black text-cyan-200 tracking-wide"
                    style={{ textShadow: "0 0 10px rgba(0,240,255,0.6)" }}
                    title={current.title || current.youtube_video_id}
                  >
                    {current.title || current.youtube_video_id}
                  </h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="font-mono text-[9px] uppercase px-1.5 py-0.5 rounded bg-pink-950/80 border border-pink-500/50 text-pink-300 font-bold tracking-wider">
                      UPLOADER
                    </span>
                    <span className="font-mono text-[11px] text-cyan-300 font-semibold truncate flex items-center gap-1">
                      <span>{current.added_by_name}</span>
                      {current.is_replay && (
                        <span className="text-[9px] px-1 py-0.2 rounded bg-cyan-950/80 border border-cyan-500/50 text-cyan-300">🔁 REPLAY</span>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-2">
                <h2 className="font-mono text-base font-bold text-cyan-300/90 tracking-wider">
                  {!p.djOnline ? "// SYSTEM: DJ OFFLINE - STANDBY" : "// AUDIO_QUEUE: EMPTY"}
                </h2>
                <p className="font-mono text-[11px] text-pink-400/70 mt-0.5">
                  Thêm bài hát ở bảng bên phải để nạp vào băng từ Cyber-Deck
                </p>
              </div>
            )}

            {/* 2. Timeline / Progress */}
            <div className="flex w-full items-center gap-2 text-xs text-cyan-300/80">
              <span className="font-mono text-[11px] w-9 text-right text-cyan-400 font-bold">
                {formatClock(elapsed)}
              </span>
              <input
                type="range"
                min={0}
                max={dur || 0}
                value={Math.min(elapsed, dur || 0)}
                disabled={!p.canControl || dur === 0}
                onChange={(e) => p.onSeekMs(Number(e.target.value))}
                className="h-1.5 flex-1 accent-cyan-400 cursor-pointer"
                aria-label="seek"
              />
              <span className="font-mono text-[11px] w-9 text-pink-400 font-bold">
                {formatClock(dur)}
              </span>
            </div>

            {/* 3. Controls Row */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                {p.canControl && (
                  <>
                    <button
                      onClick={p.onPlayPause}
                      className="h-10 w-10 sm:h-11 sm:w-11 rounded-lg bg-gradient-to-r from-cyan-400 to-blue-500 border border-cyan-200 text-black font-extrabold text-sm shadow-[0_0_16px_rgba(0,240,255,0.6)] transition hover:scale-105 active:scale-95 flex items-center justify-center cursor-pointer"
                      title={room.is_playing ? "Tạm dừng" : "Phát nhạc"}
                    >
                      {room.is_playing ? "⏸" : "▶"}
                    </button>
                    <button
                      onClick={p.onSkip}
                      className="h-8.5 px-3 rounded-lg border border-pink-500/60 bg-[#160a1e] text-pink-300 font-mono text-xs shadow-[0_0_10px_rgba(255,0,85,0.3)] transition hover:bg-pink-950/60 hover:scale-105 active:scale-95 cursor-pointer flex items-center gap-1.5"
                      title="Chuyển bài tiếp theo"
                    >
                      <span>SKIP</span>
                      <span>⏭</span>
                    </button>
                  </>
                )}

                {/* Audio On/Off Toggle Icon */}
                <button
                  onClick={toggleAudio}
                  className={`h-8.5 w-8.5 rounded-lg font-mono text-sm shadow-md transition hover:scale-105 active:scale-95 cursor-pointer flex items-center justify-center ${
                    !p.unlocked
                      ? "bg-gradient-to-r from-emerald-400 to-cyan-400 border border-emerald-200 text-black shadow-[0_0_14px_#00ff88] animate-pulse"
                      : p.volume === 0
                      ? "bg-[#160a1e] border border-pink-500/50 text-pink-400"
                      : "bg-[#0c1224] border border-cyan-400/50 text-cyan-300 hover:border-cyan-300 shadow-[0_0_8px_rgba(0,240,255,0.3)]"
                  }`}
                  title={
                    !p.unlocked
                      ? "Nhấn để bật âm thanh nghe trên thiết bị này"
                      : p.volume === 0
                      ? "Bật lại tiếng (Unmute)"
                      : "Tắt tiếng (Mute)"
                  }
                >
                  {!p.unlocked || p.volume === 0 ? "🔇" : "🔊"}
                </button>
              </div>

              {/* Volume Slider */}
              <div className="flex items-center gap-1.5 font-mono text-xs text-cyan-300 bg-black/60 px-3 py-1 rounded-lg border border-cyan-400/30">
                <span className="text-cyan-400">VOL</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={p.volume}
                  onChange={(e) => handleVolumeChange(Number(e.target.value))}
                  className="w-16 sm:w-20 accent-cyan-400 cursor-pointer"
                  aria-label="volume"
                />
                <span className="text-[10px] w-7 text-right font-mono text-emerald-400 font-bold">
                  {p.volume}%
                </span>
              </div>
            </div>

            {/* 4. Room Info */}
            <div className="flex items-center justify-between font-mono text-[10px] text-cyan-400/70">
              <p className="truncate">
                {p.canControl
                  ? "// NODE_ROLE: [DJ_MASTER] — FULL DECK ACCESS"
                  : "// NODE_ROLE: [SUBSCRIBER] — REMOTE SYNCED"}
              </p>
              {p.playError && <p className="text-pink-400 font-bold">{p.playError}</p>}
            </div>

            {/* 5. Reactions Bar */}
            <div className="pt-2 border-t border-cyan-500/20 flex items-center justify-start">
              {p.children}
            </div>
          </div>
        </div>
      </section>
    );
  }

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
                  <p className="text-[11px] text-amber-400/70 truncate mt-0.5 flex items-center gap-1.5">
                    <span>do <b className="text-amber-300 font-semibold">{current.added_by_name}</b> đóng góp</span>
                    {current.is_replay && (
                      <span className="inline-flex items-center rounded bg-amber-400/20 px-1 py-0.2 text-[9px] font-semibold text-amber-200">
                        🔁 Replay
                      </span>
                    )}
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

                {/* Audio On/Off Toggle Icon */}
                <button
                  onClick={toggleAudio}
                  className={`h-8.5 w-8.5 rounded-full border text-xs shadow-md transition hover:scale-105 active:scale-95 cursor-pointer flex items-center justify-center ${
                    !p.unlocked
                      ? "bg-gradient-to-r from-red-800 to-amber-700 border-amber-400/80 text-amber-100 shadow-[0_0_10px_rgba(212,175,55,0.4)] animate-pulse"
                      : p.volume === 0
                      ? "bg-[#181520] border-amber-400/30 text-amber-400/50"
                      : "bg-[#1f1a29] border-amber-400/50 text-amber-200"
                  }`}
                  title={
                    !p.unlocked
                      ? "Nhấn để bật âm thanh nghe trên thiết bị này"
                      : p.volume === 0
                      ? "Bật lại tiếng (Unmute)"
                      : "Tắt tiếng (Mute)"
                  }
                >
                  {!p.unlocked || p.volume === 0 ? "🔇" : "🔊"}
                </button>
              </div>

              {/* Volume Slider */}
              <div className="flex items-center gap-1.5 text-xs text-amber-200/80 bg-black/40 px-3 py-1 rounded-full border border-amber-400/20">
                <span>VOL</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={p.volume}
                  onChange={(e) => handleVolumeChange(Number(e.target.value))}
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
            <p className="text-[11px] italic text-ink/80 leading-tight flex items-center justify-center gap-1.5">
              <span>do <b className="text-burgundy">{current.added_by_name}</b> đóng góp</span>
              {current.is_replay && (
                <span className="inline-flex items-center rounded bg-gold-200/50 px-1 py-0.5 text-[9px] font-semibold text-burgundy not-italic" title="Tự động phát lại từ lịch sử">
                  🔁 Replay
                </span>
              )}
            </p>
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

      <div className="flex items-center gap-3">
        {p.canControl && (
          <>
            <button onClick={p.onPlayPause} className="h-11 w-11 rounded-full bg-burgundy px-3 py-1 text-cream shadow-xs transition hover:scale-105 active:scale-95" title={room.is_playing ? "Tạm dừng" : "Phát nhạc"}>
              {room.is_playing ? "⏸" : "▶"}
            </button>
            <button onClick={p.onSkip} className="rounded-full border border-gold bg-cream px-3 py-1.5 text-xs text-burgundy shadow-xs transition hover:scale-105 active:scale-95" title="Chuyển bài">⏭</button>
          </>
        )}
        <button
          onClick={toggleAudio}
          className={`h-9 w-9 rounded-full border border-gold bg-cream text-sm shadow-xs transition hover:scale-105 active:scale-95 cursor-pointer flex items-center justify-center ${
            !p.unlocked ? "animate-pulse bg-burgundy text-cream" : ""
          }`}
          title={!p.unlocked ? "Nhấn để bật âm thanh" : p.volume === 0 ? "Bật lại tiếng (Unmute)" : "Tắt tiếng (Mute)"}
        >
          {!p.unlocked || p.volume === 0 ? "🔇" : "🔊"}
        </button>
        <label className="flex items-center gap-1 text-xs text-ink/80">
          <input type="range" min={0} max={100} value={p.volume}
            onChange={(e) => handleVolumeChange(Number(e.target.value))} className="w-16 sm:w-20 accent-burgundy" aria-label="volume" />
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
