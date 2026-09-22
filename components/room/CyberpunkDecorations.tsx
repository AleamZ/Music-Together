"use client";

import { useTheme } from "@/hooks/useTheme";

export function CyberpunkCorners({
  size = 40,
  className = "",
  allFour = false,
}: {
  size?: number;
  className?: string;
  allFour?: boolean;
}) {
  const { theme } = useTheme();
  if (theme !== "cyberpunk") return null;

  return (
    <>
      {/* Top-Left Corner Bracket */}
      <div
        style={{ width: size, height: size }}
        className={`pointer-events-none absolute -top-1.5 -left-1.5 sm:-top-2 sm:-left-2 z-30 select-none ${className}`}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 40 40"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full filter drop-shadow-[0_0_6px_#00f0ff]"
        >
          {/* Outer L-bracket with corner cut */}
          <path
            d="M2 18 V6 L6 2 H18"
            stroke="#00f0ff"
            strokeWidth="2.5"
            strokeLinecap="square"
          />
          {/* Inner accent tick */}
          <path d="M8 12 V8 H12" stroke="#ff0055" strokeWidth="1.5" />
          {/* Corner target dot */}
          <circle cx="14" cy="14" r="1.5" fill="#00ff88" />
        </svg>
      </div>

      {/* Top-Right Corner Bracket */}
      <div
        style={{ width: size, height: size }}
        className={`pointer-events-none absolute -top-1.5 -right-1.5 sm:-top-2 sm:-right-2 z-30 select-none ${className}`}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 40 40"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full filter drop-shadow-[0_0_6px_#ff0055]"
        >
          {/* Outer L-bracket mirrored */}
          <path
            d="M38 18 V6 L34 2 H22"
            stroke="#ff0055"
            strokeWidth="2.5"
            strokeLinecap="square"
          />
          {/* Inner accent tick */}
          <path d="M32 12 V8 H28" stroke="#00f0ff" strokeWidth="1.5" />
          {/* Corner target dot */}
          <circle cx="26" cy="14" r="1.5" fill="#00ff88" />
        </svg>
      </div>

      {allFour && (
        <>
          {/* Bottom-Left Corner Bracket */}
          <div
            style={{ width: size, height: size }}
            className={`pointer-events-none absolute -bottom-1.5 -left-1.5 sm:-bottom-2 sm:-left-2 z-30 select-none ${className}`}
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 40 40"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="w-full h-full filter drop-shadow-[0_0_6px_#00f0ff]"
            >
              <path
                d="M2 22 V34 L6 38 H18"
                stroke="#00f0ff"
                strokeWidth="2.5"
                strokeLinecap="square"
              />
              <path d="M8 28 V32 H12" stroke="#ff0055" strokeWidth="1.5" />
              <circle cx="14" cy="26" r="1.5" fill="#00ff88" />
            </svg>
          </div>

          {/* Bottom-Right Corner Bracket */}
          <div
            style={{ width: size, height: size }}
            className={`pointer-events-none absolute -bottom-1.5 -right-1.5 sm:-bottom-2 sm:-right-2 z-30 select-none ${className}`}
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 40 40"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="w-full h-full filter drop-shadow-[0_0_6px_#ff0055]"
            >
              <path
                d="M38 22 V34 L34 38 H22"
                stroke="#ff0055"
                strokeWidth="2.5"
                strokeLinecap="square"
              />
              <path d="M32 28 V32 H28" stroke="#00f0ff" strokeWidth="1.5" />
              <circle cx="26" cy="26" r="1.5" fill="#00ff88" />
            </svg>
          </div>
        </>
      )}
    </>
  );
}

export function CyberpunkHeaderBanner() {
  const { theme } = useTheme();
  if (theme !== "cyberpunk") return null;

  return (
    <div className="relative mx-auto my-1 flex h-9 sm:h-10 w-full max-w-xl shrink-0 items-center justify-between px-3 sm:px-4 overflow-hidden rounded-lg border border-cyan-500/50 bg-[#070914]/90 shadow-[0_0_16px_rgba(0,240,255,0.25),inset_0_1px_0_rgba(0,240,255,0.4)] backdrop-blur-md">
      {/* Subtle Scanline Animation Effect */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(0,240,255,0.03)_50%,transparent_50%)] bg-[length:100%_4px]" />

      {/* Left System Status Tag */}
      <div className="flex items-center gap-2 font-mono text-[10px] sm:text-[11px] text-cyan-400 select-none">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 shadow-[0_0_6px_#00ff88]" />
        </span>
        <span className="font-bold tracking-wider text-cyan-300">SYS.ONLINE</span>
        <span className="text-cyan-600 hidden sm:inline">|</span>
        <span className="text-cyan-400/80 hidden sm:inline">AUDIO_CORE: v2.099</span>
      </div>

      {/* Center Glitch Title */}
      <div className="flex items-center gap-1.5 font-mono text-xs sm:text-[13px] font-extrabold tracking-[0.2em] uppercase select-none">
        <span className="text-pink-500 animate-pulse">//</span>
        <span
          className="bg-gradient-to-r from-cyan-300 via-fuchsia-400 to-pink-500 bg-clip-text text-transparent font-black"
          style={{
            filter: "drop-shadow(0 0 8px rgba(0,240,255,0.6))",
          }}
        >
          NEO TOKYO AUDIO NET
        </span>
        <span className="text-cyan-400 animate-pulse">//</span>
      </div>

      {/* Right Monospace Frequency / Channel */}
      <div className="font-mono text-[10px] sm:text-[11px] text-pink-400/90 tracking-widest hidden sm:flex items-center gap-1 select-none">
        <span className="text-cyan-500">CH:</span>
        <span className="text-pink-300 font-bold">2099.9-FM</span>
      </div>
    </div>
  );
}
