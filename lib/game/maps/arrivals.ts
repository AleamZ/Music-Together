import type { Spot } from "./types";

// Where the portals drop you. Kept apart from the maps so hall.ts and pond.ts never import each other.

/** On the hall's dock, in front of the "Bến câu cá" sign. */
export const HALL_DOCK_ARRIVE: Spot = { x: 516, y: 334, dir: "up" };

/** At the pond's entrance, beside the "Bến vào" sign. */
export const POND_ARRIVE: Spot = { x: 300, y: 356, dir: "up" };
