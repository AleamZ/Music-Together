"use client";

import type { FishingController } from "@/hooks/useFishingController";
import CatchCard from "./CatchCard";
import ReelOverlay from "./ReelOverlay";

/** The cast's HUD (spec §6.1, §10): "🎣 Thu cần" while waiting, "❗ Giật cần!" at the bite, the reel, the catch card. */
export default function FishingOverlays({ fishing }: { fishing: FishingController }) {
  const { cast, caught } = fishing;
  const catalog = fishing.data.catalog;
  const name = caught ? catalog?.species.find((s) => s.id === caught.fish.speciesId)?.name ?? caught.fish.speciesId : "";
  return (
    <>
      {cast.phase === "waiting" && (
        <button type="button" onClick={fishing.reelIn} className="pch-btn absolute bottom-24 left-1/2 z-10 -translate-x-1/2 text-xl">
          🎣 Thu cần <span className="pointer-coarse:hidden">(Esc)</span>
        </button>
      )}
      {cast.phase === "bite" && (
        <button
          type="button"
          onClick={fishing.hook}
          className="pch-btn pch-btn-primary absolute bottom-24 left-1/2 z-10 -translate-x-1/2 animate-pulse px-6 py-3 text-3xl motion-reduce:animate-none"
        >
          ❗ Giật cần! <span className="pointer-coarse:hidden text-xl">(Space)</span>
        </button>
      )}
      {cast.phase === "reeling" && <ReelOverlay params={cast.params} rarity={cast.info.rarity} onDone={fishing.reelDone} />}
      {caught && <CatchCard fish={caught.fish} name={name} record={caught.record} onClose={fishing.dismissCatch} />}
    </>
  );
}
