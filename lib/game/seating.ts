import type { Spot } from "@/lib/game/maps/types";

/** Deterministic placement of classic-mode members (every client computes the same result):
 *  ids sorted ascending take the seats in order, the rest cycle through the stand spots. */
export function assignSpots(classicIds: string[], seats: Spot[], standSpots: Spot[]): Map<string, Spot> {
  const out = new Map<string, Spot>();
  const ids = [...new Set(classicIds)].sort();
  ids.forEach((id, i) => {
    if (i < seats.length) out.set(id, seats[i]);
    else if (standSpots.length > 0) out.set(id, standSpots[(i - seats.length) % standSpots.length]);
  });
  return out;
}
