"use client";

import { useTheme } from "@/hooks/useTheme";

export function ITVCorners({
  size = 36,
  className = "",
  allFour = false,
}: {
  size?: number;
  className?: string;
  allFour?: boolean;
}) {
  // Discarded per user feedback: retro iTV broadcast should not have sci-fi cyberpunk HUD brackets
  return null;
}

export function ITVHeaderBanner() {
  const { theme } = useTheme();
  if (theme !== "itv") return null;

  return (
    <div className="relative mx-auto my-1 flex h-9 sm:h-10 w-full max-w-xl shrink-0 items-center justify-between px-3 sm:px-4 overflow-hidden rounded-lg border border-[#76cb00]/50 bg-[#080d16]/95 shadow-[0_0_16px_rgba(118,203,0,0.3),inset_0_1px_0_rgba(132,232,0,0.4)] backdrop-blur-md">
      {/* Left Broadcast Status */}
      <div className="flex items-center gap-2 font-mono text-[10px] sm:text-[11px] text-[#84e800] select-none shrink-0">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-80" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-600 shadow-[0_0_6px_#ff0033]" />
        </span>
        <span className="font-extrabold tracking-wider text-red-400">TRỰC TIẾP</span>
        <span className="text-[#76cb00]/60 hidden sm:inline">|</span>
        <span className="text-white font-bold hidden sm:inline">KÊNH iTV - VTC13</span>
      </div>

      {/* Center Ticker / Marquee */}
      <div className="flex-1 mx-3 overflow-hidden select-none whitespace-nowrap">
        <div className="inline-block animate-[marquee_20s_linear_infinite] text-[10px] sm:text-[11px] font-sans font-bold text-white/90">
          <span className="text-[#84e800] mx-2">❖</span>
          <span>TỔNG ĐÀI BÌNH CHỌN & YÊU CẦU BÀI HÁT: SOẠN</span>
          <span className="text-[#ffcc00] font-black mx-1.5 px-1.5 py-0.5 rounded bg-black/60 border border-[#ffcc00]/40">ITV &lt;MÃ BÀI HÁT&gt; GỬI 8730</span>
          <span className="text-[#84e800] mx-2">❖</span>
          <span>CHÚC CÁC BẠN CÓ NHỮNG GIÂY PHÚT NGHE NHẠC VUI VẺ!</span>
        </div>
      </div>

      {/* Right Channel Badge */}
      <div className="font-mono text-[10px] sm:text-[11px] text-[#84e800] font-black tracking-widest hidden sm:flex items-center gap-1 select-none shrink-0">
        <span className="px-1.5 py-0.5 rounded bg-[#76cb00]/20 border border-[#76cb00]/40">iTV-HD</span>
      </div>
    </div>
  );
}
