"use client";

import { useTheme } from "@/hooks/useTheme";

export function LofiHeaderBanner() {
  const { theme } = useTheme();
  if (theme !== "lofi") return null;

  return (
    <div className="relative mx-auto my-1 flex h-9 sm:h-10 w-full max-w-xl shrink-0 items-center justify-between px-3 sm:px-4 overflow-hidden rounded-lg border border-[#d97706]/40 bg-[#1e130c]/90 shadow-[0_4px_16px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(245,158,11,0.2)] backdrop-blur-md">
      {/* Left Cafe Status */}
      <div className="flex items-center gap-2 font-serif text-[11px] sm:text-xs text-[#fef3c7] select-none shrink-0">
        <span className="text-amber-400">☕</span>
        <span className="font-semibold text-[#fbbf24]">Gác Mái Chiều Mưa</span>
        <span className="text-amber-700/60 hidden sm:inline">|</span>
        <span className="text-amber-200/80 font-normal hidden sm:inline text-[11px]">21°C • Mưa rơi rả rích</span>
      </div>

      {/* Center Ticker / Marquee */}
      <div className="flex-1 mx-3 overflow-hidden select-none whitespace-nowrap">
        <div className="inline-block animate-[marquee_24s_linear_infinite] text-[10px] sm:text-[11px] font-sans text-[#f4ebd9]/90">
          <span className="text-amber-400 mx-2">🌧️</span>
          <span>Tiếng mưa rơi trên mái ngói & tách cà phê ấm nóng</span>
          <span className="text-amber-400 mx-2">☕</span>
          <span className="text-[#fbbf24] font-medium">Chúc bạn có những phút giây thư giãn tuyệt vời cùng âm nhạc</span>
          <span className="text-amber-400 mx-2">🎧</span>
          <span>Thêm bài hát yêu thích để cùng thưởng thức</span>
        </div>
      </div>

      {/* Right Mood Badge */}
      <div className="font-mono text-[9px] sm:text-[10px] text-amber-200/90 font-medium tracking-wider hidden sm:flex items-center gap-1 select-none shrink-0">
        <span className="px-2 py-0.5 rounded-full bg-amber-950/80 border border-amber-600/40 text-amber-300">
          LO-FI BEATS
        </span>
      </div>
    </div>
  );
}
