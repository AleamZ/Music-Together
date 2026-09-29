import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DEFAULT_BODY, bodyKey, normalizeBody, randomBody } from "@/lib/game/body";
import { ChibiFactory, NONLA, SEGS, VOX, buildChibi, proportions } from "@/lib/game/diorama/character/build";
import { ChibiRig } from "@/lib/game/diorama/character/rig";
import { GENDERS, HAIR_STYLES } from "@/lib/game/types";
import { CHAR_ACTS, JOINT_LIMITS, poseAt } from "@/lib/game/diorama/character/pose";
import { chibiSpec } from "@/lib/game/diorama/character/spec";
import { DEFAULT_LOOK } from "@/lib/game/look";

const nam = { ...DEFAULT_LOOK, gender: "nam" as const }, nu = { ...DEFAULT_LOOK, gender: "nu" as const };

describe("chibi joint chains", () => {
  it("the leg chain adds up to the hip height (thigh + shin + foot), for any body", () => {
    for (const look of [nam, nu, { ...nam, body: { legs: 1, build: 1 } }, { ...nu, body: { legs: -1, build: -1 } }]) {
      const d = proportions(chibiSpec(look)).dims;
      expect(d.thighLen + d.calfLen + d.footH).toBeCloseTo(d.hipY, 6);
      expect(d.upperLen).toBeGreaterThan(0);
      expect(d.foreLen).toBeGreaterThan(0);
    }
  });

  it("limb length sliders lengthen the bones; body sliders stay within cute ranges", () => {
    const base = proportions(chibiSpec(nam)).dims;
    const long = proportions(chibiSpec({ ...nam, body: { legs: 1, arms: 1 } })).dims;
    expect(long.thighLen / base.thighLen).toBeCloseTo(1.16, 5);
    expect(long.upperLen / base.upperLen).toBeCloseTo(1.15, 5);
    for (let i = 0; i < 30; i++) {
      let seed = i + 1;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const d = proportions(chibiSpec({ ...nu, body: randomBody(rnd) })).dims;
      expect(d.scale).toBeGreaterThanOrEqual(0.92); expect(d.scale).toBeLessThanOrEqual(1.08);
      expect(d.headScale).toBeGreaterThan(1.1); expect(d.headScale).toBeLessThan(1.55);
      expect(d.hipY / VOX).toBeGreaterThan(11); expect(d.hipY / VOX).toBeLessThan(17);
    }
  });

  it("boys and girls differ: shoulders, hands, feet, hips, chest, stance", () => {
    const a = proportions(chibiSpec(nam)), b = proportions(chibiSpec(nu));
    expect(a.dims.shoulderX).toBeGreaterThan(b.dims.shoulderX * 1.15);
    expect(a.hand).toBeGreaterThan(b.hand);
    expect(a.foot).toBeGreaterThan(b.foot);
    expect(a.hips).toBeLessThan(b.hips);
    expect(a.dims.shoulderX / a.hips).toBeGreaterThan((b.dims.shoulderX / b.hips) * 1.3);  // V vs hourglass
    expect(b.chest).toBeGreaterThan(a.chest);
    expect(a.dims.posture.legZ).toBeGreaterThan(b.dims.posture.legZ);
  });

  it("every action keeps elbows, knees and ankles within their limits", () => {
    for (const act of CHAR_ACTS) for (let t = 0; t < 4; t += 0.05) {
      const p = poseAt(act, t, 0.37);
      for (const v of [p.elbowL, p.elbowR]) { expect(v).toBeGreaterThanOrEqual(JOINT_LIMITS.elbow[0]); expect(v).toBeLessThanOrEqual(JOINT_LIMITS.elbow[1]); }
      for (const v of [p.kneeL, p.kneeR]) { expect(v).toBeGreaterThanOrEqual(JOINT_LIMITS.knee[0]); expect(v).toBeLessThanOrEqual(JOINT_LIMITS.knee[1]); }
      for (const v of [p.ankleL, p.ankleR]) { expect(v).toBeGreaterThanOrEqual(JOINT_LIMITS.ankle[0]); expect(v).toBeLessThanOrEqual(JOINT_LIMITS.ankle[1]); }
      expect(Math.abs(p.squash)).toBeLessThanOrEqual(0.05);
    }
  });

  it("walks fold the swinging knee, runs lift it more with elbows near 90°, sitting folds knees to ~90°", () => {
    const peak = (act: "walk" | "run") => Math.max(...Array.from({ length: 80 }, (_, i) => poseAt(act, i / 80).kneeL));
    expect(peak("walk")).toBeGreaterThan(0.5);
    expect(peak("run")).toBeGreaterThan(peak("walk") + 0.4);
    expect(poseAt("run", 0.1).elbowL).toBeGreaterThan(1.2);
    const sit = poseAt("sit", 1);
    expect(sit.kneeL).toBeCloseTo(Math.PI / 2, 1);
    expect(Math.abs(sit.legL.x - Math.PI / 2)).toBeLessThan(0.1);                  // thighs level (calves a touch forward)
    const ride = poseAt("ride", 1);
    expect(ride.kneeL).toBeGreaterThan(1.2);
  });

  it("feet are their own segment on an ankle; the rest pose stands on the ground", () => {
    expect(SEGS).toContain("footL");
    const spec = chibiSpec(nam), b = buildChibi(spec, "low"), d = proportions(spec).dims;
    const foot = b.geos.footL;
    foot.computeBoundingBox();
    // the sole's bottom (ankle space) sits footH below the ankle: hips − thigh − shin − foot = 0
    expect(-foot.boundingBox!.min.y).toBeCloseTo(d.footH, 2);
    expect(foot.getAttribute("position").count).toBeGreaterThan(0);
    expect(new THREE.Box3().setFromBufferAttribute(b.geos.calfL.getAttribute("position") as THREE.BufferAttribute).min.y).toBeLessThan(-d.calfLen + 0.01);
  });

  it("body shapes normalise, key and randomise safely", () => {
    expect(normalizeBody({ height: 3, legs: -9, nope: 1, eyeColor: "red" })).toEqual({ ...DEFAULT_BODY, height: 1, legs: -1 });
    expect(bodyKey(null)).toBe("");
    expect(bodyKey({ eyeColor: "nau" })).toBe("");
    expect(bodyKey({ head: 0.5 })).not.toBe("");
    expect(chibiSpec({ ...nam, body: { head: 0.5 } }).key).not.toBe(chibiSpec(nam).key);
    const r = randomBody(() => 0.999);
    for (const v of Object.values(r)) if (typeof v === "number") expect(Math.abs(v)).toBeLessThanOrEqual(0.8);
  });

  it("under a nón lá no hair pokes out: every head vertex above the brim is inside the cone (all styles, both bodies)", () => {
    const hat = "hat_nonla";
    const inside = (y: number) => (NONLA.R * (NONLA.top - y)) / (NONLA.top - NONLA.rim);
    for (const gender of GENDERS) for (const hair of HAIR_STYLES) for (const detail of ["high", "low"] as const) {
      const g = buildChibi(chibiSpec({ ...DEFAULT_LOOK, gender, hair, hat }), detail).geos.head, pos = g.getAttribute("position");
      let worst = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) / VOX, y = pos.getY(i) / VOX, z = pos.getZ(i) / VOX;
        if (y < NONLA.rim + 0.4 || y > NONLA.top - 0.2) continue;                     // (the brim roll and the hat's own tip)
        worst = Math.max(worst, Math.hypot(x, z) - inside(y));
      }
      expect(worst, `${gender} ${hair} ${detail}`).toBeLessThan(0.08);
    }
    // the hat is sized to the head: brim ≈ 2.2× the head's width, as tall as ~1.05× its radius
    expect((2 * NONLA.R) / 8.4).toBeGreaterThan(2.1);
    expect((NONLA.top - NONLA.rim) / NONLA.R).toBeCloseTo(1.05, 2);
  }, 30_000);                                                                    // every hair style × body × detail

  it("seated, the skirt drapes over the lap: no thigh pokes through the cloth (skinned to the thighs)", () => {
    const f = new ChibiFactory(10);
    for (const bottom of ["fm_pleated_skirt", "bottom_skirt_red"]) for (const body of [{}, { hips: -1, build: -1 }, { hips: 1, build: 1, legs: 1 }]) {
      const look = { ...DEFAULT_LOOK, gender: "nu" as const, hat: null, bottom, body };
      if (chibiSpec(look).lower === "pants") continue;
      const rig = new ChibiRig();
      rig.setParts(f.acquire(chibiSpec(look), "high").parts);
      for (const act of ["sit", "walk", "run"] as const) for (const t of act === "sit" ? [1] : [0.1, 0.3, 0.55]) {
        rig.apply(poseAt(act, t));
        rig.root.updateMatrixWorld(true);
        const thigh = rig.root.getObjectByName("thighL") as THREE.Mesh, hips = rig.root.getObjectByName("hips") as THREE.SkinnedMesh;
        const leg = rig.root.getObjectByName("legL")!, hip = leg.getWorldPosition(new THREE.Vector3());
        const d = proportions(chibiSpec(look)).dims, v = new THREE.Vector3();
        // along the thigh (hip → 70% to the knee), the cloth's top over the thigh's centre line is above the thigh's top
        const dir = new THREE.Vector3(0, -1, 0).applyQuaternion(leg.getWorldQuaternion(new THREE.Quaternion()));
        for (let k = 0.3; k <= 0.7; k += 0.1) {
          const c = hip.clone().addScaledVector(dir, d.thighLen * k);
          const near = (p: THREE.Vector3) => Math.abs(p.x - c.x) < 0.03 && Math.abs(p.z - c.z) < 0.03;
          let top = -Infinity, cloth = -Infinity;
          const tp = thigh.geometry.getAttribute("position");
          for (let i = 0; i < tp.count; i++) { v.fromBufferAttribute(tp, i).applyMatrix4(thigh.matrixWorld); if (near(v)) top = Math.max(top, v.y); }
          const hp = hips.geometry.getAttribute("position");
          for (let i = 0; i < hp.count; i++) { hips.getVertexPosition(i, v).applyMatrix4(hips.matrixWorld); if (near(v)) cloth = Math.max(cloth, v.y); }
          if (top > -Infinity && cloth > -Infinity && act === "sit") expect(cloth, `${bottom} ${JSON.stringify(body)} ${act} ${k.toFixed(1)}`).toBeGreaterThan(top - 0.006);
        }
      }
      rig.detach();
    }
    f.dispose();
  }, 60_000);
});
