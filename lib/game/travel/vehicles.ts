import { MAP_IDS, type MapId } from "@/lib/game/maps/types";

// v18.5 Đường ra chợ: the hall <-> Chợ Lớn trip and the vehicles that shorten it. Prices mirror 0027_vehicles.sql.

export type VehicleId = "bike" | "moto" | "car";
export interface Vehicle { id: VehicleId; name: string; price: number; tripMs: number; icon: string }

export const WALK_TRIP_MS = 15000;
export const SKIP_COST = 20;

export const VEHICLES: readonly Vehicle[] = [
  { id: "bike", name: "Xe đạp", price: 5000, tripMs: 10000, icon: "🚲" },
  { id: "moto", name: "Xe máy", price: 30000, tripMs: 5000, icon: "🛵" },
  { id: "car", name: "Xe hơi", price: 150000, tripMs: 2000, icon: "🚗" },
];

export function tripVehicle(owned: readonly string[]): Vehicle | null {
  let best: Vehicle | null = null;
  for (const v of VEHICLES) if (owned.includes(v.id) && (!best || v.tripMs < best.tripMs)) best = v;
  return best;
}

export const tripMs = (owned: readonly string[]): number => tripVehicle(owned)?.tripMs ?? WALK_TRIP_MS;

export const isRoadTrip = (from: MapId, to: MapId): boolean =>
  (from === "hall" && to === "market") || (from === "market" && to === "hall")
  // v19.2: Chợ Lớn <-> Khu nhà is a road too
  || (from === "market" && to === "khu_nha") || (from === "khu_nha" && to === "market");

/** The road cutscene scrolls forward (towards Chợ Lớn, then Khu nhà) or back (towards the hall). */
export const tripForward = (from: MapId, to: MapId): boolean => MAP_IDS.indexOf(to) > MAP_IDS.indexOf(from);
