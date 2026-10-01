import type { Metadata } from "next";
import { notFound } from "next/navigation";
import MobileHudDemo from "@/components/game/hud/MobileHudDemo";
import { IS_PROD } from "@/lib/app-mode";

// Dev only: the compact phone HUD (☰ drawer, sheets, stick) with mocked data — for layout checks at phone landscape
// sizes. A 404 in prod mode.

export const metadata: Metadata = { title: "HUD điện thoại (dev)", robots: { index: false, follow: false } };

export default function MobileHudPage() {
  if (IS_PROD) notFound();
  return <MobileHudDemo />;
}
