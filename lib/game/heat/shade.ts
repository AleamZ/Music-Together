import type { MapId, Rect } from "@/lib/game/maps/types";
import type { Vec } from "@/lib/game/types";

// v18.10: where the heat does not reach — the porch of each shop, depot and the restaurant (the building's rect down to
// 14 px past its use point). Mirrors `_in_shade` (0033_heat_swim.sql; latest 0050_dojo.sql); tests/unit/heat.test.ts pins them equal and checks
// each porch covers its interactable's use point. Every other spot of a map is outdoors.

export const SHADE_RECTS: Readonly<Record<MapId, readonly Rect[]>> = {
  hall: [],
  pond: [{ x: 522, y: 64, w: 104, h: 90 }, { x: 522, y: 228, w: 104, h: 94 }],
  field: [{ x: 588, y: 288, w: 84, h: 70 }, { x: 700, y: 288, w: 88, h: 70 }],
  khu_nha: [],                               // v19.2: no porches (0041's _in_shade)
  market: [
    { x: 100, y: 130, w: 80, h: 60 }, { x: 460, y: 130, w: 80, h: 60 }, { x: 244, y: 108, w: 152, h: 82 },
    { x: 640, y: 130, w: 80, h: 60 }, { x: 40, y: 304, w: 80, h: 70 }, { x: 680, y: 304, w: 80, h: 70 },
    { x: 860, y: 248, w: 120, h: 36 },          // v20.2: the Võ đường's gate roof (0050's _in_shade)
  ],
};

/** Is `p` (world px, rounded like the heartbeat sends it) in the shade of map `map`? */
export function inShade(map: MapId, p: Vec): boolean {
  const x = Math.round(p.x), y = Math.round(p.y);
  return SHADE_RECTS[map].some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
}
