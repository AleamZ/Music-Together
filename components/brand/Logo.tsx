"use client";

import Image from "next/image";
import logo from "@/public/logo.png";
import { useTheme } from "@/hooks/useTheme";
import PixelLogo from "./PixelLogo";

export default function Logo({ size = 32, withWordmark = true }: { size?: number; withWordmark?: boolean }) {
  const { theme } = useTheme();
  return (
    <span className="inline-flex items-center gap-2">
      {theme === "cozy"
        ? <PixelLogo size={size} />
        : <Image src={logo} alt="Music Together" height={size} width={Math.round((size * 3) / 2)}
            style={{ height: size, width: "auto" }} preload={true} />}
      {withWordmark && <span className="font-playfair text-2xl font-bold text-burgundy">Music Together</span>}
    </span>
  );
}
