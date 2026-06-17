"use client";

import Image from "next/image";
import logo from "@/public/logo.png";
import { useTheme } from "@/hooks/useTheme";
import PixelLogo from "./PixelLogo";

export default function BrandSpinner({ label = "Đang tải…" }: { label?: string }) {
  const { theme } = useTheme();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3">
      <span className="animate-brand-pulse">
        {theme === "cozy"
          ? <PixelLogo size={72} />
          : <Image src={logo} alt="" height={72} width={108} style={{ height: 72, width: "auto" }} preload={true} />}
      </span>
      <p className="font-cormorant text-burgundy">{label}</p>
    </main>
  );
}
