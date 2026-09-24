import type { Facing, Vec } from "@/lib/game/types";

export interface Rect { x: number; y: number; w: number; h: number }
export interface Spot { x: number; y: number; dir: Facing }

export type InteractId = "dj_booth" | "notice_board" | "dock_sign";
export interface Interactable { id: InteractId; label: string; rect: Rect; use: Vec }

/** Things that are drawn as depth-sorted sprites (anchor = base point, sort by y). */
export type PropPlacement =
  | { kind: "palm"; x: number; y: number; h: number; lean: number; seed: number }
  | { kind: "hammock"; x: number; y: number; x2: number }
  | { kind: "post"; x: number; y: number }
  | { kind: "table"; x: number; y: number }
  | { kind: "mixer"; x: number; y: number }
  | { kind: "board"; x: number; y: number }
  | { kind: "sign"; x: number; y: number }
  | { kind: "banana"; x: number; y: number }
  | { kind: "lightpole"; x: number; y: number };

export interface GameMap {
  id: string;
  width: number;
  height: number;
  cell: number;
  cols: number;
  rows: number;
  /** cols × rows, 1 = blocked. */
  blocked: Uint8Array;
  spawn: Vec;
  /** Where a classic-mode DJ is shown (behind the mixer). */
  djSpot: Spot;
  /** Where other classic-mode members are shown (behind café tables). */
  seats: Spot[];
  /** Overflow spots when every seat is taken. */
  standSpots: Spot[];
  interactables: Interactable[];
  props: PropPlacement[];
}
