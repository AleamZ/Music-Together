import type { Facing } from "@/lib/game/types";

const TURN: Facing[] = ["down", "left", "up", "right"];

/**
 * The walking preview's pose `elapsedSec` after it started: it turns every 1.2 s and steps 8 frames a second
 * (frame 0 when motion is reduced). A negative elapsed time counts as 0: the first requestAnimationFrame
 * timestamp can be earlier than the start time taken in the effect.
 */
export function previewPose(elapsedSec: number, still: boolean): { facing: Facing; frame: 0 | 1 | 2 | 3 } {
  const sec = Math.max(0, elapsedSec);
  return {
    facing: TURN[Math.floor(sec / 1.2) % TURN.length],
    frame: still ? 0 : ((Math.floor(sec * 8) % 4) as 0 | 1 | 2 | 3),
  };
}
