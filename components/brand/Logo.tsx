"use client";

import Image from "next/image";
import logo from "@/public/logo.png";
import { useTheme } from "@/hooks/useTheme";
import PixelLogo from "./PixelLogo";

export default function Logo({ size = 32, withWordmark = true }: { size?: number; withWordmark?: boolean }) {
  const { theme } = useTheme();
  return (
    <span className="inline-flex items-center gap-2">
      {theme === "cozy" ? (
        <PixelLogo size={size} />
      ) : theme === "dragon" ? (
        <span
          className="relative inline-block overflow-hidden rounded-full border-2 border-gold shadow-[0_0_10px_rgba(245,158,11,0.6)]"
          style={{ width: size, height: size }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/themes/dragon/emblem.jpg"
            alt="Long Phụng"
            className="h-full w-full object-cover"
          />
        </span>
      ) : (
        <Image
          src={logo}
          alt="Music Together"
          height={size}
          width={Math.round((size * 3) / 2)}
          style={{ height: size, width: "auto" }}
          preload={true}
        />
      )}
      {withWordmark && (
        <span
          className={`font-playfair text-2xl font-bold ${
            theme === "dragon"
              ? "bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-500 bg-clip-text text-transparent drop-shadow-[0_2px_8px_rgba(220,38,38,0.7)] tracking-wide"
              : "text-burgundy"
          }`}
        >
          Music Together
        </span>
      )}
    </span>
  );
}
