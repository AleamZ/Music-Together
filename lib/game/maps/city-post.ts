import type { Interactable, PropPlacement, Rect } from "./types";

// "Cọc bản đồ thành phố": every map has one signpost showing the town overview (view only).

/** The signpost standing with its base at (x, y): the interactable (used from just south of it), its prop and its solid
 *  base (so the character walks around it). */
export function cityMapPost(x: number, y: number): { interactable: Interactable; prop: PropPlacement; solid: Rect } {
  return {
    interactable: {
      id: "city_map", kind: "city_map", label: "Bản đồ thành phố", prompt: "Xem bản đồ thành phố",
      rect: { x: x - 11, y: y - 32, w: 22, h: 32 }, use: { x, y: y + 12 }, face: "up",
    },
    prop: { kind: "city_map_post", x, y },
    solid: { x: x - 6, y: y - 6, w: 12, h: 8 },
  };
}
