"use client";

import { useState } from "react";
import Image from "next/image";
import logo from "@/public/logo.png";
import { useTheme } from "@/hooks/useTheme";
import PixelLogo from "@/components/brand/PixelLogo";

function Speaker({ spinning }: { spinning: boolean }) {
  return (
    <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 ${spinning ? "animate-brand-pulse" : ""}`}
      style={{ background: "var(--color-gold)", borderColor: "var(--color-ink)" }}>
      <div className="h-9 w-9 rounded-full" style={{ background: "var(--color-ink)" }} />
    </div>
  );
}

function CozyRadio({ spinning, thumbnail }: { spinning: boolean; thumbnail?: string | null }) {
  return (
    <div className="relative mx-auto h-64 w-80 select-none">
      <div className="absolute right-12 top-0 h-6 w-1" style={{ background: "var(--color-ink)" }} />
      <div className="absolute inset-x-4 bottom-6 top-6 rounded-md border-4 p-3"
        style={{ background: "var(--color-burgundy)", borderColor: "var(--color-ink)" }}>
        <div className="flex items-center gap-3">
          <Speaker spinning={spinning} />
          <div className="flex-1 rounded border-2 p-1" style={{ borderColor: "var(--color-ink)", background: "var(--color-cream)" }}>
            {thumbnail
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={thumbnail} alt="" className="h-16 w-full rounded object-cover" />
              : <div className="flex h-16 items-center justify-center"><PixelLogo size={44} /></div>}
            <div className="mt-1 flex h-5 items-end justify-center gap-1">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <span key={i} className="w-1.5 origin-bottom" style={{
                  height: "100%", background: "var(--color-green-vintage)",
                  transform: spinning ? undefined : "scaleY(0.3)",
                  animation: spinning ? `eq 0.8s ${i * 0.1}s ease-in-out infinite` : "none",
                }} />
              ))}
            </div>
          </div>
          <Speaker spinning={spinning} />
        </div>
        <div className="mt-3 flex items-center justify-center gap-2">
          {[0, 1, 2].map((i) => <span key={i} className="h-3 w-3 rounded-full" style={{ background: "var(--color-ink)" }} />)}
        </div>
      </div>
    </div>
  );
}

function VinylDisc({ spinning, thumbnail }: { spinning: boolean; thumbnail?: string | null }) {
  return (
    <div className="relative mx-auto h-64 w-80">
      <div
        className={`absolute left-3 top-3.5 h-[230px] w-[230px] rounded-full shadow-2xl ${spinning ? "animate-vinyl" : "animate-vinyl animate-vinyl-paused"}`}
        style={{ background: "repeating-radial-gradient(circle at center,#15110b 0 2px,#241a10 2px 4px)" }}
      >
        <div className="absolute inset-[34%] flex items-center justify-center rounded-full"
          style={{ background: "radial-gradient(circle,#7a1f33,#6e2233 60%,#4d1722)", boxShadow: "0 0 0 2px #b08d57" }}>
          {thumbnail
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={thumbnail} alt="" className="h-full w-full rounded-full object-cover opacity-90" />
            : <Image src={logo} alt="" width={80} height={80} className="h-full w-full rounded-full object-cover opacity-90" />}
        </div>
        <div className="absolute inset-[48.5%] rounded-full bg-[#1a140d]" />
      </div>
      <div className="absolute bottom-[92px] right-[22px] h-3 w-6 rounded-full bg-[#8a6d2f] opacity-40" />
      <div
        className="absolute right-[26px] top-2 h-[150px] w-[18px] origin-[9px_9px] transition-transform duration-[900ms] ease-in-out"
        style={{ transform: spinning ? "rotate(36deg)" : "rotate(0deg)" }}
      >
        <div className="absolute left-0 top-0 h-5 w-5 rounded-full bg-[#8a6d2f] shadow" />
        <div className="absolute left-2 top-[9px] h-[130px] w-1 rounded bg-linear-to-b from-[#c8a86a] to-[#8a6d2f]" />
        <div className="absolute bottom-0 left-px h-4 w-[18px] rounded bg-burgundy" />
      </div>
    </div>
  );
}

function DragonLuteCenterpiece({ spinning }: { spinning: boolean }) {
  return (
    <div className="relative select-none flex items-center justify-center my-0.5">
      {/* Ambient Golden Palace Aura */}
      <div
        className={`absolute inset-0 rounded-full blur-2xl transition-all duration-1000 pointer-events-none ${
          spinning
            ? "opacity-60 bg-gradient-to-tr from-amber-500/30 via-red-600/15 to-amber-300/35 animate-pulse"
            : "opacity-15 bg-gradient-to-tr from-amber-500/10 to-transparent"
        }`}
      />

      {/* LUTE MAIDEN CENTERPIECE (2-STATE SEAMLESS TRANSITION) */}
      <div className="relative h-[190px] w-[190px] sm:h-[215px] sm:w-[215px] rounded-2xl border-2 border-amber-400/60 bg-gradient-to-b from-[#18161f] via-[#100f15] to-[#09080d] shadow-[0_16px_36px_rgba(0,0,0,0.95),0_0_24px_rgba(212,175,55,0.2),inset_0_1px_0_rgba(255,240,180,0.25)] p-1.5 flex items-center justify-center">
        {/* Inner Golden Border & Corner Accents */}
        <div className="absolute inset-1.5 rounded-xl border border-amber-400/25 pointer-events-none z-10" />
        <div className="absolute top-2 left-2 text-[9px] text-amber-300/50 pointer-events-none z-10">⌜</div>
        <div className="absolute top-2 right-2 text-[9px] text-amber-300/50 pointer-events-none z-10">⌝</div>
        <div className="absolute bottom-2 left-2 text-[9px] text-amber-300/50 pointer-events-none z-10">⌞</div>
        <div className="absolute bottom-2 right-2 text-[9px] text-amber-300/50 pointer-events-none z-10">⌟</div>

        {/* Gilded Stand Feet */}
        <div className="absolute -bottom-1.5 left-5 h-2 w-5 rounded-b-md bg-gradient-to-r from-amber-700 via-amber-300 to-amber-700 shadow-md" />
        <div className="absolute -bottom-1.5 right-5 h-2 w-5 rounded-b-md bg-gradient-to-r from-amber-700 via-amber-300 to-amber-700 shadow-md" />

        {/* Image Display Container */}
        <div className="relative h-full w-full rounded-xl overflow-hidden shadow-inner bg-black">
          {/* 1. RESTING STATE (Pause / Nghỉ đàn) */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/themes/dragon/lute_resting.jpg"
            alt="Giai nhân nghỉ ngơi"
            className={`absolute inset-0 h-full w-full object-cover transition-all duration-700 ease-in-out ${
              spinning
                ? "opacity-0 scale-98 pointer-events-none"
                : "opacity-100 scale-100 filter brightness-95"
            }`}
          />

          {/* 2. PLAYING STATE (Start / Gảy đàn) */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/themes/dragon/lute_playing.jpg"
            alt="Giai nhân gảy đàn"
            className={`absolute inset-0 h-full w-full object-cover transition-all duration-700 ease-in-out ${
              spinning
                ? "opacity-100 scale-100 filter brightness-105 contrast-102"
                : "opacity-0 scale-102 pointer-events-none"
            }`}
          />

          {/* Atmosphere Sheen & Glow */}
          <div
            className={`pointer-events-none absolute inset-0 transition-opacity duration-700 ${
              spinning ? "opacity-30" : "opacity-0"
            }`}
            style={{
              background:
                "radial-gradient(circle at 45% 55%, rgba(255,230,150,0.2) 0%, transparent 60%)",
            }}
          />

          {/* Subtle Vignette to frame the art */}
          <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_18px_rgba(0,0,0,0.7)]" />

          {/* Delicate State Text at Bottom */}
          <div className="pointer-events-none absolute inset-x-0 bottom-1.5 z-10 flex items-center justify-center">
            <span
              className={`px-2 py-0.5 rounded-full text-[9px] font-playfair tracking-[0.2em] uppercase transition-all duration-700 backdrop-blur-xs ${
                spinning
                  ? "text-amber-200/90 bg-black/40 border border-amber-400/30 shadow-[0_0_8px_rgba(212,175,55,0.3)]"
                  : "text-amber-400/50 bg-black/30 border border-transparent"
              }`}
            >
              {spinning ? "✦ Đang Diễn Tấu ✦" : "✦ Tĩnh Lặng ✦"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function TapeReel({
  spinning,
  color = "#00f0ff",
}: {
  spinning: boolean;
  color?: string;
}) {
  return (
    <div
      className={`relative h-13 w-13 sm:h-15 sm:w-15 shrink-0 ${
        spinning ? "animate-[spin_2.2s_linear_infinite]" : ""
      }`}
    >
      <svg
        viewBox="0 0 64 64"
        fill="none"
        className="w-full h-full drop-shadow-[0_0_8px_rgba(0,240,255,0.5)]"
      >
        {/* Outer Wheel Rim */}
        <circle cx="32" cy="32" r="30" stroke={color} strokeWidth="2.5" fill="#0b0e1b" />
        <circle cx="32" cy="32" r="23" stroke={color} strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
        {/* 6 Radial Spokes */}
        {[0, 60, 120, 180, 240, 300].map((deg) => (
          <line
            key={deg}
            x1="32"
            y1="32"
            x2={32 + 22 * Math.cos((deg * Math.PI) / 180)}
            y2={32 + 22 * Math.sin((deg * Math.PI) / 180)}
            stroke={color}
            strokeWidth="2"
            opacity="0.8"
          />
        ))}
        {/* Inner Hub Gear */}
        <circle cx="32" cy="32" r="11" fill="#04060d" stroke={color} strokeWidth="2" />
        {/* Center Spindle Teeth (3 prongs in hot magenta) */}
        {[0, 120, 240].map((deg) => (
          <rect
            key={deg}
            x="30.5"
            y="23"
            width="3"
            height="5"
            fill="#ff0055"
            transform={`rotate(${deg} 32 32)`}
          />
        ))}
        <circle cx="32" cy="32" r="4" fill="#000" />
      </svg>
    </div>
  );
}

const EQ_DELAYS = [0, 0.12, 0.28, 0.05, 0.35, 0.18, 0.42, 0.22, 0.08, 0.3, 0.15, 0.25];
const EQ_DURATIONS = [0.65, 0.5, 0.75, 0.55, 0.8, 0.6, 0.7, 0.52, 0.68, 0.58, 0.72, 0.62];

function CyberpunkCassettePlayer({
  spinning,
  thumbnail,
}: {
  spinning: boolean;
  thumbnail?: string | null;
}) {
  return (
    <div className="relative select-none flex items-center justify-center my-1 w-full max-w-[340px] sm:max-w-[360px]">
      {/* Ambient Neon Back-Glow */}
      <div
        className={`absolute inset-0 rounded-2xl blur-xl transition-all duration-700 pointer-events-none ${
          spinning
            ? "opacity-70 bg-gradient-to-r from-cyan-500/25 via-fuchsia-600/20 to-pink-500/25 animate-pulse"
            : "opacity-20 bg-cyan-500/10"
        }`}
      />

      {/* Cyber-Deck Chassis */}
      <div className="relative w-full rounded-xl border border-cyan-400/60 bg-gradient-to-b from-[#111326] via-[#090b16] to-[#04060c] p-2.5 sm:p-3 shadow-[0_0_24px_rgba(0,240,255,0.25),inset_0_1px_0_rgba(0,240,255,0.4)]">
        {/* Corner Rivet Screws */}
        <div className="absolute top-1.5 left-2 font-mono text-[9px] text-cyan-600 select-none">⊕</div>
        <div className="absolute top-1.5 right-2 font-mono text-[9px] text-pink-600 select-none">⊕</div>
        <div className="absolute bottom-1.5 left-2 font-mono text-[9px] text-cyan-600 select-none">⊕</div>
        <div className="absolute bottom-1.5 right-2 font-mono text-[9px] text-pink-600 select-none">⊕</div>

        {/* Top Deck HUD Bar */}
        <div className="flex items-center justify-between px-2 pb-1.5 border-b border-cyan-500/20 font-mono text-[9px] tracking-wider">
          <div className="flex items-center gap-1.5 text-cyan-400">
            <span className="text-pink-500 font-bold">CP-2099</span>
            <span className="text-cyan-600 hidden sm:inline">//</span>
            <span className="text-cyan-300/80 hidden sm:inline">MAGNETIC TAPE CORE</span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <span
                className={`inline-block h-2 w-2 rounded-full transition-all ${
                  spinning
                    ? "bg-emerald-400 shadow-[0_0_8px_#00ff88] animate-pulse"
                    : "bg-amber-500/60"
                }`}
              />
              <span className={`text-[9px] font-bold ${spinning ? "text-emerald-300" : "text-amber-400/80"}`}>
                {spinning ? "PLAY" : "PAUSED"}
              </span>
            </div>
            <span className="text-pink-400/80 font-bold">TYPE-IV</span>
          </div>
        </div>

        {/* Center Smoked Cassette Window */}
        <div className="relative mt-2 rounded-lg border border-cyan-400/40 bg-[#060812]/95 p-2 overflow-hidden shadow-inner">
          {/* Subtle Scanline Sheen */}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(0,240,255,0.02)_50%,transparent_50%)] bg-[length:100%_4px]" />

          {/* Tape Ribbon Running Across Spools */}
          <div className="absolute top-7 left-10 right-10 h-1 bg-gradient-to-r from-cyan-900 via-pink-900 to-cyan-900 opacity-70 pointer-events-none" />

          {/* Dual Spools and Center Mixtape Label */}
          <div className="relative flex items-center justify-between gap-2 z-10">
            {/* Left Spool */}
            <TapeReel spinning={spinning} color="#00f0ff" />

            {/* Center Mixtape Label */}
            <div className="flex-1 min-w-0 max-w-[150px] sm:max-w-[170px] mx-auto rounded-md border border-fuchsia-500/50 bg-[#0a0c1a] p-1 shadow-[0_0_12px_rgba(255,0,85,0.2)] flex flex-col items-center">
              <div className="relative h-11 sm:h-12 w-full rounded overflow-hidden bg-black/60 border border-cyan-400/30">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumbnail || "/themes/cyberpunk/emblem.jpg"}
                  alt="Cassette Label"
                  className={`h-full w-full object-cover transition-all ${
                    spinning ? "brightness-105 contrast-105" : "brightness-85 grayscale-20"
                  }`}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30 pointer-events-none" />
                <div className="absolute bottom-0.5 inset-x-1 flex items-center justify-between text-[7px] font-mono text-cyan-300 font-bold tracking-widest">
                  <span>A-SIDE</span>
                  <span className="text-pink-400">HI-RES</span>
                </div>
              </div>

              {/* Tape Branding Label */}
              <div className="w-full mt-1 flex items-center justify-between px-1 text-[8px] font-mono tracking-tight text-cyan-400/80">
                <span className="font-extrabold text-pink-400">NEO-TOKYO</span>
                <span className="text-[7px] text-cyan-300">2099.NET</span>
              </div>
            </div>

            {/* Right Spool */}
            <TapeReel spinning={spinning} color="#ff0055" />
          </div>

          {/* Equalizer Spectrum Analyzer Window (12-band) */}
          <div className="mt-2.5 pt-1.5 border-t border-cyan-500/20 flex items-center justify-between gap-2 px-1">
            <div className="font-mono text-[8px] text-cyan-400 tracking-wider flex items-center gap-1">
              <span className="text-pink-400 font-bold">VU</span>
              <span className="text-cyan-600">|</span>
              <span className="text-[7px] text-cyan-400/80">SPECTRUM</span>
            </div>

            {/* 12-Band Equalizer */}
            <div className="flex-1 flex h-4 sm:h-5 items-end justify-center gap-1 sm:gap-1.5 px-2">
              {EQ_DELAYS.map((delay, i) => (
                <div
                  key={i}
                  className="w-1.5 sm:w-2 rounded-xs transition-all duration-300"
                  style={{
                    height: spinning ? "100%" : "18%",
                    background: "linear-gradient(to top, #00ff88 0%, #00f0ff 60%, #ff0055 100%)",
                    boxShadow: spinning ? "0 0 6px rgba(0,240,255,0.4)" : "none",
                    animation: spinning
                      ? `eq-cyber ${EQ_DURATIONS[i]}s ${delay}s ease-in-out infinite`
                      : "none",
                  }}
                />
              ))}
            </div>

            <div className="font-mono text-[8px] text-pink-400 tracking-widest font-bold">
              +3dB
            </div>
          </div>
        </div>

        {/* Bottom Status Ticker */}
        <div className="mt-1.5 flex items-center justify-between px-1 font-mono text-[8px] text-cyan-400/70">
          <span>AUDIO-CORE: 96kHz / 32-BIT</span>
          <span className="text-pink-400/80">STEREO SURROUND</span>
        </div>
      </div>
    </div>
  );
}

function ITVTelevisionCenterpiece({
  spinning,
  thumbnail,
  title,
  uploader,
}: {
  spinning: boolean;
  thumbnail?: string | null;
  title?: string | null;
  uploader?: string | null;
}) {
  return (
    <div className="relative select-none flex items-center justify-center my-0.5 w-[220px] sm:w-[240px]">
      {/* Subtle Television Shadow */}
      <div className="relative w-full rounded-lg border border-[#76cb00]/50 bg-gradient-to-b from-[#181d26] via-[#0d121c] to-[#080b12] p-1.5 shadow-[0_4px_20px_rgba(0,0,0,0.8),0_0_12px_rgba(118,203,0,0.2)]">
        {/* CRT Screen Display */}
        <div className="relative w-full h-[140px] sm:h-[150px] rounded-md overflow-hidden bg-black flex flex-col justify-between border border-[#76cb00]/30 shadow-inner">
          {/* Background Video / Image Thumbnail */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumbnail || "/themes/itv/bg.jpg"}
            alt="iTV Screen"
            className={`absolute inset-0 h-full w-full object-cover transition-all duration-500 ${
              spinning ? "brightness-100 contrast-105" : "brightness-75 grayscale-20"
            }`}
          />

          {/* CRT Television Scanline Overlay */}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(0,0,0,0)_50%,rgba(0,0,0,0.35)_50%)] bg-[length:100%_3px] opacity-70" />

          {/* Top Row: Status on Left, Authentic Watermark on Right */}
          <div className="relative z-10 flex items-center justify-between p-1.5">
            {/* Top-Left: LIVE / PAUSE indicator */}
            <div className="flex items-center gap-1 bg-black/60 px-1.5 py-0.5 rounded text-[8px] font-mono text-white/90 border border-white/10 backdrop-blur-xs">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  spinning ? "bg-red-500 shadow-[0_0_6px_#ff0033] animate-pulse" : "bg-amber-400"
                }`}
              />
              <span className="font-bold">{spinning ? "TRỰC TIẾP" : "TẠM DỪNG"}</span>
            </div>

            {/* Top-Right: Iconic iTV Watermark Bug */}
            <div className="flex items-center gap-1 select-none opacity-90 drop-shadow-[0_1px_3px_#000]">
              <div className="flex h-4 w-4 items-center justify-center rounded-xs bg-[#76cb00] text-black font-black text-[9px] leading-none shadow-xs">
                i★
              </div>
              <span className="font-sans font-black text-[11px] text-[#84e800] tracking-tighter">TV</span>
              <span className="text-[#84e800] text-xs font-black">|</span>
            </div>
          </div>

          {/* Authentic iTV Lower-Third Graphic (Vintage 2000s Broadcast Ticker) */}
          <div className="relative z-10 w-full flex flex-col">
            {/* 1. Yellow SMS Instruction Ticker */}
            <div className="w-full px-1.5 py-0.5 bg-black/70 backdrop-blur-xs flex items-center justify-between text-[8px] sm:text-[9px] font-sans font-bold text-[#ffde00] border-t border-black/50">
              <span className="truncate drop-shadow-[0_1px_2px_#000]">
                Soạn tin: <span className="text-white font-black">IM 8730</span> gửi <span className="text-white font-black">8730</span>
              </span>
              <span className="text-white/60 font-mono text-[7px] shrink-0 ml-1">VTC13</span>
            </div>

            {/* 2. Lower Dark Bar with Green Square [ i★ ] Badge */}
            <div className="h-6 w-full bg-[#0a1120]/95 border-t border-[#76cb00]/40 flex items-center overflow-hidden">
              {/* Green Square [ i★ ] Badge */}
              <div className="h-full w-6 shrink-0 bg-[#76cb00] flex items-center justify-center text-white font-black text-[11px] select-none shadow-sm">
                i★
              </div>

              {/* Scrolling Ticker / Current Song Bar */}
              <div className="flex-1 overflow-hidden px-1.5 whitespace-nowrap">
                <div className="inline-block animate-[marquee_14s_linear_infinite] text-[8px] sm:text-[9px] font-sans font-medium text-white/90">
                  <span className="text-[#ff3b30] font-bold mx-1">❚</span>
                  <span className="text-[#ffde00] font-bold">MS: #8730</span>
                  <span className="text-white font-bold ml-1">{title || "iTV Music"}</span>
                  {uploader && <span className="text-[#84e800] ml-1">({uploader})</span>}
                  <span className="text-[#ff3b30] font-bold mx-1.5">❚</span>
                  <span className="text-[#ff9900]">11963: Ocean</span>
                  <span className="text-[#ff3b30] font-bold mx-1.5">❚</span>
                  <span className="text-[#ff9900]">12082: Nắm Lấy Bàn Tay</span>
                  <span className="text-[#ff3b30] font-bold mx-1.5">❚</span>
                  <span className="text-[#ff9900]">1343: My Heart Will Go On</span>
                  <span className="text-[#ff3b30] font-bold mx-1.5">❚</span>
                  <span className="text-[#ff9900]">9914: I&apos;m Sorry</span>
                  <span className="text-[#ff3b30] font-bold mx-1.5">❚</span>
                  <span className="text-[#ff9900]">2838: Stop Stop Stop</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Television Stand Feet & Power Dot */}
        <div className="mt-1 flex items-center justify-between px-2 text-[7px] font-mono text-white/40">
          <div className="flex items-center gap-1">
            <span className={`h-1 w-1 rounded-full ${spinning ? "bg-[#76cb00]" : "bg-amber-500"}`} />
            <span>ITV-CRT 2000</span>
          </div>
          <span>STEREO</span>
        </div>
      </div>
    </div>
  );
}

export default function Turntable({
  spinning,
  thumbnail,
  title,
  uploader,
}: {
  spinning: boolean;
  thumbnail?: string | null;
  title?: string | null;
  uploader?: string | null;
}) {
  const { theme } = useTheme();
  if (theme === "cozy") return <CozyRadio spinning={spinning} thumbnail={thumbnail} />;
  if (theme === "dragon") return <DragonLuteCenterpiece spinning={spinning} />;
  if (theme === "cyberpunk") return <CyberpunkCassettePlayer spinning={spinning} thumbnail={thumbnail} />;
  if (theme === "itv")
    return (
      <ITVTelevisionCenterpiece
        spinning={spinning}
        thumbnail={thumbnail}
        title={title}
        uploader={uploader}
      />
    );
  return <VinylDisc spinning={spinning} thumbnail={thumbnail} />;
}


