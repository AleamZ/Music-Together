// v20 Võ đài: one arena frame — the background, both fighters (their poses a pure function of the state), the
// effects, the HUD and, in practice, the frame-data boxes. The shake is applied by the overlay (a CSS offset).

import {
  A_ATTACK, A_JATTACK, F_ACT, F_AF, F_FACE, F_MOVE, F_SC, F_X, F_Y, G_FRAME, HURT_AIR, HURT_CROUCH, HURT_STAND, SUB,
  fb, isAirborne, isCrouching, type State,
} from "../engine";
import { K_DODGE, K_GRAB, K_PARRY, K_THROW, M_A, M_GMAX, M_KIND, M_NEAR, M_REACH, M_S, M_YHI, M_YLO, mv } from "../moves";
import { paintArena, type ArenaKind } from "./arena-art";
import { GROUND_Y, isFlashing, paintEffects, type EffectTracker } from "./fx";
import { paintHud, type TrailTracker } from "./hud";
import { RIG_H, RIG_W, poseData, poseFor } from "./poses";
import { fighterSprite, paintFighter, type FighterLook, type PixelCtx } from "./rig";

export interface SceneCtx extends PixelCtx {
  drawImage?: (img: CanvasImageSource, x: number, y: number) => void;
}

export interface SceneView {
  arena: ArenaKind;
  fighters: readonly [FighterLook, FighterLook];
  fx: EffectTracker;
  trail: TrailTracker;
  reduced: boolean;
  /** Practice's frame-data toggle: hurtboxes and active hitboxes. */
  boxes: boolean;
}

/** Where a fighter's 48 × 64 box goes on the arena. */
export function fighterOrigin(s: State, side: number): [number, number] {
  const b = fb(side);
  return [Math.trunc(s[b + F_X] / SUB) - RIG_W / 2, GROUND_Y - RIG_H + 1 - Math.trunc(s[b + F_Y] / SUB)];
}

function outline(c: PixelCtx, x0: number, y0: number, x1: number, y1: number, color: string): void {
  c.fillStyle = color;
  c.fillRect(x0, y0, x1 - x0, 1);
  c.fillRect(x0, y1 - 1, x1 - x0, 1);
  c.fillRect(x0, y0, 1, y1 - y0);
  c.fillRect(x1 - 1, y0, 1, y1 - y0);
}

function paintBoxes(c: PixelCtx, s: State, side: number): void {
  const b = fb(side);
  const x = Math.trunc(s[b + F_X] / SUB), y = Math.trunc(s[b + F_Y] / SUB);
  const hb = isAirborne(s, b) ? HURT_AIR : isCrouching(s, b) ? HURT_CROUCH : HURT_STAND;
  outline(c, x - hb[0] / 2, GROUND_Y - y - hb[1], x + hb[0] / 2, GROUND_Y - y, "#47e36a");
  const a = s[b + F_ACT];
  if (a !== A_ATTACK && a !== A_JATTACK) return;
  const id = s[b + F_MOVE] - 1, kind = mv(id, M_KIND);
  if (kind === K_PARRY || kind === K_DODGE) return;
  const st = mv(id, M_S) + 2 * s[b + F_SC], af = s[b + F_AF];
  if (af <= st || af > st + mv(id, M_A)) return;
  const face = s[b + F_FACE];
  const reach = kind === K_GRAB ? mv(id, M_GMAX) : mv(id, M_REACH);
  const near = kind === K_THROW ? 0 : mv(id, M_NEAR);
  const lo = face > 0 ? x + near : x - reach, hi = face > 0 ? x + reach : x - near;
  const ylo = kind === K_THROW || kind === K_GRAB ? 0 : mv(id, M_YLO), yhi = kind === K_THROW || kind === K_GRAB ? 50 : mv(id, M_YHI);
  outline(c, lo, GROUND_Y - y - yhi, hi, GROUND_Y - y - ylo, "#ff4a3d");
}

export function paintScene(c: SceneCtx, s: State, v: SceneView): void {
  const f = s[G_FRAME];
  paintArena(c, v.arena, f, v.reduced);
  // the attacking fighter is drawn in front
  const order = s[fb(0) + F_ACT] === A_ATTACK || s[fb(0) + F_ACT] === A_JATTACK ? [1, 0] : [0, 1];
  for (const side of order) {
    const [ox, oy] = fighterOrigin(s, side);
    const fl = v.fighters[side];
    const pose = poseFor(s, side);
    const flip = s[fb(side) + F_FACE] < 0;
    const flash = isFlashing(s, side, v.reduced);
    // a soft shadow on the ground
    c.fillStyle = "#00000055";
    c.fillRect(ox + 12, GROUND_Y - 1, 24, 2);
    const sprite = c.drawImage ? fighterSprite(fl, pose, flip, flash) : null;
    if (sprite && c.drawImage) c.drawImage(sprite, ox, oy);
    else paintFighter(c, poseData(pose, fl.style), fl, ox, oy, flip, flash);
  }
  paintEffects(c, v.fx.active(), f, v.reduced);
  paintHud(c, s, v.trail.update(s), v.reduced);
  if (v.boxes) for (const side of [0, 1]) paintBoxes(c, s, side);
}
