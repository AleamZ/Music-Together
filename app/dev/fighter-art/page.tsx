import type { Metadata } from "next";
import { notFound } from "next/navigation";
import FighterArtPreview from "@/components/game/fight/FighterArtPreview";
import { IS_PROD } from "@/lib/app-mode";

// Dev only: the fighter painters side by side (rig vs the chibi prototype). A 404 in prod mode (lib/app-mode.ts).

export const metadata: Metadata = { title: "Võ đài — rig vs chibi", robots: { index: false, follow: false } };

export default function FighterArtPage() {
  if (IS_PROD) notFound();
  return <FighterArtPreview />;
}
