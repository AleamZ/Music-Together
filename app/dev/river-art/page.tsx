import type { Metadata } from "next";
import { notFound } from "next/navigation";
import RiverArtPreview from "@/components/game/river/RiverArtPreview";
import { IS_PROD } from "@/lib/app-mode";

// Dev only: Sông Cái painted, boats on it, and the rowing / dig minigames with fixed seeds. A 404 in prod mode.

export const metadata: Metadata = { title: "Sông Cái — art", robots: { index: false, follow: false } };

export default function RiverArtPage() {
  if (IS_PROD) notFound();
  return <RiverArtPreview />;
}
