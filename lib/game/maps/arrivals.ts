import type { Spot } from "./types";

// Where the portals drop you. Kept apart from the maps so hall.ts and pond.ts never import each other.

/** On the hall's dock, in front of the "Bến câu cá" sign. */
export const HALL_DOCK_ARRIVE: Spot = { x: 516, y: 334, dir: "up" };

/** At the pond's entrance, beside the "Bến vào" sign. */
export const POND_ARRIVE: Spot = { x: 300, y: 356, dir: "up" };

/** At the field's west entrance ("Đường làng"), beside the "Về sảnh" sign, facing into the field. */
export const FIELD_WEST_ARRIVE: Spot = { x: 60, y: 106, dir: "right" };

/** At the field's east entrance ("Cầu khỉ"), beside the "Về ao cá" sign. */
export const FIELD_EAST_ARRIVE: Spot = { x: 760, y: 244, dir: "left" };

/** In the hall, at the "Ra đồng" sign on the west edge. */
export const HALL_FIELD_ARRIVE: Spot = { x: 62, y: 236, dir: "left" };

/** At the pond, at the "Cầu khỉ ra đồng" sign in the south-west. */
export const POND_FIELD_ARRIVE: Spot = { x: 190, y: 348, dir: "down" };

/** At Chợ Lớn's west entrance, beside the "Về sảnh" sign, facing into the street (v18.4). */
export const MARKET_ARRIVE: Spot = { x: 72, y: 252, dir: "right" };

/** In the hall, at the "Chợ Lớn" sign on the east edge (v18.4). */
export const HALL_MARKET_ARRIVE: Spot = { x: 584, y: 224, dir: "left" };

/** At Khu nhà's west entrance, beside the "Về Chợ Lớn" sign, facing into the street (v19.2). */
export const KHU_NHA_ARRIVE: Spot = { x: 68, y: 208, dir: "right" };

/** At Chợ Lớn's east alley, by the "Khu nhà" sign (v19.2). */
export const MARKET_EAST_ARRIVE: Spot = { x: 1206, y: 204, dir: "left" };   // the market is 1280 wide
