"use client";

import { ratChipLabel, ratChipText } from "@/lib/game/farm/messages";

/** The field's rat season chip (v17 §12.1), under the map counts while rats are live: it opens the handbook at
 *  "Chuột, chó & ná". Nothing while there are none. */
export default function RatChip({ live, onOpen }: { live: number; onOpen: () => void }) {
  if (live < 1) return null;
  return (
    <button type="button" className="pch-btn pointer-events-auto font-vt text-lg" aria-label={ratChipLabel(live)} onClick={onOpen}>
      {ratChipText(live)}
    </button>
  );
}
