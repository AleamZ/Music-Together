import type { InteractKind, MapId } from "@/lib/game/maps/types";
import type { VehicleId } from "@/lib/game/travel/vehicles";

// v18.7: riding a vehicle around the maps. Cosmetic + faster walking; no interactions but portals while riding.

export const RIDE_SPEED: Record<VehicleId, number> = { bike: 1.6, moto: 2.2, car: 2.8 };
export const RIDE_KEY = "r";

export const isVehicleId = (v: unknown): v is VehicleId => v === "bike" || v === "moto" || v === "car";
export const canRide = (map: MapId, v: VehicleId): boolean => !(map === "pond" && v === "car") && map !== "ham_ngam";   // v20.4: no vehicle down a manhole
export const rideSpeed = (v: VehicleId | null): number => (v ? RIDE_SPEED[v] : 1);
export const interactBlocked = (riding: VehicleId | null, kind: InteractKind): boolean => riding !== null && kind !== "portal";

/** The owned vehicle ids, fastest first. */
export const ownedVehicles = (owned: readonly string[]): VehicleId[] =>
  (["car", "moto", "bike"] as const).filter((v) => owned.includes(v));

/** What the R key mounts: the last vehicle used if I still own it, else the fastest owned; null when I own none. */
export const pickMount = (owned: readonly string[], last: VehicleId | null): VehicleId | null =>
  last && owned.includes(last) ? last : ownedVehicles(owned)[0] ?? null;

export const CAR_POND_TEXT = "Xe hơi không chạy vào ao được!";
export const STARVING_RIDE_TEXT = "Đói/khát quá, không lái xe nổi!";
export const CAR_LEFT_TEXT = "Đã xuống xe — xe hơi để ngoài ao.";
export const HAM_RIDE_TEXT = "Dưới hầm chật lắm, không đi xe được!";

/** Why mounting `v` is refused: a toast, "" for a silent refusal (busy: fishing, farm work, a card seat, the road, a
 *  faint), or null when it is allowed. */
export function mountRefusal(o: { map: MapId; v: VehicleId; starving: boolean; busy: boolean }): string | null {
  if (o.busy) return "";
  if (!canRide(o.map, o.v)) return o.map === "ham_ngam" ? HAM_RIDE_TEXT : CAR_POND_TEXT;
  if (o.starving) return STARVING_RIDE_TEXT;
  return null;
}

/** The prompt and the toast for an interaction while riding. */
export const dismountText = (label: string): string => "Xuống xe để " + label.toLowerCase() + " nhé!";
