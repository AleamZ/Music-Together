import type { Metadata } from "next";
import { notFound } from "next/navigation";
import WorldPreview, { type WorldPreviewInit } from "@/components/game/diorama/WorldPreview";
import { IS_PROD } from "@/lib/app-mode";

// Dev only: the unified world in 3D (overview / follow a walker / free-fly), no login. A 404 in prod mode.

export const metadata: Metadata = { title: "Thế giới — 3D", robots: { index: false, follow: false } };

const KEYS = ["mode", "hour", "weather", "q", "speed", "panel"] as const;

export default async function WorldPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (IS_PROD) notFound();
  const sp = await searchParams;
  const init: WorldPreviewInit = {};
  for (const k of KEYS) { const v = sp[k]; if (typeof v === "string") init[k] = v; }
  return <WorldPreview init={init} />;
}
