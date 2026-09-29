import type { Spot } from "@/lib/game/maps/types";

// The mine mouth (P2, owner: "phần mỏ thì làm ngầm dưới lòng đất"): Mỏ đá is underground — an interior entered from a
// tunnel on the eastern hills, where its plateau used to be. Pure data, world px; wild.ts makes it collision and an
// interactable, terrain.ts gives it its apron and hill, scenery.ts its landmark. Apart from wild.ts so terrain.ts can read
// it without a cycle.

/** The mine mouth on the eastern hills: a timber-framed tunnel into the hillside (MINE_HILL), facing west down the road
 *  from Bãi đất; the headframe stands on the hill above. World px. `use`: where one stands to go down. */
export const MINE = {
  mouth: { x: 3652, y: 1232 },
  use: { x: 3624, y: 1232 },
  /** Back up from the cave: just outside the mouth, facing down the road. */
  exit: { x: 3600, y: 1232, dir: "left" } as Spot,
  /** The flat apron before the mouth: its centre, radius (px) and height (3D units). */
  pad: { x: 3606, y: 1232, r: 64, elev: 7.4 },
} as const;

/** The hill the tunnel runs into (a blocked knoll: terrain.ts KNOLLS lists it). */
export const MINE_HILL = { x: 3746, y: 1232, r: 92 } as const;

/** The mouth's timber frame and the rock round it (blocked; the door is the interactable in front). */
export const MINE_SOLID = { x: 3640, y: 1204, w: 40, h: 56 } as const;

