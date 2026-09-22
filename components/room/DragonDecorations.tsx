"use client";

import { useTheme } from "@/hooks/useTheme";

export function DragonCorners({
  size = 62,
  className = "",
  allFour = false,
}: {
  size?: number;
  className?: string;
  allFour?: boolean;
}) {
  const { theme } = useTheme();
  if (theme !== "dragon") return null;

  return (
    <>
      {/* Top-Left Dragon Corner */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/themes/dragon/corner.png"
        alt=""
        aria-hidden="true"
        style={{
          width: size,
          height: size,
        }}
        className={`pointer-events-none absolute -top-2.5 -left-2.5 sm:-top-3 sm:-left-3 z-40 select-none object-contain drop-shadow-[0_4px_10px_rgba(0,0,0,0.85)] drop-shadow-[0_0_6px_rgba(212,175,55,0.25)] transition-all ${className}`}
      />
      {/* Top-Right Dragon Corner */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/themes/dragon/corner.png"
        alt=""
        aria-hidden="true"
        style={{
          width: size,
          height: size,
        }}
        className={`pointer-events-none absolute -top-2.5 -right-2.5 sm:-top-3 sm:-right-3 z-40 select-none -scale-x-100 object-contain drop-shadow-[0_4px_10px_rgba(0,0,0,0.85)] drop-shadow-[0_0_6px_rgba(212,175,55,0.25)] transition-all ${className}`}
      />
      {allFour && (
        <>
          {/* Bottom-Left Dragon Corner */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/themes/dragon/corner.png"
            alt=""
            aria-hidden="true"
            style={{
              width: size,
              height: size,
            }}
            className={`pointer-events-none absolute -bottom-2.5 -left-2.5 sm:-bottom-3 sm:-left-3 z-40 select-none -scale-y-100 object-contain drop-shadow-[0_4px_10px_rgba(0,0,0,0.85)] drop-shadow-[0_0_6px_rgba(212,175,55,0.25)] transition-all ${className}`}
          />
          {/* Bottom-Right Dragon Corner */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/themes/dragon/corner.png"
            alt=""
            aria-hidden="true"
            style={{
              width: size,
              height: size,
            }}
            className={`pointer-events-none absolute -bottom-2.5 -right-2.5 sm:-bottom-3 sm:-right-3 z-40 select-none -scale-x-100 -scale-y-100 object-contain drop-shadow-[0_4px_10px_rgba(0,0,0,0.85)] drop-shadow-[0_0_6px_rgba(212,175,55,0.25)] transition-all ${className}`}
          />
        </>
      )}
    </>
  );
}

export function DragonHeaderBanner() {
  const { theme } = useTheme();
  if (theme !== "dragon") return null;

  return (
    <div className="relative mx-auto my-1 flex h-10 sm:h-11 w-full max-w-lg shrink-0 items-center justify-center overflow-hidden rounded-xl border border-amber-400/40 bg-[#121016] shadow-[0_4px_16px_rgba(0,0,0,0.7),0_0_12px_rgba(212,175,55,0.15)]">
      {/* Background Dragon Relief - 100% clear and unobstructed */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/themes/dragon/header.png"
        alt="Song Long Chầu Nguyệt"
        className="h-full w-full object-cover object-center scale-105 opacity-95"
      />

      {/* Pure text with layered text-shadow - NO box covering the artwork */}
      <span
        className="pointer-events-none absolute bottom-1 font-playfair text-xs sm:text-[13px] font-black tracking-[0.28em] text-[#fff5cf] uppercase select-none flex items-center justify-center"
        style={{
          textShadow:
            "0 1px 2px #000, 0 2px 5px #000, 0 0 8px #000, 0 0 16px rgba(0,0,0,0.95)",
        }}
      >
        <span
          className="text-amber-300 mr-2"
          style={{ textShadow: "0 0 8px rgba(255,215,0,0.9), 0 2px 4px #000" }}
        >
          ❖
        </span>
        Long Phụng Hòa Minh
        <span
          className="text-amber-300 ml-2"
          style={{ textShadow: "0 0 8px rgba(255,215,0,0.9), 0 2px 4px #000" }}
        >
          ❖
        </span>
      </span>
    </div>
  );
}
