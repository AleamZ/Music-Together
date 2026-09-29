"use client";

import type { Explore } from "@/hooks/useExplore";
import type { MapId } from "@/lib/game/maps/types";
import RowGame from "./RowGame";
import { ChestReveal, DetectorHud, ShovelGame } from "./TreasureHunt";

/** v22 (0086): the explore minigames over the world — Sông Cái's "⚓ Về bến" bar, the rowing, the detector, the dig and
 *  the chest. */
export default function ExploreOverlays({ explore: x, mapId, idle }: {
  explore: Explore;
  mapId: MapId;
  /** Nothing else holds the screen (no panel, no cast): the river's bar may show. */
  idle: boolean;
}) {
  return (
    <>
      {mapId === "song_cai" && idle && !x.row && (
        <div className="pointer-events-auto absolute bottom-24 left-1/2 z-10 flex -translate-x-1/2 gap-2">
          <span className="pch hidden px-2 py-1 font-vt text-lg sm:inline">🛶 E: quăng cần ở chỗ ghe đang đậu</span>
          <button type="button" className="pch-btn text-xl" onClick={x.rowHome}>⚓ Chèo về bến</button>
        </div>
      )}
      {x.detector && !x.dig && !x.chest && (
        <DetectorHud view={x.detector} busy={x.dig !== null} onDig={x.digHere} onStop={x.stopDetect} />
      )}
      {x.row && <RowGame view={x.row} onEnd={x.rowEnd} onClose={x.closeRow} />}
      {x.dig && <ShovelGame view={x.dig} onEnd={x.digEnd} onClose={x.closeDig} />}
      {x.chest && <ChestReveal view={x.chest} onClose={x.closeChest} />}
    </>
  );
}
