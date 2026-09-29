import type { Metadata } from "next";
import { notFound } from "next/navigation";
import WorldGameDev from "@/components/game/diorama/WorldGameDev";
import { IS_PROD } from "@/lib/app-mode";

// Dev only: the real game engine in P2 world mode (one world map, zone channels, the 3D world view) against a local fake
// presence — no login, no network. Walk hall → market → pond → field → Bãi đất → the mine mouth → the cave → back.
// A 404 in prod mode.

export const metadata: Metadata = { title: "Thế giới — game (dev)", robots: { index: false, follow: false } };

export default function WorldGamePage() {
  if (IS_PROD) notFound();
  return <WorldGameDev />;
}
