import type { Frame } from "@/lib/game/art/layers";
import type { WeatherFx } from "@/lib/game/art/weather";
import type { Facing, Look, Vec } from "@/lib/game/types";
import type { WeatherKind } from "@/lib/game/weather/model";

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
}

/** What the engine needs from a 3D view. */
export interface View3D {
  render(f: DioramaFrame): void;
}

export type CameraMode = "follow" | "overview" | "free";
export type Quality = "high" | "low";
