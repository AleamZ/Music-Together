// The fight foes in 3D (3D wave 2): the bosses (realm BOSS_DEFS, built by models.ts' bossModel) and the underground's
// people (anh Tư Sẹo, thầy Lâm: chibis in võ phục playing the fight poses). Each has idle / attack / hit / die
// animations; the creatures' are pure closed-form transforms (`enemyAnim`), distinct per foe (the buffalo charges
// head-down, the ghost wolf lunges and snaps, the boar gores, the snowman slams, the water monster rears and strikes).

import type { BossId } from "@/lib/game/realm/model";
import { BOSS_DEFS } from "@/lib/game/realm/model";
import { THAY_LAM_LOOK, TU_SEO_LOOK } from "@/lib/game/fight/npc";
import { specialPoseIds, stancePoseIds, type PoseId } from "@/lib/game/fight/render/poses";
import type { Look } from "@/lib/game/types";

export type EnemyAnim = "idle" | "attack" | "hit" | "die";
export const ENEMY_ANIMS: readonly EnemyAnim[] = ["idle", "attack", "hit", "die"];
/** One-shot lengths (s); idle loops. */
export const ENEMY_ANIM_S: Readonly<Record<EnemyAnim, number>> = { idle: 2.4, attack: 0.9, hit: 0.4, die: 1.2 };

type Attack = "charge" | "lunge" | "gore" | "slam" | "rear";
export type EnemyDef =
  | { id: string; name: string; kind: "creature"; boss: BossId; attack: Attack }
  | { id: string; name: string; kind: "fighter"; look: Look; style: number };

const ATTACK: Record<BossId, Attack> = { trau_tinh: "charge", soi_ma: "lunge", heo_rung: "gore", nguoi_tuyet: "slam", thuy_quai: "rear" };

export const ENEMIES: readonly EnemyDef[] = [
  ...BOSS_DEFS.map((b): EnemyDef => ({ id: b.id, name: b.name, kind: "creature", boss: b.id, attack: ATTACK[b.id] })),
  { id: "tu_seo", name: "anh Tư Sẹo", kind: "fighter", look: TU_SEO_LOOK, style: 2 },
  { id: "thay_lam", name: "thầy Lâm", kind: "fighter", look: THAY_LAM_LOOK, style: 7 },
];
export const ENEMY_IDS: readonly string[] = ENEMIES.map((e) => e.id);
export const enemyDef = (id: string): EnemyDef | null => ENEMIES.find((e) => e.id === id) ?? null;

/** A creature foe's transform for a frame (applied to models.ts' Creature by `applyEnemyPose`). */
export interface EnemyPose {
  /** Body up (units), forward offset (units), pitch (+ = nose down), roll, squash (+ = taller). */
  bob: number; fwd: number; pitch: number; roll: number; squash: number;
  /** Front legs' swing (+ = forward), back legs'; head pitch (+ = down). */
  front: number; back: number; head: number;
  /** Hit flash 0…1; 0…1 how far into the ground it has sunk (die). */
  flash: number; sink: number;
}

const ZERO: EnemyPose = { bob: 0, fwd: 0, pitch: 0, roll: 0, squash: 0, front: 0, back: 0, head: 0, flash: 0, sink: 0 };
const TAU = Math.PI * 2;
const ease = (x: number) => { const k = Math.max(0, Math.min(1, x)); return k * k * (3 - 2 * k); };
/** 0 → 1 over [a, b], then 1 → 0 over [b, c]. */
const bump = (t: number, a: number, b: number, c: number) => (t < b ? ease((t - a) / (b - a)) : 1 - ease((t - b) / (c - b)));

/** A creature foe's pose for `anim` at `t` s (one-shots clamp at their end). */
export function enemyAnim(id: string, anim: EnemyAnim, t: number): EnemyPose {
  const d = enemyDef(id);
  const atk: Attack = d?.kind === "creature" ? d.attack : "lunge";
  const p: EnemyPose = { ...ZERO };
  const T = anim === "idle" ? t % ENEMY_ANIM_S.idle : Math.min(t, ENEMY_ANIM_S[anim]);
  switch (anim) {
    case "idle": {
      const b = Math.sin((T / ENEMY_ANIM_S.idle) * TAU);
      p.squash = b * 0.025; p.bob = b * 0.02; p.head = Math.sin((T / ENEMY_ANIM_S.idle) * TAU * 0.5) * 0.12;
      if (atk === "rear") { p.roll = b * 0.06; p.bob = b * 0.08; }
      if (atk === "slam") p.roll = b * 0.04;
      break;
    }
    case "attack": {
      const wind = bump(T, 0, 0.35, 0.5), hit = bump(T, 0.35, 0.5, 0.9);
      switch (atk) {
        case "charge": p.pitch = wind * -0.1 + hit * 0.25; p.head = wind * 0.3 + hit * 0.55; p.fwd = -wind * 0.25 + hit * 1.1; p.front = hit * 0.6; p.back = -hit * 0.5; break;
        case "lunge": p.pitch = -wind * 0.15 - hit * 0.2; p.bob = hit * 0.6; p.fwd = -wind * 0.2 + hit * 1.3; p.front = hit * 1.1; p.back = -hit * 0.9; p.head = -hit * 0.35; break;
        case "gore": p.pitch = wind * 0.1 + hit * 0.3; p.head = hit * 0.6 - wind * 0.2; p.fwd = hit * 0.8; p.roll = hit * 0.18; p.front = hit * 0.4; break;
        case "slam": p.squash = wind * 0.12 - hit * 0.14; p.bob = wind * 0.5; p.pitch = -wind * 0.15 + hit * 0.35; p.fwd = hit * 0.4; break;
        case "rear": p.pitch = -wind * 0.45 + hit * 0.55; p.bob = wind * 0.7 - hit * 0.2; p.head = hit * 0.4; p.fwd = hit * 0.6; break;
      }
      break;
    }
    case "hit": {
      const k = bump(T, 0, 0.08, 0.4);
      p.fwd = -k * 0.3; p.pitch = -k * 0.15; p.squash = -k * 0.08; p.head = -k * 0.3; p.flash = 1 - ease(T / 0.3);
      p.roll = (atk === "slam" ? 0.12 : 0.06) * k;
      break;
    }
    case "die": {
      const k = ease(T / 0.7), s = ease((T - 0.6) / 0.6);
      if (atk === "rear") { p.pitch = k * 0.6; p.sink = s; }
      else if (atk === "slam") { p.squash = -k * 0.35; p.roll = k * 0.25; p.sink = s * 0.6; }
      else { p.roll = k * 1.45; p.bob = -k * 0.15; p.front = k * 0.5; p.back = -k * 0.4; p.head = k * 0.4; p.sink = s * 0.3; }
      p.flash = 1 - ease(T / 0.25);
      break;
    }
  }
  return p;
}

/** The key poses a fighter foe plays for `anim` (2D pose ids, eased in 3D by fightPoseAt). */
export function enemyFighterPoses(id: string, anim: EnemyAnim): PoseId[] {
  const d = enemyDef(id);
  const style = d?.kind === "fighter" ? d.style : 0;
  switch (anim) {
    case "idle": return stancePoseIds(style);
    case "attack": return [...specialPoseIds(style, 1), "idle0"];
    case "hit": return ["hit_high", "hit_mid", "guard"];
    case "die": return ["hit_high", "fall", "down0", "down0"];
  }
}
