import type { Metadata } from "next";
import { notFound } from "next/navigation";
import GroundbaitPreview from "@/components/game/fishing/GroundbaitPreview";
import { IS_PROD } from "@/lib/app-mode";

// Dev only: ổ thính (0117) drawn on Ao làng in 2D — the patches, the bubbles, the labels, the minimap dots and the HUD
// line. A 404 in prod mode.

export const metadata: Metadata = { title: "Ổ thính — art", robots: { index: false, follow: false } };

export default function GroundbaitArtPage() {
  if (IS_PROD) notFound();
  return <GroundbaitPreview />;
}
