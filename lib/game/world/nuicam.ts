import type { Vec } from "@/lib/game/types";

// Pure: the one mountain of the flat delta (owner's Núi Cấm references, An Giang): a steep forested núi rising out of
// the paddies in the east, the mine tunnelling into its foot. On its slopes: a mountain lake with a path round it and a
// red arched footbridge over its inlet, a white seated Di Lặc statue on the hillside above the lake, a golden tiered
// tower and a red-roofed temple on the shore, a waterfall into a pool, a cable car from the foot to the summit, a summit
// viewpoint with a lamp over a sea of clouds, and the park's gate of stacked containers on the road in. The park's
// name is invented. World px; terrain.ts shapes the land from these, diorama/world/nuicam.ts builds the models.

/** The mountain: centre, radius (px) and height (units) — a steep bell, rounded at the top. */
export const NUI = { x: 3790, y: 1215, r: 330, h: 17 } as const;
/** The mountain lake: a flat terrace on the west slope. */
export const LAKE = { x: 3690, y: 1110, r: 46, level: 8.4 } as const;
/** The invented park's name on the gate. */
export const PARK_NAME = "KHU DU LỊCH NÚI MÂY XANH";

export const TEMPLE = { x: 3700, y: 1036, yaw: 0 } as const;
export const TOWER = { x: 3752, y: 1060 } as const;
export const DI_LAC = { x: 3760, y: 1150, yaw: 0.9 } as const;
/** The red footbridge across the lake's west inlet (its middle, heading, span px). */
export const FOOTBRIDGE = { x: 3643, y: 1112, yaw: 0, len: 44 } as const;
export const WATERFALL = { x: 3860, y: 1330, yaw: -0.4 } as const;
export const SUMMIT = { x: 3800, y: 1205 } as const;
/** The cable car: from the station at the foot up to the summit station. */
export const CABLE: { a: Vec; b: Vec } = { a: { x: 3520, y: 1420 }, b: { x: 3772, y: 1250 } };
/** The container gate across the road in (the mine road), at the mountain's foot. */
export const GATE = { x: 3470, y: 1232, yaw: Math.PI / 2 } as const;

/** The mountain's height above the plain at (x, y) (units): a bell with a lumpy crown; 0 far off. */
export function nuiHeight(x: number, y: number, noise: (x: number, y: number) => number): number {
  const d = Math.hypot(x - NUI.x, (y - NUI.y) * 1.15);
  if (d >= NUI.r) return 0;
  const u = 1 - d / NUI.r;
  const bell = u * u * (3 - 2 * u);
  return NUI.h * bell ** 1.25 * (1 + 0.12 * noise(x / 90, y / 90));
}

/** Solid structures on the mountain (circles, px) — the walker goes round them. */
export const NUI_SOLIDS: ReadonlyArray<{ x: number; y: number; r: number }> = [
  { x: TEMPLE.x, y: TEMPLE.y, r: 30 }, { x: TOWER.x, y: TOWER.y, r: 18 }, { x: DI_LAC.x, y: DI_LAC.y, r: 26 },
  { x: CABLE.a.x, y: CABLE.a.y, r: 22 }, { x: GATE.x, y: GATE.y - 32, r: 14 }, { x: GATE.x, y: GATE.y + 32, r: 14 },
];

/** A point `f` (0…1) along the cable (px), its sag below the straight line added by the caller. */
export function cableAt(f: number): Vec {
  return { x: CABLE.a.x + (CABLE.b.x - CABLE.a.x) * f, y: CABLE.a.y + (CABLE.b.y - CABLE.a.y) * f };
}
