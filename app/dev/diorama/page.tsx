import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CharacterLabPanel from "@/components/game/diorama/CharacterLab";
import DioramaPreview from "@/components/game/diorama/DioramaPreview";
import { IS_PROD } from "@/lib/app-mode";

// Dev only: the pond ("Ao cá") as a 3D diorama with a fake player, no login, plus the 3D character lab (#lab). A 404 in prod mode.

export const metadata: Metadata = { title: "Ao cá — diorama 3D", robots: { index: false, follow: false } };

export default function DioramaPage() {
  if (IS_PROD) notFound();
  return (
    <>
      <DioramaPreview />
      <CharacterLabPanel />
    </>
  );
}
