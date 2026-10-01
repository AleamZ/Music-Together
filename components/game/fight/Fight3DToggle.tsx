"use client";

import { useSyncExternalStore } from "react";
import { readFight3D, subscribeFight3D, writeFight3D } from "@/lib/game/fight/render/fight-view3d";

/** The 2D / 3D switch of the fight previews (per browser). */
export default function Fight3DToggle() {
  const on = useSyncExternalStore(subscribeFight3D, readFight3D, () => false);
  return (
    <button type="button" className="pch-btn px-2 py-0.5 text-sm" aria-pressed={on} onClick={() => writeFight3D(!on)} title="Xem thế võ dạng 3D">
      {on ? "Xem 2D" : "Xem 3D"}
    </button>
  );
}
