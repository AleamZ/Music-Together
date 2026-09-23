"use client";

import { useTheme } from "@/hooks/useTheme";

export function MikuHeaderBanner() {
  const { theme } = useTheme();
  if (theme !== "miku") return null;

  return (
    <div className="relative mx-auto my-1 flex min-h-[38px] sm:min-h-[42px] w-full max-w-2xl shrink-0 items-center justify-between gap-3 px-3.5 sm:px-4 py-1.5 overflow-hidden rounded-xl border border-[#00f0ff]/40 bg-[#07131e]/90 shadow-[0_4px_20px_rgba(0,0,0,0.7),0_0_16px_rgba(0,240,255,0.25)] backdrop-blur-md">
      {/* Left Stage Indicator */}
      <div className="flex items-center gap-2 font-mono text-[11px] sm:text-xs select-none shrink-0">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#ff007f] opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#ff007f] shadow-[0_0_8px_#ff007f]" />
        </span>
        <span className="font-black tracking-wider text-[#00f0ff] drop-shadow-[0_0_8px_rgba(0,240,255,0.8)]">
          MIKU #01
        </span>
        <span className="text-[#39c5bb] font-bold text-[10px] hidden sm:inline">
          初音ミク • LIVE
        </span>
      </div>

      {/* Center Ticker / Marquee */}
      <div className="flex-1 mx-2 overflow-hidden select-none whitespace-nowrap">
        <div className="inline-block animate-[marquee_24s_linear_infinite] text-[10px] sm:text-[11px] font-sans text-[#a5f3fc]/90">
          <span className="text-[#ff007f] mx-2">🌸</span>
          <span className="font-mono text-[#00f0ff] font-bold">SENBONZAKURA STAGE</span>
          <span className="text-white/40 mx-2">|</span>
          <span className="text-pink-300 font-medium">千本桜 • 夜ニ紛レ • 君ノ声モ届カナイヨ</span>
          <span className="text-[#ff007f] mx-2">🌸</span>
          <span className="text-[#39c5bb]">VOCALOID #01 • 39's MAGICAL LIVE</span>
          <span className="text-white/40 mx-2">|</span>
          <span>Thêm bài hát yêu thích để cùng thưởng thức</span>
        </div>
      </div>

      {/* Right Cyber Badge */}
      <div className="font-mono text-[9px] sm:text-[10px] font-bold tracking-wider hidden sm:flex items-center gap-1 select-none shrink-0">
        <span className="px-2.5 py-0.5 rounded-full bg-[#ff007f]/20 border border-[#ff007f]/50 text-[#ff77b9] shadow-[0_0_8px_rgba(255,0,127,0.4)]">
          🌸 SENBONZAKURA
        </span>
      </div>
    </div>
  );
}

/** Glowing RGB Nekomimi (Cat Ears) perched atop the player */
export function MikuNekomimiEars() {
  return (
    <div className="pointer-events-none absolute -top-8 sm:-top-9 left-0 right-0 flex justify-between px-10 sm:px-16 z-20">
      {/* Left Cat Ear */}
      <div className="relative animate-nekomimi origin-bottom-left filter drop-shadow-[0_0_16px_rgba(0,240,255,0.9)]">
        <svg
          width="60"
          height="44"
          viewBox="0 0 60 44"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-12 h-9 sm:w-15 sm:h-11"
        >
          {/* Outer Ear Shell with soft organic curve */}
          <path
            d="M 6,42 C 4,28 10,12 28,3 C 31,1 34,2 36,6 C 41,16 48,30 54,42 Z"
            fill="#091424"
            stroke="#00f0ff"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          {/* Cyber Edge Highlight */}
          <path
            d="M 8,40 C 6,28 12,14 27,5"
            stroke="#00f0ff"
            strokeWidth="2.5"
            strokeLinecap="round"
            opacity="0.9"
          />
          {/* Inner Ear Soft Pastel / Neon Glow */}
          <path
            d="M 16,40 C 14,29 18,17 28,10 C 32,17 38,29 44,40 Z"
            fill="url(#leftEarGlow)"
            stroke="#ff007f"
            strokeWidth="1.5"
          />
          {/* Fluffy Anime Ear Highlight */}
          <path
            d="M 23,17 C 24,24 25,32 26,38"
            stroke="#ffffff"
            strokeWidth="1.8"
            strokeLinecap="round"
            opacity="0.9"
          />
          <path
            d="M 28,21 C 29,26 30,32 31,37"
            stroke="#ffffff"
            strokeWidth="1.2"
            strokeLinecap="round"
            opacity="0.75"
          />
          {/* Cyber Piercing Ring */}
          <circle cx="32" cy="4" r="2.8" stroke="#ff007f" strokeWidth="1.5" fill="#091424" />
          <defs>
            <linearGradient id="leftEarGlow" x1="28" y1="8" x2="28" y2="40" gradientUnits="userSpaceOnUse">
              <stop stopColor="#ff007f" stopOpacity="0.95" />
              <stop offset="0.5" stopColor="#ff3399" stopOpacity="0.8" />
              <stop offset="1" stopColor="#00f0ff" stopOpacity="0.35" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      {/* Right Cat Ear */}
      <div
        className="relative animate-nekomimi origin-bottom-right filter drop-shadow-[0_0_16px_rgba(255,0,127,0.9)]"
        style={{ animationDelay: "0.25s" }}
      >
        <svg
          width="60"
          height="44"
          viewBox="0 0 60 44"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-12 h-9 sm:w-15 sm:h-11"
        >
          {/* Outer Ear Shell with soft organic curve */}
          <path
            d="M 54,42 C 56,28 50,12 32,3 C 29,1 26,2 24,6 C 19,16 12,30 6,42 Z"
            fill="#091424"
            stroke="#ff007f"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          {/* Cyber Edge Highlight */}
          <path
            d="M 52,40 C 54,28 48,14 33,5"
            stroke="#ff007f"
            strokeWidth="2.5"
            strokeLinecap="round"
            opacity="0.9"
          />
          {/* Inner Ear Soft Pastel / Neon Glow */}
          <path
            d="M 44,40 C 46,29 42,17 32,10 C 28,17 22,29 16,40 Z"
            fill="url(#rightEarGlow)"
            stroke="#00f0ff"
            strokeWidth="1.5"
          />
          {/* Fluffy Anime Ear Highlight */}
          <path
            d="M 37,17 C 36,24 35,32 34,38"
            stroke="#ffffff"
            strokeWidth="1.8"
            strokeLinecap="round"
            opacity="0.9"
          />
          <path
            d="M 32,21 C 31,26 30,32 29,37"
            stroke="#ffffff"
            strokeWidth="1.2"
            strokeLinecap="round"
            opacity="0.75"
          />
          {/* Cyber Piercing Ring */}
          <circle cx="28" cy="4" r="2.8" stroke="#00f0ff" strokeWidth="1.5" fill="#091424" />
          <defs>
            <linearGradient id="rightEarGlow" x1="32" y1="8" x2="32" y2="40" gradientUnits="userSpaceOnUse">
              <stop stopColor="#00f0ff" stopOpacity="0.95" />
              <stop offset="0.5" stopColor="#39c5bb" stopOpacity="0.8" />
              <stop offset="1" stopColor="#ff007f" stopOpacity="0.35" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    </div>
  );
}
