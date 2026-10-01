import { describe, expect, it } from "vitest";
import { POSE_IDS, specialPoseIds, stancePoseIds } from "@/lib/game/fight/render/poses";
import { FIGHT_POSES_3D, fightPose3D, fightPoseAt, lerpPose } from "@/lib/game/diorama/character/fight-pose";
import { JOINT_LIMITS } from "@/lib/game/diorama/character/pose";
import { BOSS_DEFS } from "@/lib/game/realm/model";
import { ENEMIES, ENEMY_ANIMS, ENEMY_IDS, enemyAnim, enemyFighterPoses } from "@/lib/game/diorama/world/enemies";

describe("3D fight poses", () => {
  it("every 2D pose id has a 3D pose, and nothing else", () => {
    expect(Object.keys(FIGHT_POSES_3D).sort()).toEqual([...POSE_IDS].sort());
  });
  it("every 3D pose is finite and within the joint limits", () => {
    for (const id of POSE_IDS) {
      const p = fightPose3D(id);
      for (const v of [p.bob, p.lean, p.headX, p.armL.x, p.armR.x, p.legL.x, p.legR.x]) expect(Number.isFinite(v)).toBe(true);
      for (const e of [p.elbowL, p.elbowR]) { expect(e).toBeGreaterThanOrEqual(JOINT_LIMITS.elbow[0]); expect(e).toBeLessThanOrEqual(JOINT_LIMITS.elbow[1]); }
      for (const k of [p.kneeL, p.kneeR]) { expect(k).toBeGreaterThanOrEqual(JOINT_LIMITS.knee[0]); expect(k).toBeLessThanOrEqual(JOINT_LIMITS.knee[1]); }
    }
  });
  it("reads the 2D rig: a guard bends the elbows, a crouch sinks and bends the knees, a high kick lifts the leg", () => {
    expect(fightPose3D("guard").elbowR).toBeGreaterThan(1.2);
    expect(fightPose3D("crouch").bob).toBeLessThan(-0.2);
    expect(fightPose3D("crouch").kneeR).toBeGreaterThan(0.8);
    expect(fightPose3D("hk1").legR.x).toBeGreaterThan(1.2);
    expect(fightPose3D("down0").lean).toBeLessThan(-1);
  });
  it("eases between keys: on a key at its start, between them later", () => {
    const ids = ["lp0", "lp1"];
    expect(fightPoseAt(ids, 0, 0.2)).toEqual(fightPose3D("lp0"));
    const mid = fightPoseAt(ids, 0.17, 0.2), a = fightPose3D("lp0"), b = fightPose3D("lp1");
    expect(mid.armR.x).toBeGreaterThan(Math.min(a.armR.x, b.armR.x));
    expect(mid.armR.x).toBeLessThan(Math.max(a.armR.x, b.armR.x));
    expect(lerpPose(a, b, 1).armR.x).toBeCloseTo(b.armR.x);
  });
  it("covers every style's stance and specials", () => {
    for (let s = 0; s < 8; s++) for (const id of [...stancePoseIds(s), ...[1, 2, 3, 4, 5].flatMap((k) => specialPoseIds(s, k))]) expect(FIGHT_POSES_3D[id]).toBeDefined();
  });
});

describe("3D fight foes", () => {
  it("every boss and underground NPC has a 3D model entry", () => {
    for (const b of BOSS_DEFS) expect(ENEMY_IDS).toContain(b.id);
    expect(ENEMY_IDS).toContain("tu_seo");
    expect(ENEMY_IDS).toContain("thay_lam");
    expect(new Set(ENEMY_IDS).size).toBe(ENEMY_IDS.length);
  });
  it("every foe has idle / attack / hit / die, and the creatures' attacks differ", () => {
    const sigs = new Set<string>();
    for (const e of ENEMIES) for (const a of ENEMY_ANIMS) {
      if (e.kind === "fighter") { for (const id of enemyFighterPoses(e.id, a)) expect(FIGHT_POSES_3D[id]).toBeDefined(); continue; }
      const p = enemyAnim(e.id, a, 0.45);
      for (const v of Object.values(p)) expect(Number.isFinite(v)).toBe(true);
      if (a === "attack") sigs.add(JSON.stringify(p));
    }
    expect(sigs.size).toBe(BOSS_DEFS.length);
    expect(enemyAnim("trau_tinh", "die", 5).sink).toBeGreaterThan(0);
  });
});
