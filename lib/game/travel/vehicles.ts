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

/** P3 (0089 vehicle_catalog.speed_mul): how many times the walking speed a vehicle rides the unified world, from its old
 *  trip (walking it took WALK_TRIP_MS): 1 + 2 × (15000 − tripMs) / 13000, capped at 3, 2 decimals — bike 1.77, moto 2.54,
 *  car 3. */
export const speedMul = (tripMs: number): number =>
  Math.round(Math.min(3, Math.max(1, 1 + (2 * (WALK_TRIP_MS - tripMs)) / 13000)) * 100) / 100;

/** P3: each vehicle's speed_mul. */
export const WORLD_RIDE_SPEED: Readonly<Record<VehicleId, number>> = Object.fromEntries(
  VEHICLES.map((v) => [v.id, speedMul(v.tripMs)]),
) as Record<VehicleId, number>;

export const isRoadTrip = (from: MapId, to: MapId): boolean =>
  (from === "hall" && to === "market") || (from === "market" && to === "hall")
  // v19.2: Chợ Lớn <-> Khu nhà is a road too
  || (from === "market" && to === "khu_nha") || (from === "khu_nha" && to === "market");

/** The road cutscene scrolls forward (towards Chợ Lớn, then Khu nhà) or back (towards the hall). */
export const tripForward = (from: MapId, to: MapId): boolean => MAP_IDS.indexOf(to) > MAP_IDS.indexOf(from);
