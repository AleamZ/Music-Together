"use client";

import type { FishingController } from "@/hooks/useFishingController";
import BagPanel from "./BagPanel";
import CatchCard from "./CatchCard";
import DepotPanel from "./DepotPanel";
import RecordsPanel from "./RecordsPanel";
import ReelOverlay from "./ReelOverlay";
import ShopPanel from "./ShopPanel";

/** Fishing on top of the world (spec §6.1, §10): "🎣 Thu cần" while waiting, "❗ Giật cần!" at the bite, the reel, the
 *  catch card and the four fishing panels. */
export default function FishingOverlays({ fishing }: { fishing: FishingController }) {
  const { cast, caught, panel, busy, closePanel } = fishing;
  const { state, catalog } = fishing.data;
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
      {panel === "bag" && (
        <BagPanel state={state} catalog={catalog} busy={busy} onEquip={fishing.equip} onRelease={fishing.release} onClose={closePanel} />
      )}
      {panel === "depot" && <DepotPanel state={state} catalog={catalog} busy={busy} onSell={fishing.sell} onClose={closePanel} />}
      {panel === "shop" && <ShopPanel state={state} catalog={catalog} busy={busy} onBuy={fishing.buy} onClose={closePanel} />}
      {panel === "records" && <RecordsPanel catalog={catalog} load={fishing.loadBoard} onClose={closePanel} />}
    </>
  );
}
