"use client";

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

export default function Turntable({ spinning, thumbnail }: { spinning: boolean; thumbnail?: string | null }) {
  const { theme } = useTheme();
  if (theme === "cozy") return <CozyRadio spinning={spinning} thumbnail={thumbnail} />;
  return <VinylDisc spinning={spinning} thumbnail={thumbnail} />;
}
