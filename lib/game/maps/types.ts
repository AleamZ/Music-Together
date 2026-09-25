import type { Facing, Look, Vec } from "@/lib/game/types";

export interface Rect { x: number; y: number; w: number; h: number }
export interface Spot { x: number; y: number; dir: Facing }

export type MapId = "hall" | "pond" | "field";
export const MAP_IDS: readonly MapId[] = ["hall", "pond", "field"];

export type InteractKind =
  | "dj_booth" | "notice_board" | "portal" | "fish_spot" | "dig_spot" | "depot" | "shop" | "records"
  | "plot" | "coop" | "farm_shop" | "rice_depot" | "drying";

export interface Interactable {
  /** Unique per map: "dock_sign", "fish_3", … */
  id: string;
  kind: InteractKind;
  /** What it is ("Bến câu cá"). */
  label: string;
  /** The action, shown as "E · {prompt}". */
  prompt: string;
  /** Click target. */
  rect: Rect;
  /** Where the character stands to use it. */
  use: Vec;
  /** fish_spot: the direction of the water. */
  face?: Facing;
  /** portal: where it leads. */
  to?: { map: MapId; arrive: Spot };
  /** plot: its number (1–10). */
  plot?: number;
}

/** A rice plot on the field (v15): its number, its land and where its name post stands. */
export interface PlotGeom { no: number; kind: "private" | "village"; rect: Rect; post: Vec }

/** A shopkeeper: a static character with a name tag. */
export interface Npc { id: string; name: string; look: Look; spot: Spot }

/** Things that are drawn as depth-sorted sprites (anchor = base point, sort by y). */
export type PropPlacement =
  | { kind: "palm"; x: number; y: number; h: number; lean: number; seed: number }
  | { kind: "hammock"; x: number; y: number; x2: number }
  | { kind: "post"; x: number; y: number }
  | { kind: "table"; x: number; y: number }
  | { kind: "mixer"; x: number; y: number }
  | { kind: "board"; x: number; y: number }
  | { kind: "sign"; x: number; y: number; icon?: "fish" | "note" | "rice" }
  | { kind: "banana"; x: number; y: number }
  | { kind: "lightpole"; x: number; y: number }
  | { kind: "stall_front"; x: number; y: number }
  | { kind: "hut_front"; x: number; y: number }
  | { kind: "records"; x: number; y: number }
  | { kind: "namepost"; x: number; y: number }
  | { kind: "coop_front"; x: number; y: number }
  | { kind: "farmshop_front"; x: number; y: number }
  | { kind: "ricedepot_front"; x: number; y: number }
  | { kind: "pump"; x: number; y: number }
  | { kind: "haystack"; x: number; y: number }
  | { kind: "scarecrow"; x: number; y: number };

/** Where classic-mode members are shown (the hall only). */
export interface Seating {
  /** A classic-mode DJ stands behind the mixer. */
  djSpot: Spot;
  /** Other classic-mode members, behind the café tables. */
  seats: Spot[];
  /** Overflow when every seat is taken. */
  standSpots: Spot[];
}

export interface GameMap {
  id: MapId;
  width: number;
  height: number;
  cell: number;
  cols: number;
  rows: number;
  /** cols × rows, 1 = blocked. */
  blocked: Uint8Array;
  /** Where you appear when nothing else says so (entering game mode, a lost arrival). */
  spawn: Spot;
  seating: Seating | null;
  interactables: Interactable[];
  props: PropPlacement[];
  npcs: Npc[];
  /** Rice plots (the field only). */
  plots: PlotGeom[];
}
