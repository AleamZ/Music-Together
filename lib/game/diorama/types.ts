import type { Frame } from "@/lib/game/art/layers";
import type { WeatherFx } from "@/lib/game/art/weather";
import type { Facing, Look, Vec } from "@/lib/game/types";
import type { WeatherKind } from "@/lib/game/weather/model";
import type { CharAct } from "./character/pose";
import type { PetSpecies } from "@/lib/game/pets/catalog";

/** A character drawn as a camera-facing billboard (its 24×48 chibi frame). */
export interface Billboard {
  id: string;
  look: Look;
  /** Feet, map px. */
  x: number;
  y: number;
  facing: Facing;
  frame: Frame;
  /** The name tag (null = none). */
  name: string | null;
  me?: boolean;
  /** The 3D chibi's action (sit, fish cast/reel, swim, ride, wave…); absent = idle/walk/run from how the feet move. */
  act?: CharAct;
  /** Seated on a real seat (zones/seats.ts): the model's yaw (facing the table; absent: from `facing`) and how far
   *  above the ground its feet go (units; absent: 0 — the view's own lifts win). */
  yaw?: number;
  lift?: number;
  /** P3: what they ride — a vehicle, or the boat on Sông Cái (absent: on foot). The vehicle model follows the feet. */
  vehicle?: "bike" | "moto" | "car" | "boat";
}

/** P3: the gameplay things the 3D world shows beside the people (world px): the field's rats, the dogs, the pond's
 *  leaping fish and the shut level gates' bamboo barriers. */
export interface GameplayFrame {
  rats: ReadonlyArray<{ key: string; x: number; y: number; dir: 1 | -1; fallen: boolean }>;
  dogs: ReadonlyArray<{ id: string; x: number; y: number; facing: Facing }>;
  /** A fish in the air: where, and how high (0…1 of its arc). */
  leaps: ReadonlyArray<{ x: number; y: number; h: number }>;
  gates: ReadonlyArray<{ id: string; at: Vec; barrier: { x: number; y: number; w: number; h: number } | null }>;
  /** P4: the pets following their owners (the engine's PetFollowers; ownerId = the owner's account id). */
  pets?: ReadonlyArray<{ ownerId: string; species: PetSpecies; x: number; y: number }>;
  /** P4: everyone fishing (mine and the others' from realtime): feet, facing, phase code (1 wait, 2 bite, 3 reel). */
  anglers?: ReadonlyArray<{ id: string; x: number; y: number; facing: Facing; phase: 1 | 2 | 3 }>;
}

/** What the engine hands the diorama each frame (the same state the 2D renderer draws). */
export interface DioramaFrame {
  /** performance.now() */
  t: number;
  /** Where the camera follows (my feet, map px). */
  focus: Vec;
  billboards: Billboard[];
  /** 0 by day … 1 at night (the 2D lighting model's `night`). */
  night: number;
  /** Dawn/dusk warmth 0…1. */
  warm: number;
  weather: WeatherKind | null;
  windKmh: number;
  fx: WeatherFx;
  reduced: boolean;
  /** P3 world mode: rats, dogs, leaping fish, gates (absent on a per-map diorama). */
  gameplay?: GameplayFrame;
}

/** What the engine needs from a 3D view. */
export interface View3D {
  render(f: DioramaFrame): void;
  /** First person: the camera's yaw (radians), so the movement keys go where I look; null = map axes (third person). */
  inputYaw?(): number | null;
}

export type CameraMode = "follow" | "overview" | "free";
export type Quality = "high" | "low";

