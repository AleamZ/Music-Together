import { bossModel, type Creature, type ModelMats } from "./models";
import { enemyDef, type EnemyPose } from "./enemies";

// Browser only: a creature foe's 3D model (the boss models, in the outlined toon creature style) and how a frame of
// its animation (enemies.ts' `enemyAnim`) is put on it. Fighter foes are chibis (ChibiRig + fight-pose.ts).

/** The model of creature foe `id` (null: a fighter foe or an unknown id). */
export function enemyModel(mats: ModelMats, id: string): Creature | null {
  const d = enemyDef(id);
  return d?.kind === "creature" ? bossModel(mats, d.boss) : null;
}

/** Puts a frame on the model (overwrites the body's transform, the legs' and head's pitch). */
export function applyEnemyPose(c: Creature, p: EnemyPose): void {
  const b = c.body, h = c.height;
  b.position.set(0, p.bob * h * 0.3 - p.sink * h * 0.35, p.fwd * h * 0.12);
  b.rotation.set(p.pitch, 0, p.roll);
  const f = 1 + p.flash * 0.06;
  b.scale.set(f * (1 - p.squash * 0.5), f * (1 + p.squash), f * (1 - p.squash * 0.5));
  const [fl, fr, bl, br] = c.legs;
  if (fl && fr) fl.rotation.x = fr.rotation.x = p.front;
  if (bl && br) bl.rotation.x = br.rotation.x = p.back;
  if (c.head) c.head.rotation.x = p.head;
}
